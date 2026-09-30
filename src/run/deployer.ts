/**
 * AI Data Intelligence Platform - Deployer
 *
 * Orchestrator that deploys a verified N8NWorkflow to the n8n instance.
 * Resolves credentials, creates the workflow, activates it, and records
 * the deployment for audit.
 *
 * Pipeline position:
 *   ContractCheck (certified) → Sandbox (success) → Deployer → DeploymentRecord
 *
 * Key design decisions:
 *  - N8NApiClient and CredentialStore are injected — both mockable in tests.
 *  - Credential resolution happens BEFORE the API call: fail fast on
 *    CREDENTIAL_MISSING rather than discovering it mid-deploy (Req 9.4).
 *  - Deployment ID is generated with crypto.randomUUID() — unique per deploy.
 *  - configuration_manifest records credential *types* only (not values)
 *    for auditability without exposing secrets (Req 9.5).
 *  - ACTIVATION_FAILED is a distinct error from DEPLOYMENT_FAILED:
 *    the workflow exists in n8n but is not running (Req 9.3).
 *  - The Deployer does NOT retry on its own — callers use RetryHandler for
 *    infrastructure-level retries (consistent with the platform pattern).
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { randomUUID } from 'crypto';
import type {
  N8NWorkflow,
  CredentialRequirement,
  DeploymentRecord,
  DeploymentErrorInfo,
} from '../core/types.js';
import type { N8NApiClient } from './n8n-api-client.js';

// ============================================================================
// CredentialStore interface
// ============================================================================

/**
 * Abstraction over the credential store.
 * Production: reads from env vars, vault, or n8n credential store.
 * Tests: returns from a simple Record map.
 */
export interface CredentialStore {
  /**
   * Resolve a credential by name.
   * Returns the credential value or null if not found.
   */
  resolve(credentialName: string): string | null;
}

// ============================================================================
// Deployer types
// ============================================================================

export interface DeployerConfig {
  apiClient: N8NApiClient;
  credentialStore: CredentialStore;
}

export interface DeployerInput {
  workflow_json: N8NWorkflow;
  credential_requirements: CredentialRequirement[];
}

export interface DeployerResult {
  status: 'deployed' | 'error';
  record?: DeploymentRecord;
  error?: DeploymentErrorInfo;
  deployed_at: string;
}

// ============================================================================
// Deployer class
// ============================================================================

/**
 * Deployer orchestrates the full lifecycle of getting a verified workflow
 * into the n8n instance and returning a deployment record.
 *
 * Usage:
 *   const deployer = new Deployer({ apiClient, credentialStore });
 *   const result = await deployer.deploy({ workflow_json, credential_requirements });
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
export class Deployer {
  private readonly apiClient: N8NApiClient;
  private readonly credentialStore: CredentialStore;

  constructor(config: DeployerConfig) {
    this.apiClient = config.apiClient;
    this.credentialStore = config.credentialStore;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Deploy a verified workflow to n8n.
   *
   * Steps:
   *  1. Resolve all required credentials (fail fast on missing)
   *  2. POST workflow to n8n → receive workflow_id
   *  3. POST activate → confirm running
   *  4. Return DeploymentRecord with audit manifest
   *
   * @returns DeployerResult with status 'deployed' (success) or 'error'.
   *          Never throws — all errors are returned as structured results.
   */
  public async deploy(input: DeployerInput): Promise<DeployerResult> {
    const deployedAt = new Date().toISOString();

    // Req 9.2: Resolve credentials before doing any API work
    const credentialResult = this.resolveCredentials(input.credential_requirements);

    if (credentialResult.status === 'missing') {
      return {
        status: 'error',
        error: {
          error_type: 'CREDENTIAL_MISSING',
          message: `Missing credentials: ${credentialResult.missing.join(', ')}`,
          missing_credentials: credentialResult.missing,
        },
        deployed_at: deployedAt,
      };
    }

    // Req 9.1: Deploy the workflow to the n8n instance
    let workflowId: string;

    try {
      const workflowPayload = this.buildWorkflowPayload(
        input.workflow_json,
        credentialResult.resolved
      );
      const createResponse = await this.apiClient.createWorkflow(workflowPayload);
      workflowId = createResponse.id;
    } catch (err) {
      const message = this.extractErrorMessage(err);
      return {
        status: 'error',
        error: {
          error_type: 'DEPLOYMENT_FAILED',
          message: `Failed to create workflow in n8n: ${message}`,
        },
        deployed_at: deployedAt,
      };
    }

    // Req 9.3: Activate the deployed workflow
    let activationStatus: 'active' | 'inactive';

    try {
      const activateResponse = await this.apiClient.activateWorkflow(workflowId);
      activationStatus = activateResponse.active ? 'active' : 'inactive';
    } catch (err) {
      const message = this.extractErrorMessage(err);
      // Workflow was created but activation failed — distinct error type
      return {
        status: 'error',
        error: {
          error_type: 'ACTIVATION_FAILED',
          message: `Workflow ${workflowId} created but activation failed: ${message}`,
        },
        deployed_at: deployedAt,
      };
    }

    // Req 9.5: Build and return the deployment record
    const record: DeploymentRecord = {
      deployment_id: randomUUID(),
      workflow_id: workflowId,
      deployed_at: deployedAt,
      // Manifest records credential *types* injected — not the secret values
      configuration_manifest: this.buildManifest(input.credential_requirements, deployedAt),
      activation_status: activationStatus,
      n8n_workflow_id: workflowId,
    };

    return {
      status: 'deployed',
      record,
      deployed_at: deployedAt,
    };
  }

  // --------------------------------------------------------------------------
  // Credential resolution
  // --------------------------------------------------------------------------

  private resolveCredentials(
    requirements: CredentialRequirement[]
  ):
    | { status: 'resolved'; resolved: Record<string, string> }
    | { status: 'missing'; missing: string[] } {
    const resolved: Record<string, string> = {};
    const missing: string[] = [];

    for (const req of requirements) {
      const value = this.credentialStore.resolve(req.credential_name);
      if (value === null) {
        missing.push(req.credential_name);
      } else {
        resolved[req.credential_name] = value;
      }
    }

    if (missing.length > 0) {
      return { status: 'missing', missing };
    }

    return { status: 'resolved', resolved };
  }

  // --------------------------------------------------------------------------
  // Payload construction
  // --------------------------------------------------------------------------

  /**
   * Merge resolved credentials into the workflow JSON as n8n credential nodes.
   * n8n expects credentials referenced in nodes by name.
   */
  private buildWorkflowPayload(
    workflowJson: N8NWorkflow,
    resolvedCredentials: Record<string, string>
  ): Record<string, unknown> {
    // Cast through unknown — N8NWorkflow has no index signature so TS requires double cast
    const base = workflowJson as unknown as Record<string, unknown>;
    const existingSettings =
      typeof base['settings'] === 'object' && base['settings'] !== null
        ? (base['settings'] as Record<string, unknown>)
        : {};

    return {
      ...base,
      settings: {
        ...existingSettings,
        _resolved_credentials: Object.keys(resolvedCredentials),
      },
    };
  }

  /**
   * Build an audit manifest from credential requirements.
   * Records types and names — never the credential values themselves.
   * Uses the same deployedAt timestamp as the DeploymentRecord for consistency.
   */
  private buildManifest(
    requirements: CredentialRequirement[],
    deployedAt: string
  ): Record<string, unknown> {
    return {
      credential_types_injected: requirements.map(r => ({
        type: r.credential_type,
        name: r.credential_name,
        required_for_step: r.required_for_step,
      })),
      total_credentials: requirements.length,
      deployed_at: deployedAt,
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private extractErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null && 'message' in err) {
      return String((err as Record<string, unknown>)['message']);
    }
    return String(err);
  }
}
