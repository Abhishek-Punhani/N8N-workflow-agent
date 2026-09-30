import { IntakeAgent, WorkflowPlanner, RepairAgent, MAX_REPAIR_ATTEMPTS } from '../plan/index.js';
import type { PatchAttempt } from '../plan/repair-agent.js';
import {
  StructuralCheck,
  Compiler,
  CompiledWorkflowCheck,
  ContractCheck,
} from '../verify/index.js';
import { Sandbox, Deployer } from '../run/index.js';
import { FailureClassification } from '../core/errors.js';
import type { N8NWorkflow } from '../core/types.js';
import { InMemoryRepository } from './repository.js';
import { randomUUID } from 'crypto';

export interface PlatformOrchestratorConfig {
  intake: IntakeAgent;
  planner: WorkflowPlanner;
  repair: RepairAgent;
  structuralCheck: StructuralCheck;
  compiler: Compiler;
  compiledWorkflowCheck: CompiledWorkflowCheck;
  contractCheck: ContractCheck;
  sandbox: Sandbox;
  deployer: Deployer;
  repository?: InMemoryRepository;
  logger?: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };
}

export class PlatformOrchestrator {
  private repo: InMemoryRepository;

  constructor(private config: PlatformOrchestratorConfig) {
    this.repo = config.repository ?? new InMemoryRepository();
  }

  async run(prompt: string): Promise<{ workflowId: string }> {
    this.logInfo('Starting Orchestration Phase');

    // Track State
    const promptId = randomUUID();
    this.repo.savePrompt({ id: promptId, promptText: prompt, createdAt: new Date() });

    // 1. Intake
    this.logInfo('Running Intake Agent');
    const intakeResult = await this.config.intake.parse(prompt);
    const objective = intakeResult.structured_objective;

    const objectiveId = randomUUID();
    this.repo.saveObjective({ id: objectiveId, promptId, objective, createdAt: new Date() });

    // 2. Plan
    this.logInfo('Running Workflow Planner');
    const plannerOutput = await this.config.planner.plan(objective);
    let ir = plannerOutput.capability_graph;

    const irId = randomUUID();
    this.repo.saveIR({ id: irId, objectiveId, ir, createdAt: new Date() });

    // 3. Verify & Sandbox loop
    let attempts = 0;
    let finalWorkflow: N8NWorkflow | null = null;
    const previousPatches: PatchAttempt[] = [];

    while (attempts <= MAX_REPAIR_ATTEMPTS) {
      try {
        // Structural check
        this.logInfo(`Verification Attempt ${attempts + 1}: Structural Check`);
        const structuralResult = this.config.structuralCheck.validate(ir);
        if (structuralResult.status === 'invalid' || !structuralResult.verified_ir) {
          throw new Error('Structural Check Failed: ' + JSON.stringify(structuralResult.errors));
        }

        // Compiler
        this.logInfo(`Verification Attempt ${attempts + 1}: Compiler`);
        const compilerResult = this.config.compiler.compile({
          verified_ir: structuralResult.verified_ir,
        });
        if (compilerResult.status === 'error' || !compilerResult.workflow_json) {
          throw new Error('Compiler Failed: ' + JSON.stringify(compilerResult.errors));
        }
        finalWorkflow = compilerResult.workflow_json;

        // Compiled Check
        this.logInfo(`Verification Attempt ${attempts + 1}: Compiled Workflow Check`);
        const compiledResult = await this.config.compiledWorkflowCheck.validate({
          workflow_json: finalWorkflow,
        });
        if (compiledResult.status === 'invalid') {
          throw new Error('Compiled Check Failed: ' + JSON.stringify(compiledResult.errors));
        }

        // Contract Check — provenance defaults to false unless the StructuredObjective
        // is extended in future to carry an explicit flag.
        this.logInfo(`Verification Attempt ${attempts + 1}: Contract Check`);
        const contractResult = this.config.contractCheck.verify({
          workflow_json: finalWorkflow,
          required_fields: objective.required_fields ?? [],
          provenance_required: false,
        });
        if (contractResult.status === 'violation') {
          throw new Error('Contract Check Failed: ' + JSON.stringify(contractResult.violations));
        }

        // Sandbox
        this.logInfo(`Verification Attempt ${attempts + 1}: Sandbox`);
        await this.config.sandbox.execute({ workflow_json: finalWorkflow });

        this.logInfo(`Verification successful on attempt ${attempts + 1}`);
        break;
      } catch (error) {
        attempts++;
        if (attempts > MAX_REPAIR_ATTEMPTS) {
          this.logError('Max repair attempts reached. Aborting.', error);
          const errorMsg = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Orchestration failed after ${MAX_REPAIR_ATTEMPTS} repair attempts. Last error: ${errorMsg}`
          );
        }

        this.logInfo(`Invoking Repair Agent (Attempt ${attempts} of ${MAX_REPAIR_ATTEMPTS})`);

        const errorMsg = error instanceof Error ? error.message : String(error);

        // Classify: sandbox errors are infrastructure, everything else is logic
        const classification = errorMsg.toLowerCase().includes('sandbox')
          ? FailureClassification.INFRASTRUCTURE_FAILURE
          : FailureClassification.LOGIC_FAILURE;

        const failureTrace = {
          step_id: ir.steps[0]?.id ?? 'unknown',
          error_message: errorMsg,
          context: {},
          classification,
          retry_count: attempts,
          timestamp: new Date().toISOString(),
        };

        const repairOutput = await this.config.repair.repair({
          failure_trace: failureTrace,
          original_ir: ir,
          attempt_number: attempts,
          previous_patches: previousPatches,
        });

        if (repairOutput.status === 'escalated') {
          throw new Error(
            'Repair Agent escalated the issue: ' +
              (repairOutput.escalation_report
                ? JSON.stringify(repairOutput.escalation_report)
                : 'Unknown reason')
          );
        }
        if (!repairOutput.patched_ir) {
          throw new Error('Repair Agent failed to provide patched IR');
        }

        previousPatches.push({
          attempt_number: attempts,
          patch_description: repairOutput.patch_description ?? 'unknown',
          result: 'still_failing',
        });

        ir = repairOutput.patched_ir;
      }
    }

    if (!finalWorkflow) {
      throw new Error('Verification loop completed but no workflow was generated.');
    }

    // 4. Deploy
    // Credential requirements are resolved from environment config by the Deployer's CredentialStore.
    // The orchestrator passes an empty list; callers that need specific credentials should inject
    // a pre-configured CredentialStore into the Deployer.
    this.logInfo('Deploying Workflow');
    const deployResult = await this.config.deployer.deploy({
      workflow_json: finalWorkflow,
      credential_requirements: [],
    });

    if (deployResult.status === 'error' || !deployResult.record) {
      throw new Error('Deployment failed: ' + deployResult.error?.message);
    }

    const workflowId = deployResult.record.workflow_id;

    this.repo.saveWorkflow({
      id: randomUUID(),
      irId,
      n8nWorkflowId: workflowId,
      workflow: finalWorkflow,
      createdAt: new Date(),
    });

    this.logInfo(`Workflow successfully deployed! ID: ${workflowId}`);
    return { workflowId };
  }

  private logInfo(msg: string): void {
    if (this.config.logger) this.config.logger.info(msg);
  }

  private logError(msg: string, err?: unknown): void {
    if (this.config.logger) this.config.logger.error(msg, err);
  }
}
