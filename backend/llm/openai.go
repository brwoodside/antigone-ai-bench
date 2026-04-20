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

type OpenAIProvider struct{}

func (p *OpenAIProvider) Stream(ctx context.Context, req StreamRequest, eventChan chan<- StreamEvent) error {
	url := "https://api.openai.com/v1/chat/completions"

	body := map[string]interface{}{
		"model": MapModel(req.Model),
		"messages": []map[string]string{
			{"role": "user", "content": req.Prompt},
		},
		"stream": true,
		"stream_options": map[string]interface{}{
			"include_usage": true,
		},
	}
	bodyBytes, _ := json.Marshal(body)

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)

	resp, err := StreamClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("openai api error: status %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			} `json:"usage"`
		}

		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		if chunk.Usage != nil {
			eventChan <- StreamEvent{
				Type:         "usage",
				PromptTokens: chunk.Usage.PromptTokens,
				DecodeTokens: chunk.Usage.CompletionTokens,
				TimestampMs:  time.Now().UnixMilli(),
			}
		} else if len(chunk.Choices) > 0 {
			eventChan <- StreamEvent{
				Type:        "chunk",
				Text:        chunk.Choices[0].Delta.Content,
				TimestampMs: time.Now().UnixMilli(),
			}
		}
	}

	return scanner.Err()
}
