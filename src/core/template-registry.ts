/**
 * AI Data Intelligence Platform - Template Registry
 *
 * Maps capability types to n8n node templates and provides validation
 */

import type { CapabilityType } from './types.js';
import type { N8NNode, N8NWorkflow } from './types.js';

// ============================================================================
// Template Registry
// ============================================================================

/**
 * Template configuration for each capability type
 */
export interface TemplateConfig {
  template_id: string;
  node_type: string;
  description: string;
  required_params: string[];
  optional_params?: string[];
}

/**
 * Template Registry mapping capability types to n8n node templates
 */
export const TEMPLATE_REGISTRY: Record<CapabilityType, TemplateConfig> = {
  Discover: {
    template_id: 'tpl-discover-01',
    node_type: 'n8n-nodes-base.HTTPRequest',
    description: 'HTTP Request + HTML Extract for discovery',
    required_params: ['url', 'method', 'extractData'],
  },
  Acquire: {
    template_id: 'tpl-acquire-01',
    node_type: 'n8n-nodes-base.HTTPRequest',
    description: 'HTTP Request for content acquisition',
    required_params: ['url', 'method'],
  },
  Extract: {
    template_id: 'tpl-extract-01',
    node_type: 'n8n-nodes-base.Code',
    description: 'Code Node for JSON parsing',
    required_params: ['json', 'code'],
  },
  Transform: {
    template_id: 'tpl-transform-01',
    node_type: 'n8n-nodes-base.Code',
    description: 'Code Node for field mapping',
    required_params: ['items', 'code'],
  },
  Enrich: {
    template_id: 'tpl-enrich-01',
    node_type: 'n8n-nodes-base.HTTPRequest',
    description: 'HTTP Request + Merge for data enrichment',
    required_params: ['url', 'merge'],
  },
  Resolve: {
    template_id: 'tpl-resolve-01',
    node_type: 'n8n-nodes-base.Code',
    description: 'Code Node for deduplication',
    required_params: ['items', 'dedupeKey'],
  },
  Filter: {
    template_id: 'tpl-filter-01',
    node_type: 'n8n-nodes-base.Filter',
    description: 'Filter Node for record filtering',
    required_params: ['conditions'],
  },
  Validate: {
    template_id: 'tpl-validate-01',
    node_type: 'n8n-nodes-base.Code',
    description: 'Code Node for data validation',
    required_params: ['items', 'validationRules'],
  },
  Provenance: {
    template_id: 'tpl-provenance-01',
    node_type: 'n8n-nodes-base.Code',
    description: 'Code Node for metadata attachment',
    required_params: ['items', 'metadata'],
  },
  Persist: {
    template_id: 'tpl-persist-01',
    node_type: 'n8n-nodes-base.Postgres',
    description: 'Database/Storage Node for persistence',
    required_params: ['tableName', 'data'],
  },
  Deliver: {
    template_id: 'tpl-deliver-01',
    node_type: 'n8n-nodes-base.Webhook',
    description: 'Respond to Webhook for delivery',
    required_params: ['httpMethod', 'responseMode'],
  },
};

/**
 * Get template configuration by capability type
 */
export function getTemplateConfig(capabilityType: CapabilityType): TemplateConfig {
  const config = TEMPLATE_REGISTRY[capabilityType];
  if (!config) {
    throw new Error(`Template configuration not found for capability: ${capabilityType}`);
  }
  return config;
}

/**
 * Get all template IDs
 */
export function getAllTemplateIds(): string[] {
  return Object.values(TEMPLATE_REGISTRY).map(config => config.template_id);
}

/**
 * Get template ID by capability type
 */
export function getTemplateId(capabilityType: CapabilityType): string {
  return TEMPLATE_REGISTRY[capabilityType].template_id;
}

/**
 * Check if a template ID exists in the registry
 */
export function hasTemplateId(templateId: string): boolean {
  return Object.values(TEMPLATE_REGISTRY).some(config => config.template_id === templateId);
}

// ============================================================================
// Template Validation Functions
// ============================================================================

/**
 * Validate that a template configuration is complete and correct
 */
export function validateTemplateConfig(templateConfig: TemplateConfig): boolean {
  const requiredFields: (keyof TemplateConfig)[] = [
    'template_id',
    'node_type',
    'description',
    'required_params',
  ];

  for (const field of requiredFields) {
    if (!templateConfig[field]) {
      return false;
    }
  }

  // Validate template_id format (tpl-xxx-xx)
  if (!/^tpl-[a-z]+-\d{2}$/.test(templateConfig.template_id)) {
    return false;
  }

  // Validate required_params is non-empty array
  if (
    !Array.isArray(templateConfig.required_params) ||
    templateConfig.required_params.length === 0
  ) {
    return false;
  }

  return true;
}

/**
 * Validate that a capability type has a valid template mapping
 */
export function validateCapabilityTemplate(capabilityType: CapabilityType): boolean {
  try {
    const config = getTemplateConfig(capabilityType);
    return validateTemplateConfig(config);
  } catch (error) {
    return false;
  }
}

/**
 * Validate that all templates in the registry are properly configured
 */
export function validateAllTemplates(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [capabilityType, config] of Object.entries(TEMPLATE_REGISTRY)) {
    if (!validateTemplateConfig(config)) {
      errors.push(`Invalid template configuration for capability: ${capabilityType}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Node Assembly Functions
// ============================================================================

/**
 * Create an n8n node from a template configuration
 */
export function createNodeFromTemplate(
  capabilityType: CapabilityType,
  nodeId: string,
  nodeParameters: Record<string, any>,
  position: [number, number] = [0, 0]
): N8NNode {
  const templateConfig = getTemplateConfig(capabilityType);

  return {
    id: nodeId,
    name: `${capabilityType}-${nodeId.slice(0, 8)}`,
    type: templateConfig.node_type,
    typeVersion: 1,
    position,
    parameters: nodeParameters,
  };
}

/**
 * Assemble an n8n workflow from a list of capability steps
 */
export function assembleWorkflow(
  capabilitySteps: Array<{
    capabilityType: CapabilityType;
    parameters: Record<string, any>;
    nodeId: string;
    position?: [number, number];
  }>
): N8NWorkflow {
  const nodes: N8NNode[] = [];
  const connections: N8NWorkflow['connections'] = {};

  for (const [index, step] of capabilitySteps.entries()) {
    const node = createNodeFromTemplate(
      step.capabilityType,
      step.nodeId,
      step.parameters,
      step.position ?? [index * 200, 100]
    );

    nodes.push(node);

    // Add connections from previous node (if exists)
    if (index > 0) {
      const prevNode = capabilitySteps[index - 1];
      const prevNodeId = prevNode.nodeId;

      if (!connections[prevNodeId]) {
        connections[prevNodeId] = {};
      }
      if (!connections[prevNodeId]['main']) {
        connections[prevNodeId]['main'] = [];
      }

      connections[prevNodeId]['main'].push({
        node: node.name,
        type: 'main',
        index: 0,
      });
    }
  }

  return {
    name: 'Data Intelligence Workflow',
    nodes,
    connections,
    settings: {},
    staticData: {
      version: 1,
    },
  };
}

// ============================================================================
// Validation Results
// ============================================================================

export interface TemplateValidationResult {
  isValid: boolean;
  templateId?: string;
  errors: string[];
  warnings: string[];
}

/**
 * Validate workflow against template registry
 */
export function validateWorkflowAgainstRegistry(workflow: N8NWorkflow): TemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if workflow has nodes
  if (!workflow.nodes || workflow.nodes.length === 0) {
    errors.push('Workflow has no nodes');
    return { isValid: false, errors, warnings };
  }

  // Validate each node against registry
  for (const node of workflow.nodes) {
    const capabilityType = Object.entries(TEMPLATE_REGISTRY).find(
      ([_, config]) => config.node_type === node.type
    )?.[0] as CapabilityType | undefined;

    if (!capabilityType) {
      errors.push(`Node type '${node.type}' is not in capability template registry`);
      continue;
    }

    // Check required parameters
    const templateConfig = getTemplateConfig(capabilityType);
    for (const requiredParam of templateConfig.required_params) {
      if (!(requiredParam in node.parameters)) {
        errors.push(
          `Node '${node.name}' is missing required parameter '${requiredParam}' for capability '${capabilityType}'`
        );
      }
    }
  }

  return {
    isValid: errors.length === 0,
    templateId: undefined,
    errors,
    warnings,
  };
}

// ============================================================================
// Export
// ============================================================================
