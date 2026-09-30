/**
 * AI Data Intelligence Platform - Deployer Integration Tests (Task 5.2)
 *
 * Tests Deployer in isolation using a MockN8NApiClient and MockCredentialStore.
 * No real network calls. Covers:
 *  - Successful deployment + activation + record (Req 9.1, 9.2, 9.3, 9.5)
 *  - Credential missing error with specific names (Req 9.4)
 *  - Multiple missing credentials reported at once (Req 9.4)
 *  - Deployment API failure (DEPLOYMENT_FAILED)
 *  - Activation failure (ACTIVATION_FAILED) — workflow created but not active
 *  - Deployment record format verification (Req 9.5)
 *  - configuration_manifest records types/names, never secret values (Req 9.5)
 *  - n8n workflow ID preserved in deployment record
 *  - No credentials required — deploys without resolution step
 *  - Partial credential resolution (some present, some missing)
 */

import { Deployer } from './deployer.js';
import type { DeployerInput, CredentialStore } from './deployer.js';
import type {
  N8NApiClient,
  N8NWorkflowCreateResponse,
  N8NWorkflowActivateResponse,
} from './n8n-api-client.js';
import type { N8NWorkflow, CredentialRequirement } from '../core/types.js';

// ============================================================================
// Mock helpers
// ============================================================================

function mockApiClient(overrides: Partial<N8NApiClient> = {}): N8NApiClient {
  return {
    createWorkflow: jest.fn().mockResolvedValue({
      id: 'n8n-wf-001',
      name: 'Test Workflow',
      active: false,
    } satisfies N8NWorkflowCreateResponse),
    activateWorkflow: jest.fn().mockResolvedValue({
      id: 'n8n-wf-001',
      active: true,
    } satisfies N8NWorkflowActivateResponse),
    ...overrides,
  };
}

function mockCredentialStore(store: Record<string, string> = {}): CredentialStore {
  return {
    resolve: jest.fn().mockImplementation((name: string) => store[name] ?? null),
  };
}

/** Minimal valid N8NWorkflow for testing. */
const sampleWorkflow: N8NWorkflow = {
  name: 'AI Startup Data Collection',
  nodes: [
    {
      id: 'node-1',
      name: 'HTTP Request',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 1,
      parameters: { url: 'https://example.com', method: 'GET' },
      position: [0, 0],
    },
  ],
  connections: {},
  settings: {},
};

const sampleCredentials: CredentialRequirement[] = [
  {
    credential_type: 'httpBasicAuth',
    credential_name: 'CRUNCHBASE_API_KEY',
    required_for_step: 'step-acquire-1',
  },
  {
    credential_type: 'oauth2',
    credential_name: 'LINKEDIN_OAUTH',
    required_for_step: 'step-acquire-2',
  },
];

function makeInput(overrides: Partial<DeployerInput> = {}): DeployerInput {
  return {
    workflow_json: sampleWorkflow,
    credential_requirements: sampleCredentials,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Deployer — Successful Deployment', () => {
  test('returns status deployed on full success', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    expect(result.status).toBe('deployed');
    expect(result.error).toBeUndefined();
  });

  test('returns a DeploymentRecord on success (Req 9.5)', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    expect(result.record).toBeDefined();
    expect(result.record!.deployment_id).toBeTruthy();
    expect(result.record!.workflow_id).toBe('n8n-wf-001');
    expect(result.record!.n8n_workflow_id).toBe('n8n-wf-001');
    expect(result.record!.activation_status).toBe('active');
    expect(result.record!.deployed_at).toBeTruthy();
  });

  test('deployment_id is a UUID', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(result.record!.deployment_id)).toBe(true);
  });

  test('deployed_at is a valid ISO timestamp', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    const date = new Date(result.deployed_at);
    expect(date.toString()).not.toBe('Invalid Date');
  });

  test('createWorkflow is called with workflow payload', async () => {
    const apiClient = mockApiClient();
    const deployer = new Deployer({
      apiClient,
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    await deployer.deploy(makeInput());

    expect(apiClient.createWorkflow).toHaveBeenCalledTimes(1);
    const payload = (apiClient.createWorkflow as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload['name']).toBe('AI Startup Data Collection');
  });

  test('activateWorkflow is called with the workflow ID from createWorkflow', async () => {
    const apiClient = mockApiClient();
    const deployer = new Deployer({
      apiClient,
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    await deployer.deploy(makeInput());

    expect(apiClient.activateWorkflow).toHaveBeenCalledWith('n8n-wf-001');
  });
});

describe('Deployer — Credential Resolution (Req 9.2, 9.4)', () => {
  test('returns CREDENTIAL_MISSING when one credential is not resolved', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        // LINKEDIN_OAUTH intentionally missing
      }),
    });

    const result = await deployer.deploy(makeInput());

    expect(result.status).toBe('error');
    expect(result.error!.error_type).toBe('CREDENTIAL_MISSING');
    expect(result.error!.missing_credentials).toContain('LINKEDIN_OAUTH');
  });

  test('returns all missing credential names at once', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({}), // empty — both missing
    });

    const result = await deployer.deploy(makeInput());

    expect(result.error!.error_type).toBe('CREDENTIAL_MISSING');
    expect(result.error!.missing_credentials).toHaveLength(2);
    expect(result.error!.missing_credentials).toContain('CRUNCHBASE_API_KEY');
    expect(result.error!.missing_credentials).toContain('LINKEDIN_OAUTH');
  });

  test('does NOT call n8n API when credentials are missing', async () => {
    const apiClient = mockApiClient();
    const deployer = new Deployer({
      apiClient,
      credentialStore: mockCredentialStore({}),
    });

    await deployer.deploy(makeInput());

    expect(apiClient.createWorkflow).not.toHaveBeenCalled();
    expect(apiClient.activateWorkflow).not.toHaveBeenCalled();
  });

  test('deploys successfully when no credentials are required', async () => {
    const apiClient = mockApiClient();
    const deployer = new Deployer({
      apiClient,
      credentialStore: mockCredentialStore({}),
    });

    const result = await deployer.deploy(makeInput({ credential_requirements: [] }));

    expect(result.status).toBe('deployed');
    expect(apiClient.createWorkflow).toHaveBeenCalledTimes(1);
  });
});

describe('Deployer — Deployment Record configuration_manifest (Req 9.5)', () => {
  test('configuration_manifest lists credential types and names injected', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'secret-value-should-not-appear',
        LINKEDIN_OAUTH: 'another-secret',
      }),
    });

    const result = await deployer.deploy(makeInput());
    const manifest = result.record!.configuration_manifest;

    expect(Array.isArray(manifest['credential_types_injected'])).toBe(true);
    const types = manifest['credential_types_injected'] as Array<Record<string, unknown>>;
    expect(types).toHaveLength(2);
    expect(types[0]!['type']).toBe('httpBasicAuth');
    expect(types[0]!['name']).toBe('CRUNCHBASE_API_KEY');
  });

  test('configuration_manifest does NOT contain actual credential values', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'super-secret-key-12345',
        LINKEDIN_OAUTH: 'another-secret-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());
    const manifestStr = JSON.stringify(result.record!.configuration_manifest);

    expect(manifestStr).not.toContain('super-secret-key-12345');
    expect(manifestStr).not.toContain('another-secret-xyz');
  });

  test('total_credentials count in manifest matches requirements', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'k1',
        LINKEDIN_OAUTH: 'k2',
      }),
    });

    const result = await deployer.deploy(makeInput());
    expect(result.record!.configuration_manifest['total_credentials']).toBe(2);
  });
});

describe('Deployer — API Failures', () => {
  test('returns DEPLOYMENT_FAILED when createWorkflow throws', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient({
        createWorkflow: jest.fn().mockRejectedValue(new Error('n8n API unavailable')),
      }),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    expect(result.status).toBe('error');
    expect(result.error!.error_type).toBe('DEPLOYMENT_FAILED');
    expect(result.error!.message).toContain('n8n API unavailable');
  });

  test('returns ACTIVATION_FAILED when activateWorkflow throws', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient({
        activateWorkflow: jest.fn().mockRejectedValue(new Error('Activation service down')),
      }),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    expect(result.status).toBe('error');
    expect(result.error!.error_type).toBe('ACTIVATION_FAILED');
    expect(result.error!.message).toContain('n8n-wf-001');
    expect(result.error!.message).toContain('Activation service down');
  });

  test('ACTIVATION_FAILED does NOT call activateWorkflow on an already-failed create', async () => {
    const apiClient = mockApiClient({
      createWorkflow: jest.fn().mockRejectedValue(new Error('Create failed')),
    });

    const deployer = new Deployer({
      apiClient,
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    await deployer.deploy(makeInput());

    // activate must NOT have been called if create failed
    expect(apiClient.activateWorkflow).not.toHaveBeenCalled();
  });

  test('returns error result even when API throws a non-Error object', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient({
        createWorkflow: jest
          .fn()
          .mockRejectedValue({ message: 'Structured API error', status: 503 }),
      }),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    expect(result.status).toBe('error');
    expect(result.error!.error_type).toBe('DEPLOYMENT_FAILED');
  });

  test('returns inactive activation_status when activateWorkflow returns active=false', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient({
        activateWorkflow: jest.fn().mockResolvedValue({ id: 'n8n-wf-001', active: false }),
      }),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    // Deployed but not active — status is still 'deployed'
    expect(result.status).toBe('deployed');
    expect(result.record!.activation_status).toBe('inactive');
  });
});

describe('Deployer — Timestamp Consistency', () => {
  test('record.deployed_at and manifest.deployed_at are identical', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    // Both timestamps must originate from the same captured deployedAt — no clock drift
    expect(result.record!.deployed_at).toBe(result.record!.configuration_manifest['deployed_at']);
  });

  test('result.deployed_at matches record.deployed_at', async () => {
    const deployer = new Deployer({
      apiClient: mockApiClient(),
      credentialStore: mockCredentialStore({
        CRUNCHBASE_API_KEY: 'key-abc',
        LINKEDIN_OAUTH: 'oauth-xyz',
      }),
    });

    const result = await deployer.deploy(makeInput());

    expect(result.deployed_at).toBe(result.record!.deployed_at);
  });
});
