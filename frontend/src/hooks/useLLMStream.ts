import { useState, useRef } from 'react';

export type MetricPoint = {
  time: number; // offset from start in ms
  rate: number; // tokens per second
};

export type StreamState = {
  text: string;
  isStreaming: boolean;
  ttft: number | null; // ms
  promptRate: number | null; // tokens/s
  decodeRate: number | null; // tokens/s
  chartData: MetricPoint[];
  error: string | null;
  isLivePromptRate: boolean;
  isLiveDecodeRate: boolean;
};

export function useLLMStream() {
  const [state, setState] = useState<StreamState>({
    text: '',
    isStreaming: false,
    ttft: null,
    promptRate: null,
    decodeRate: null,
    chartData: [],
    error: null,
    isLivePromptRate: false,
    isLiveDecodeRate: false,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const startStream = async (provider: string, model: string, prompt: string, apiKey: string) => {
    setState({
      text: '',
      isStreaming: true,
      ttft: null,
      promptRate: null,
      decodeRate: null,
      chartData: [],
      error: null,
      isLivePromptRate: true,
      isLiveDecodeRate: true,
    });

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const startTime = performance.now();
    let firstTokenTime: number | null = null;
    let totalTextLength = 0;
    const initialChartData: MetricPoint[] = [];

    let currentTokensCount = 0;
    let lastChartUpdateTime = startTime;
    let actualPromptTokens: number | null = null;
    let actualDecodeTokens: number | null = null;
    
    const estimatedPromptTokens = Math.floor(prompt.length / 4);
    
    let finalTtft = 0;
    let finalPromptRate = 0;
    let finalDecodeRate = 0;

    try {
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, prompt, api_key: apiKey }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6);
            if (dataStr === '[DONE]') continue;

            try {
              const event = JSON.parse(dataStr);
              const now = performance.now();

              if (event.type === 'error' || event.type === 'done') {
                const finalTotalTime = performance.now() - startTime;
                try {
                  await fetch('http://localhost:8080/api/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      run_type: 'stream',
                      model,
                      provider,
                      ttft_ms: finalTtft,
                      prompt_rate: finalPromptRate,
                      decode_rate: finalDecodeRate,
                      total_time_ms: finalTotalTime,
                      accuracy: 0
                    })
                  });
                } catch (e) {
                  console.error('Failed to save history:', e);
                }

                if (event.type === 'error') {
                  setState(s => ({ ...s, error: event.error, isStreaming: false, isLiveDecodeRate: false, isLivePromptRate: false }));
                } else {
                  setState(s => ({ ...s, isStreaming: false, isLiveDecodeRate: false, isLivePromptRate: false }));
                }
                return;
              }

              if (event.type === 'usage') {
                if (event.prompt_tokens) actualPromptTokens = event.prompt_tokens;
                if (event.decode_tokens) actualDecodeTokens = event.decode_tokens;
                
                setState(s => {
                  const updates: Partial<StreamState> = {};
                  if (actualPromptTokens && firstTokenTime) {
                    const elapsedToFirst = (firstTokenTime - startTime) / 1000;
                    if (elapsedToFirst > 0) {
                      finalPromptRate = actualPromptTokens / elapsedToFirst;
                      updates.promptRate = finalPromptRate;
                      updates.isLivePromptRate = false;
                    }
                  }
                  if (actualDecodeTokens && firstTokenTime) {
                    const elapsedDecode = (now - firstTokenTime) / 1000;
                    if (elapsedDecode > 0) {
                      finalDecodeRate = actualDecodeTokens / elapsedDecode;
                      updates.decodeRate = finalDecodeRate;
                      updates.isLiveDecodeRate = false;
                    }
                  }
                  return { ...s, ...updates };
                });
              }

              if (event.type === 'chunk') {
                if (!firstTokenTime) {
                  firstTokenTime = now;
                  finalTtft = firstTokenTime - startTime;
                  const pt = actualPromptTokens || estimatedPromptTokens;
                  finalPromptRate = pt / (finalTtft / 1000);
                  lastChartUpdateTime = now;
                  
                  setState(s => ({ 
                    ...s, 
                    ttft: finalTtft,
                    promptRate: finalPromptRate,
                    isLivePromptRate: !actualPromptTokens
                  }));
                }

                if (event.text) {
                  totalTextLength += event.text.length;
                  currentTokensCount = actualDecodeTokens || Math.floor(totalTextLength / 4);

                  setState(s => ({ ...s, text: s.text + event.text }));
                }
              }

              if (now - lastChartUpdateTime > 200 && firstTokenTime) {
                const elapsedDecode = (now - firstTokenTime) / 1000;
                if (elapsedDecode > 0) {
                  const currentRate = currentTokensCount / elapsedDecode;
                  finalDecodeRate = currentRate;
                  initialChartData.push({ time: elapsedDecode, rate: currentRate });
                  
                  setState(s => {
                    const updates: Partial<StreamState> = { chartData: [...initialChartData] };
                    if (s.isLiveDecodeRate) {
                       updates.decodeRate = currentRate;
                    }
                    return { ...s, ...updates };
                  });
                  lastChartUpdateTime = now;
                }
              }
            } catch (e) {
              console.error("Error parsing SSE event", e);
            }
          }
        }
      }

      setState(s => ({ ...s, isStreaming: false, isLiveDecodeRate: false, isLivePromptRate: false }));

    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setState(s => ({ ...s, error: e.message || 'Stream failed', isStreaming: false, isLiveDecodeRate: false, isLivePromptRate: false }));
      }
    }
  };

  const stopStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setState(s => ({ ...s, isStreaming: false, isLiveDecodeRate: false, isLivePromptRate: false }));
  };

  return { ...state, startStream, stopStream };
}
