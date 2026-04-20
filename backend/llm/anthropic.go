package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type AnthropicProvider struct{}

func (p *AnthropicProvider) Stream(ctx context.Context, req StreamRequest, eventChan chan<- StreamEvent) error {
	url := "https://api.anthropic.com/v1/messages"

	body := map[string]interface{}{
		"model": MapModel(req.Model),
		"messages": []map[string]string{
			{"role": "user", "content": req.Prompt},
		},
		"max_tokens": 4096,
		"stream":     true,
	}
	bodyBytes, _ := json.Marshal(body)

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", req.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("anthropic api error: status %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")

		var chunk map[string]interface{}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		eventType, _ := chunk["type"].(string)

		switch eventType {
		case "message_start":
			if message, ok := chunk["message"].(map[string]interface{}); ok {
				if usage, ok := message["usage"].(map[string]interface{}); ok {
					if inputTokens, ok := usage["input_tokens"].(float64); ok {
						eventChan <- StreamEvent{
							Type:         "usage",
							PromptTokens: int(inputTokens),
							TimestampMs:  time.Now().UnixMilli(),
						}
					}
				}
			}
		case "content_block_delta":
			if delta, ok := chunk["delta"].(map[string]interface{}); ok {
				if text, ok := delta["text"].(string); ok {
					eventChan <- StreamEvent{
						Type:        "chunk",
						Text:        text,
						TimestampMs: time.Now().UnixMilli(),
					}
				}
			}
		case "message_delta":
			if usage, ok := chunk["usage"].(map[string]interface{}); ok {
				if outputTokens, ok := usage["output_tokens"].(float64); ok {
					eventChan <- StreamEvent{
						Type:         "usage",
						DecodeTokens: int(outputTokens),
						TimestampMs:  time.Now().UnixMilli(),
					}
				}
			}
		}
	}

	return scanner.Err()
}
