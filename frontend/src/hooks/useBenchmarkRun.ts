import { useState, useRef, useCallback } from 'react';

export interface BenchmarkRunEvent {
  type: 'progress' | 'done' | 'error';
  processed?: number;
  total?: number;
  correct?: number;
  accuracy?: number;
  error?: string;
}

export function useBenchmarkRun() {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0, correct: 0, accuracy: 0 });
  const [error, setError] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const startBenchmark = useCallback(async (
    provider: string, 
    model: string, 
    dataset: string,
    apiKey: string,
    hfToken: string,
    count: number,
    concurrency: number
  ) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    setIsRunning(true);
    setError(null);
    setProgress({ processed: 0, total: 0, correct: 0, accuracy: 0 });

    const startTime = performance.now();

    try {
      const response = await fetch('http://localhost:8080/api/run-benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          dataset,
          api_key: apiKey,
          hf_token: hfToken,
          count,
          concurrency
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;
            
            try {
              const event = JSON.parse(dataStr) as BenchmarkRunEvent;
              if (event.type === 'error' || event.type === 'done') {
                const finalAccuracy = event.accuracy || 0;
                
                if (event.type === 'done') {
                  setProgress({
                    processed: event.processed || 0,
                    total: event.total || 0,
                    correct: event.correct || 0,
                    accuracy: finalAccuracy,
                  });
                }

                try {
                  await fetch('http://localhost:8080/api/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      run_type: 'evaluation',
                      model,
                      provider,
                      ttft_ms: 0,
                      prompt_rate: 0,
                      decode_rate: 0,
                      total_time_ms: performance.now() - startTime,
                      accuracy: finalAccuracy
                    })
                  });
                } catch (e) {
                  console.error('Failed to save benchmark history:', e);
                }

                if (event.type === 'error') {
                  setError(event.error || 'Unknown error');
                }
                setIsRunning(false);
                return;
              } else if (event.type === 'progress') {
                setProgress({
                  processed: event.processed || 0,
                  total: event.total || 0,
                  correct: event.correct || 0,
                  accuracy: event.accuracy || 0,
                });
              }
            } catch (e) {
              console.error('Error parsing SSE:', e);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Benchmark aborted');
      } else {
        setError(err.message);
        setIsRunning(false);
      }
    } finally {
      setIsRunning(false);
    }
  }, []);

  const stopBenchmark = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsRunning(false);
    }
  }, []);

  return {
    isRunning,
    progress,
    error,
    startBenchmark,
    stopBenchmark
  };
}
