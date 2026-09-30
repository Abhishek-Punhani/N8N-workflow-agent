import { WorkflowPlanner } from '../src/plan/workflow-planner.js';

function hangingClient() {
  return {
    complete: async (_s: string, _u: string, signal: AbortSignal) => {
      return new Promise<string>((_, reject) => {
        const onAbort = () => reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort);
      });
    }
  };
}

async function runProfile() {
  console.log('--- Profiling LLM Timeout Behavior ---');
  // Initialize with a short timeout to profile abort behavior
  const planner = new WorkflowPlanner({
    llmClient: hangingClient(),
    timeoutMs: 1500
  });

  const start = performance.now();
  try {
    await planner.plan({ objective: 'Test timeout profiling' } as any);
  } catch (err: any) {
    const end = performance.now();
    console.log(`Caught Error: ${err.message}`);
    console.log(`Time elapsed: ${(end - start).toFixed(2)} ms (Expected ~1500 ms)`);
    if (Math.abs((end - start) - 1500) < 100) {
      console.log('✅ Timeout behavior is accurate and within acceptable bounds.');
    } else {
      console.error('❌ Timeout behavior is inaccurate.');
    }
  }
}

runProfile().catch(console.error);
