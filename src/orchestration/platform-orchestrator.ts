import { IntakeAgent, WorkflowPlanner, RepairAgent, MAX_REPAIR_ATTEMPTS } from '../plan/index.js';
import { StructuralCheck, Compiler, CompiledWorkflowCheck, ContractCheck } from '../verify/index.js';
import { Sandbox, Deployer } from '../run/index.js';
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
  logger?: { info: (msg: string) => void; error: (msg: string, err?: any) => void };
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
    const previousPatches: any[] = [];

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
        const compilerResult = this.config.compiler.compile({ verified_ir: structuralResult.verified_ir });
        if (compilerResult.status === 'error' || !compilerResult.workflow_json) {
            throw new Error('Compiler Failed: ' + JSON.stringify(compilerResult.errors));
        }
        finalWorkflow = compilerResult.workflow_json;

        // Compiled Check
        this.logInfo(`Verification Attempt ${attempts + 1}: Compiled Workflow Check`);
        const compiledResult = await this.config.compiledWorkflowCheck.validate({ workflow_json: finalWorkflow });
        if (compiledResult.status === 'invalid') {
          throw new Error('Compiled Check Failed: ' + JSON.stringify(compiledResult.errors));
        }

        // Contract Check
        this.logInfo(`Verification Attempt ${attempts + 1}: Contract Check`);
        const contractResult = this.config.contractCheck.verify({ 
          workflow_json: finalWorkflow, 
          required_fields: objective.required_fields,
          provenance_required: objective.output_requirements?.format ? true : false, // Simplified check
        });
        if (contractResult.status === 'violation') {
          throw new Error('Contract Check Failed: ' + JSON.stringify(contractResult.violations));
        }

        // Sandbox
        this.logInfo(`Verification Attempt ${attempts + 1}: Sandbox`);
        await this.config.sandbox.execute({ workflow_json: finalWorkflow });

        // If we get here, all checks passed!
        this.logInfo(`Verification successful on attempt ${attempts + 1}`);
        break;
      } catch (error) {
        attempts++;
        if (attempts > MAX_REPAIR_ATTEMPTS) {
          this.logError('Max repair attempts reached. Aborting.', error);
          const errorMsg = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
          throw new Error(
            `Orchestration failed after ${MAX_REPAIR_ATTEMPTS} repair attempts. Last error: ${errorMsg}`
          );
        }

        this.logInfo(`Invoking Repair Agent (Attempt ${attempts} of ${MAX_REPAIR_ATTEMPTS})`);
        
        // Mock a failure trace for Sandbox or Verify errors
        const failureTrace = {
          step_id: ir.steps[0]?.id || 'unknown',
          error_message: error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error',
          context: {},
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          classification: 'validation_error' as any, // Mocking classification
          retry_count: attempts,
          timestamp: new Date().toISOString()
        };
        
        const repairInput = {
          failure_trace: failureTrace,
          original_ir: ir,
          attempt_number: attempts,
          previous_patches: previousPatches
        };
        const repairOutput = await this.config.repair.repair(repairInput);
        
        if (repairOutput.status === 'escalated') {
          throw new Error('Repair Agent escalated the issue: ' + (repairOutput.escalation_report ? JSON.stringify(repairOutput.escalation_report) : 'Unknown reason'));
        }
        if (!repairOutput.patched_ir) {
          throw new Error('Repair Agent failed to provide patched IR');
        }
        
        previousPatches.push({
           attempt: attempts,
           patch_description: repairOutput.patch_description || 'unknown',
           timestamp: new Date().toISOString()
        });
        
        ir = repairOutput.patched_ir;
      }
    }

    if (!finalWorkflow) {
      throw new Error('Verification loop completed but no workflow was generated.');
    }

    // 4. Deploy
    this.logInfo('Deploying Workflow');
    const deployResult = await this.config.deployer.deploy({
      workflow_json: finalWorkflow,
      credential_requirements: []
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

  private logInfo(msg: string) {
    if (this.config.logger) this.config.logger.info(msg);
  }

  private logError(msg: string, err?: any) {
    if (this.config.logger) this.config.logger.error(msg, err);
  }
}
