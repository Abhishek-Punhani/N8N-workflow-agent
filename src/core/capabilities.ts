/**
 * AI Data Intelligence Platform - Capability Vocabulary
 *
 * Defines utility functions and configurations for the capability vocabulary
 * Core definitions (CapabilityType, CapabilityDefinition, CAPABILITY_VOCABULARY) are in types.ts
 */

import { CAPABILITY_VOCABULARY } from './types.js';
import type { CapabilityType, CapabilityDefinition } from './types.js';

/**
 * Get capability definition by type
 */
export function getCapabilityDefinition(type: CapabilityType): CapabilityDefinition {
  const definition = CAPABILITY_VOCABULARY[type];
  if (!definition) {
    throw new Error(`Capability type '${type}' not found in vocabulary`);
  }
  return definition;
}

/**
 * Validate that a capability type is in the closed vocabulary
 */
export function isValidCapabilityType(type: string): type is CapabilityType {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_VOCABULARY, type);
}

/**
 * Get all capability types
 */
export function getCapabilityTypes(): CapabilityType[] {
  return Object.keys(CAPABILITY_VOCABULARY) as CapabilityType[];
}

/**
 * Check if a capability requires input records
 */
export function requiresInputRecords(capabilityType: CapabilityType): boolean {
  const definition = getCapabilityDefinition(capabilityType);
  const inputParams = Object.entries(definition.requiredParameters);

  // Most capabilities process records, except Discover, Provenance, and Deliver
  const recordProcessors = [
    'Extract',
    'Transform',
    'Enrich',
    'Resolve',
    'Filter',
    'Validate',
    'Persist',
  ];

  return (
    recordProcessors.includes(capabilityType) ||
    inputParams.some(([_, type]) => type.includes('object[]'))
  );
}
