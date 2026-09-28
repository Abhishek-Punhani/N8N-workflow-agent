/**
 * AI Data Intelligence Platform - Plan Module Type Definitions
 */

import { StructuredObjective, IR } from '@core/types.js';

// ============================================================================
// Agent Output Types
// ============================================================================

export interface IntakeAgentOutput {
  structured_objective: StructuredObjective;
  interpretation_confidence: number;
  assumptions: Assumption[];
  clarification_needed?: ClarificationRequest;
}

export interface WorkflowPlannerOutput {
  capability_graph: IR;
}

// ============================================================================
// Plan-Specific Types
// ============================================================================

export interface Assumption {
  description: string;
  confidence: number;
  documentation: string;
}

export interface ClarificationRequest {
  questions: string[];
  suggested_answers?: string[];
}

export interface PlanResult {
  structured_objective?: StructuredObjective;
  capability_graph?: IR;
  error?: PlanError;
  timestamp: string;
}

export interface PlanError {
  type: 'PROMPT_PARSING_ERROR' | 'CAPABILITY_NOT_IN_VOCABULARY' | 'IR_GENERATION_ERROR';
  message: string;
  context: Record<string, any>;
}

// ============================================================================
// Timeout Configuration
// ============================================================================

export const PLAN_TIMEOUTS = {
  INTAKE_AGENT: 30_000, // 30 seconds
  WORKFLOW_PLANNER: 30_000, // 30 seconds
};
