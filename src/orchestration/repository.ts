import type { IR, StructuredObjective, N8NWorkflow } from '../core/types.js';

export interface UserPromptEntity {
  id: string;
  promptText: string;
  createdAt: Date;
}

export interface ObjectiveEntity {
  id: string;
  promptId: string;
  objective: StructuredObjective;
  createdAt: Date;
}

export interface IREntity {
  id: string;
  objectiveId: string;
  ir: IR;
  createdAt: Date;
}

export interface DeployedWorkflowEntity {
  id: string;
  irId: string;
  n8nWorkflowId: string;
  workflow: N8NWorkflow;
  createdAt: Date;
}

export interface PlatformState {
  prompts: Map<string, UserPromptEntity>;
  objectives: Map<string, ObjectiveEntity>;
  irs: Map<string, IREntity>;
  workflows: Map<string, DeployedWorkflowEntity>;
}

export class InMemoryRepository {
  private state: PlatformState = {
    prompts: new Map(),
    objectives: new Map(),
    irs: new Map(),
    workflows: new Map(),
  };

  savePrompt(entity: UserPromptEntity): void {
    this.state.prompts.set(entity.id, entity);
  }

  getPrompt(id: string): UserPromptEntity | undefined {
    return this.state.prompts.get(id);
  }

  saveObjective(entity: ObjectiveEntity): void {
    this.state.objectives.set(entity.id, entity);
  }

  getObjective(id: string): ObjectiveEntity | undefined {
    return this.state.objectives.get(id);
  }

  saveIR(entity: IREntity): void {
    this.state.irs.set(entity.id, entity);
  }

  getIR(id: string): IREntity | undefined {
    return this.state.irs.get(id);
  }

  saveWorkflow(entity: DeployedWorkflowEntity): void {
    this.state.workflows.set(entity.id, entity);
  }

  getWorkflow(id: string): DeployedWorkflowEntity | undefined {
    return this.state.workflows.get(id);
  }

  // Transaction-like multi-step operation support could be added here
  // For in-memory, simple synchronous saving works as a transaction proxy
}
