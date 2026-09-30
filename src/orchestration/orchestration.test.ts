import { PlatformOrchestrator } from './platform-orchestrator.js';
import { InMemoryRepository } from './repository.js';
import { IntakeAgent, WorkflowPlanner, RepairAgent } from '../plan/index.js';
import {
  StructuralCheck,
  Compiler,
  CompiledWorkflowCheck,
  ContractCheck,
} from '../verify/index.js';
import { Sandbox, Deployer } from '../run/index.js';

describe('End-to-End Orchestration Integration Tests', () => {
  let orchestrator: PlatformOrchestrator;
  let repo: InMemoryRepository;

  // Mock dependencies
  let intake: jest.Mocked<IntakeAgent>;
  let planner: jest.Mocked<WorkflowPlanner>;
  let repair: jest.Mocked<RepairAgent>;
  let structuralCheck: jest.Mocked<StructuralCheck>;
  let compiler: jest.Mocked<Compiler>;
  let compiledWorkflowCheck: jest.Mocked<CompiledWorkflowCheck>;
  let contractCheck: jest.Mocked<ContractCheck>;
  let sandbox: jest.Mocked<Sandbox>;
  let deployer: jest.Mocked<Deployer>;

  beforeEach(() => {
    repo = new InMemoryRepository();

    intake = { parse: jest.fn() } as any;
    planner = { plan: jest.fn() } as any;
    repair = { repair: jest.fn() } as any;
    structuralCheck = { validate: jest.fn() } as any;
    compiler = { compile: jest.fn() } as any;
    compiledWorkflowCheck = { validate: jest.fn() } as any;
    contractCheck = { verify: jest.fn() } as any;
    sandbox = { execute: jest.fn() } as any;
    deployer = { deploy: jest.fn() } as any;

    orchestrator = new PlatformOrchestrator({
      intake,
      planner,
      repair,
      structuralCheck,
      compiler,
      compiledWorkflowCheck,
      contractCheck,
      sandbox,
      deployer,
      repository: repo,
      logger: { info: jest.fn(), error: jest.fn() },
    });
  });

  it('Property 10.3.1: Complete flow successfully processes a prompt to deployment', async () => {
    // 1. Intake
    intake.parse.mockResolvedValue({
      structured_objective: { target_entity: 'Data', requirements: [] },
      interpretation_confidence: 0.9,
      assumptions: [],
    } as any);

    // 2. Planner
    const mockIr = { steps: [{ id: '1', type: 'trigger' }], connections: [] };
    planner.plan.mockResolvedValue({ capability_graph: mockIr } as any);

    // 3. Verify loop
    structuralCheck.validate.mockReturnValue({
      status: 'valid',
      verified_ir: { ir: mockIr } as any,
    });

    const mockWorkflow = { nodes: [], connections: {} };
    compiler.compile.mockReturnValue({ status: 'success', workflow_json: mockWorkflow } as any);

    compiledWorkflowCheck.validate.mockResolvedValue({
      status: 'valid',
      validated_workflow: mockWorkflow as any,
    });

    contractCheck.verify.mockReturnValue({
      status: 'certified',
      certificate: {} as any,
      checked_at: new Date().toISOString(),
    });

    sandbox.execute.mockResolvedValue({ status: 'success', executed_at: new Date().toISOString() });

    // 4. Deployer
    deployer.deploy.mockResolvedValue({
      status: 'deployed',
      record: {
        workflow_id: 'deploy-1',
        deployed_at: new Date().toISOString(),
        execution_url: '',
      } as any,
      deployed_at: new Date().toISOString(),
    });

    const result = await orchestrator.run('Sync customer data');

    expect(result.workflowId).toBe('deploy-1');
    expect(intake.parse).toHaveBeenCalledWith('Sync customer data');
    expect(deployer.deploy).toHaveBeenCalled();

    // Verify Repository persistence
    const savedWorkflows = Array.from((repo as any).state.workflows.values()) as any[];
    expect(savedWorkflows.length).toBe(1);
    expect(savedWorkflows[0].n8nWorkflowId).toBe('deploy-1');
  });

  it('Property 10.3.2: Repair loop kicks in on LOGIC_FAILURE (structural check fail)', async () => {
    intake.parse.mockResolvedValue({ structured_objective: {} } as any);
    planner.plan.mockResolvedValue({ capability_graph: { steps: [] } } as any);

    // Fail first time
    structuralCheck.validate.mockReturnValueOnce({ status: 'invalid', errors: [] });
    // Succeed second time
    structuralCheck.validate.mockReturnValueOnce({
      status: 'valid',
      verified_ir: { ir: {} } as any,
    });

    compiler.compile.mockReturnValue({ status: 'success', workflow_json: {} } as any);
    compiledWorkflowCheck.validate.mockResolvedValue({ status: 'valid' });
    contractCheck.verify.mockReturnValue({
      status: 'certified',
      certificate: {} as any,
      checked_at: new Date().toISOString(),
    });
    sandbox.execute.mockResolvedValue({ status: 'success', executed_at: new Date().toISOString() });

    deployer.deploy.mockResolvedValue({
      status: 'deployed',
      record: { workflow_id: 'deploy-2', deployed_at: '', execution_url: '' } as any,
      deployed_at: '',
    });

    // Mock repair agent to patch it
    repair.repair.mockResolvedValue({
      status: 'patched',
      patched_ir: { steps: [{ id: 'patched' }] } as any,
      patch_description: 'Fixed structural issue',
    });

    const result = await orchestrator.run('test repair');

    expect(result.workflowId).toBe('deploy-2');
    expect(repair.repair).toHaveBeenCalledTimes(1);
    expect(structuralCheck.validate).toHaveBeenCalledTimes(2);
  });

  it('Property 10.3.3: Exceeds MAX_REPAIR_ATTEMPTS', async () => {
    intake.parse.mockResolvedValue({ structured_objective: {} } as any);
    planner.plan.mockResolvedValue({ capability_graph: { steps: [] } } as any);

    structuralCheck.validate.mockReturnValue({ status: 'invalid', errors: [] });

    repair.repair.mockResolvedValue({
      status: 'patched',
      patched_ir: { steps: [{ id: 'patched' }] } as any,
      patch_description: 'Fixed structural issue',
    });

    await expect(orchestrator.run('test fail')).rejects.toThrow(/Orchestration failed after/);

    expect(repair.repair).toHaveBeenCalledTimes(3); // Up to MAX_REPAIR_ATTEMPTS (which is 3)
  });

  it('Property 10.3.4: Multiple concurrent orchestrations', async () => {
    // Tests thread safety and repository isolation
    intake.parse.mockResolvedValue({ structured_objective: {} } as any);
    planner.plan.mockResolvedValue({ capability_graph: { steps: [] } } as any);
    structuralCheck.validate.mockReturnValue({ status: 'valid', verified_ir: { ir: {} } as any });
    compiler.compile.mockReturnValue({ status: 'success', workflow_json: {} } as any);
    compiledWorkflowCheck.validate.mockResolvedValue({ status: 'valid' });
    contractCheck.verify.mockReturnValue({
      status: 'certified',
      certificate: {} as any,
      checked_at: new Date().toISOString(),
    });
    sandbox.execute.mockResolvedValue({ status: 'success', executed_at: new Date().toISOString() });
    deployer.deploy.mockResolvedValue({
      status: 'deployed',
      record: { workflow_id: 'deploy-concurrent', deployed_at: '', execution_url: '' } as any,
      deployed_at: '',
    });

    const promises = [
      orchestrator.run('task 1'),
      orchestrator.run('task 2'),
      orchestrator.run('task 3'),
    ];

    const results = await Promise.all(promises);
    expect(results.length).toBe(3);

    const savedWorkflows = Array.from((repo as any).state.workflows.values());
    expect(savedWorkflows.length).toBe(3);
  });
});
