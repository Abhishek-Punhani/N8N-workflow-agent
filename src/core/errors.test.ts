/**
 * AI Data Intelligence Platform - Error Hierarchy Tests
 */

import {
  PlatformError,
  PlanningError,
  PromptParsingError,
  PromptTooLongError,
  PromptEmptyError,
  AmbiguousPromptError,
  CapabilityNotInVocabularyError,
  IrGenerationError,
  ValidationError,
  StructuralValidationError,
  InvalidStepTypeError,
  MissingParameterError,
  UndefinedFieldReferenceError,
  CompilationError,
  TemplateNotFoundError,
  NodeAssemblyError,
  ContractViolationError,
  MissingFieldError,
  SandboxExecutionError,
  ExecutionError,
  LogicFailureError,
  InfrastructureFailureError,
  ExternalSourceUnavailableError,
  DeploymentError,
  CredentialMissingError,
  DeploymentFailedError,
  ActivationFailedError,
  formatError,
  formatErrorForLogging,
  formatErrorForResponse,
  isErrorRetryable,
  classifyErrorByType,
} from './errors.js';

// ============================================================================
// Base Error Tests
// ============================================================================

describe('PlatformError', () => {
  test('should create error with message', () => {
    const error = new PlatformError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('PlatformError');
  });

  test('should generate unique errorId for each instance', () => {
    const error1 = new PlatformError('Error 1');
    const error2 = new PlatformError('Error 2');
    expect(error1.errorId).not.toBe(error2.errorId);
  });

  test('should accept context object', () => {
    const context = { step_id: 'step1', param: 'value' };
    const error = new PlatformError('Test error', context);
    expect(error.context).toEqual(context);
  });

  test('should accept retryable parameter', () => {
    const error1 = new PlatformError('Not retryable', {}, false);
    const error2 = new PlatformError('Retryable', {}, true);
    expect(error1.retryable).toBe(false);
    expect(error2.retryable).toBe(true);
  });

  test('should have proper toString format', () => {
    const error = new PlatformError('Test error');
    expect(error.toString()).toMatch(/^PlatformError\[err_/);
  });
});

// ============================================================================
// Planning Error Tests
// ============================================================================

describe('PlanningError', () => {
  test('should be subclass of PlatformError', () => {
    const error = new PlanningError('Planning error');
    expect(error).toBeInstanceOf(PlatformError);
    expect(error.name).toBe('PlanningError');
  });
});

describe('PromptParsingError', () => {
  test('should handle parsed_length context', () => {
    const context = { parsed_length: 15000, max_length: 10000 };
    const error = new PromptParsingError('Prompt too long', context);
    expect(error.context).toEqual(context);
  });
});

describe('PromptTooLongError', () => {
  test('should calculate length correctly', () => {
    const prompt = 'a'.repeat(15000);
    const error = new PromptTooLongError(prompt.length);
    expect(error.context.prompt_length).toBe(15000);
    expect(error.context.max_length).toBe(10000);
  });

  test('should not be retryable', () => {
    const error = new PromptTooLongError(15000);
    expect(error.retryable).toBe(false);
  });
});

describe('PromptEmptyError', () => {
  test('should have empty prompt context', () => {
    const error = new PromptEmptyError();
    expect(error.context.prompt_length).toBe(0);
    expect(error.retryable).toBe(false);
  });
});

describe('AmbiguousPromptError', () => {
  test('should list ambiguities', () => {
    const ambiguities = ['unclear entity', 'ambiguous constraint'];
    const error = new AmbiguousPromptError(ambiguities);
    expect(error.context.ambiguities).toEqual(ambiguities);
  });
});

describe('CapabilityNotInVocabularyError', () => {
  test('should list available capabilities', () => {
    const available = ['Discover', 'Acquire', 'Extract'];
    const error = new CapabilityNotInVocabularyError('Invalid', available);
    expect(error.context.capability).toBe('Invalid');
    expect(error.context.availableCapabilities).toEqual(available);
  });
});

describe('IrGenerationError', () => {
  test('should accept custom context', () => {
    const context = { prompt_hash: 'abc123' };
    const error = new IrGenerationError('Generation failed', context);
    expect(error.context).toEqual(context);
  });
});

// ============================================================================
// Validation Error Tests
// ============================================================================

describe('ValidationError', () => {
  test('should be subclass of PlatformError', () => {
    const error = new ValidationError('Validation error');
    expect(error).toBeInstanceOf(PlatformError);
    expect(error.name).toBe('ValidationError');
  });
});

describe('StructuralValidationError', () => {
  test('should be subclass of ValidationError', () => {
    const error = new StructuralValidationError('Structural error');
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.name).toBe('StructuralValidationError');
  });
});

describe('InvalidStepTypeError', () => {
  test('should report invalid step type', () => {
    const error = new InvalidStepTypeError('step1', 'Invalid', ['Discover', 'Acquire']);
    expect(error.context.step_id).toBe('step1');
    expect(error.context.invalid_type).toBe('Invalid');
    expect(error.retryable).toBe(false);
  });
});

describe('MissingParameterError', () => {
  test('should report missing parameter', () => {
    const error = new MissingParameterError('step1', 'urls', 'Acquire capability');
    expect(error.context.step_id).toBe('step1');
    expect(error.context.parameter).toBe('urls');
    expect(error.context.required_by).toBe('Acquire capability');
  });
});

describe('UndefinedFieldReferenceError', () => {
  test('should report undefined field reference', () => {
    const error = new UndefinedFieldReferenceError('step2', 'source_url', 'step1');
    expect(error.context.step_id).toBe('step2');
    expect(error.context.field).toBe('source_url');
    expect(error.context.source_step).toBe('step1');
  });
});

describe('CompilationError', () => {
  test('should be subclass of ValidationError', () => {
    const error = new CompilationError('Compilation error');
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.name).toBe('CompilationError');
  });
});

describe('TemplateNotFoundError', () => {
  test('should list available templates', () => {
    const available = ['tpl-discover-01', 'tpl-acquire-01'];
    const error = new TemplateNotFoundError('tpl-invalid-01', available);
    expect(error.context.template_id).toBe('tpl-invalid-01');
    expect(error.context.available_templates).toEqual(available);
  });
});

describe('NodeAssemblyError', () => {
  test('should include error details', () => {
    const error = new NodeAssemblyError('node1', 'Missing credentials');
    expect(error.context.node_id).toBe('node1');
    expect(error.context.error).toBe('Missing credentials');
  });
});

describe('ContractViolationError', () => {
  test('should be subclass of ValidationError', () => {
    const error = new ContractViolationError('Contract violation');
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.name).toBe('ContractViolationError');
  });
});

describe('MissingFieldError', () => {
  test('should report missing field', () => {
    const error = new MissingFieldError('source_url', 'Provenance requirement');
    expect(error.context.field).toBe('source_url');
    expect(error.context.required_by).toBe('Provenance requirement');
  });
});

describe('SandboxExecutionError', () => {
  test('should accept custom context', () => {
    const context = { fixture_id: 'fixture1', execution_time_ms: 15000 };
    const error = new SandboxExecutionError('Execution timeout', context);
    expect(error.context).toEqual(context);
  });
});

// ============================================================================
// Execution Error Tests
// ============================================================================

describe('ExecutionError', () => {
  test('should be subclass of PlatformError', () => {
    const error = new ExecutionError('Execution error');
    expect(error).toBeInstanceOf(PlatformError);
    expect(error.name).toBe('ExecutionError');
  });
});

describe('LogicFailureError', () => {
  test('should not be retryable', () => {
    const error = new LogicFailureError('Logic error');
    expect(error.retryable).toBe(false);
  });
});

describe('InfrastructureFailureError', () => {
  test('should be retryable by default', () => {
    const error = new InfrastructureFailureError('Infrastructure error');
    expect(error.retryable).toBe(true);
  });

  test('should accept retryable parameter', () => {
    const error = new InfrastructureFailureError('Error', {}, false);
    expect(error.retryable).toBe(false);
  });
});

describe('ExternalSourceUnavailableError', () => {
  test('should include source information', () => {
    const context = { source: 'api.example.com', sourceType: 'http' };
    const error = new ExternalSourceUnavailableError('Source unavailable', context);
    expect(error.context.source).toBe('api.example.com');
    expect(error.context.sourceType).toBe('http');
  });
});

// ============================================================================
// Deployment Error Tests
// ============================================================================

describe('DeploymentError', () => {
  test('should be subclass of PlatformError', () => {
    const error = new DeploymentError('Deployment error');
    expect(error).toBeInstanceOf(PlatformError);
    expect(error.name).toBe('DeploymentError');
  });
});

describe('CredentialMissingError', () => {
  test('should list missing credentials', () => {
    const credentials = ['API_KEY', 'DATABASE_PASSWORD'];
    const error = new CredentialMissingError(credentials);
    expect(error.context.missing_credentials).toEqual(credentials);
  });
});

describe('DeploymentFailedError', () => {
  test('should accept custom context', () => {
    const context = { deployment_id: 'dep1', n8n_error: 'invalid JSON' };
    const error = new DeploymentFailedError('Deployment failed', context);
    expect(error.context).toEqual(context);
  });
});

describe('ActivationFailedError', () => {
  test('should accept custom context', () => {
    const context = { workflow_id: 'wf1', reason: 'invalid state' };
    const error = new ActivationFailedError('Activation failed', context);
    expect(error.context).toEqual(context);
  });
});

// ============================================================================
// Error Formatting Tests
// ============================================================================

describe('formatError', () => {
  test('should format PlatformError', () => {
    const error = new PlatformError('Test error', { key: 'value' }, true);
    const formatted = formatError(error);

    expect(formatted).toMatchObject({
      type: 'PlatformError',
      message: 'Test error',
      context: { key: 'value' },
      retryable: true,
    });

    expect(formatted.errorId).toBeDefined();
    expect(formatted.timestamp).toBeDefined();
    expect(formatted.stackTrace).toBeDefined();
  });

  test('should convert standard Error to PlatformError', () => {
    const standardError = new Error('Standard error');
    const formatted = formatError(standardError);

    expect(formatted.type).toBe('PlatformError');
    expect(formatted.message).toBe('Standard error');
  });
});

describe('formatErrorForLogging', () => {
  test('should stringify context', () => {
    const error = new PlatformError('Test error', { key: 'value' });
    const formatted = formatErrorForLogging(error);

    expect(typeof formatted.context).toBe('string');
    expect(formatted.context).toBe(JSON.stringify({ key: 'value' }));
  });
});

describe('formatErrorForResponse', () => {
  test('should redact sensitive data', () => {
    const error = new PlatformError('Test error', {
      password: 'secret123',
      token: 'abc456',
      key: 'value',
    });
    const formatted = formatErrorForResponse(error);

    expect(formatted.error.context.password).toBe('[REDAACTED]');
    expect(formatted.error.context.token).toBe('[REDAACTED]');
    expect(formatted.error.context.key).toBe('value');
  });

  test('should have proper response structure', () => {
    const error = new PlatformError('Test error');
    const formatted = formatErrorForResponse(error);

    expect(formatted).toHaveProperty('error');
    expect(formatted.error).toHaveProperty('id');
    expect(formatted.error).toHaveProperty('type');
    expect(formatted.error).toHaveProperty('message');
    expect(formatted.error).toHaveProperty('context');
    expect(formatted.error).toHaveProperty('retryable');
    expect(formatted).toHaveProperty('timestamp');
  });
});

// ============================================================================
// Error Utilities Tests
// ============================================================================

describe('isErrorRetryable', () => {
  test('should return retryable status', () => {
    const retryableError = new PlatformError('Error', {}, true);
    const nonRetryableError = new PlatformError('Error', {}, false);

    expect(isErrorRetryable(retryableError)).toBe(true);
    expect(isErrorRetryable(nonRetryableError)).toBe(false);
  });

  test('should return false for standard errors', () => {
    const standardError = new Error('Standard error');
    expect(isErrorRetryable(standardError)).toBe(false);
  });
});

describe('classifyErrorByType', () => {
  test('should return error type', () => {
    const error = new PromptTooLongError(15000);
    expect(classifyErrorByType(error)).toBe('PromptTooLongError');
  });

  test('should return UnknownError for standard errors', () => {
    const standardError = new Error('Standard error');
    expect(classifyErrorByType(standardError)).toBe('UnknownError');
  });
});
