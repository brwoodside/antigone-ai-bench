package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// MapModel converts a frontend/mock model name to the real API model name
func MapModel(model string) string {
	switch model {
	case "gpt-5.4", "gpt-5.4-pro":
		return "gpt-4o"
	case "gpt-5.4-mini":
		return "gpt-4o-mini"
	case "claude-sonnet-4-6":
		return "claude-3-5-sonnet-latest"
	case "claude-opus-4-7":
		return "claude-3-opus-latest"
	case "claude-haiku-4-5":
		return "claude-3-5-haiku-latest"
	case "gemini-3.1-pro", "gemini-2.5-pro":
		return "gemini-1.5-pro-latest"
	case "gemini-3.1-flash":
		return "gemini-1.5-flash-latest"
	}
	return model
}

// StreamClient is used for provider SSE streams. It times out only on waiting for
// response headers; once the stream is established, individual chunks can take as
// long as the model needs.
var StreamClient = &http.Client{
	Transport: &http.Transport{
		ResponseHeaderTimeout: 60 * time.Second,
		IdleConnTimeout:       90 * time.Second,
	},
}

// HTTPClient is used for non-streaming provider calls (model listings etc.).
var HTTPClient = &http.Client{Timeout: 30 * time.Second}

type ModelInfo struct {
	ID string `json:"id"`
}

func FetchModels(ctx context.Context, provider, apiKey string) ([]ModelInfo, error) {
	var models []ModelInfo

	switch provider {
	case "openai":
		req, err := http.NewRequestWithContext(ctx, "GET", "https://api.openai.com/v1/models", nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)
		resp, err := HTTPClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("openai error: %d", resp.StatusCode)
		}

		var data struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
			return nil, err
		}
		for _, m := range data.Data {
			if strings.HasPrefix(m.ID, "gpt-") || strings.HasPrefix(m.ID, "o1-") {
				models = append(models, ModelInfo{ID: m.ID})
			}
		}
	case "anthropic":
		req, err := http.NewRequestWithContext(ctx, "GET", "https://api.anthropic.com/v1/models", nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
		resp, err := HTTPClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("anthropic error: %d", resp.StatusCode)
		}

		var data struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
			return nil, err
		}
		for _, m := range data.Data {
			models = append(models, ModelInfo{ID: m.ID})
		}
	case "gemini":
		req, err := http.NewRequestWithContext(ctx, "GET", "https://generativelanguage.googleapis.com/v1beta/models", nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("x-goog-api-key", apiKey)
		resp, err := HTTPClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("gemini error: %d", resp.StatusCode)
		}

		var data struct {
			Models []struct {
				Name string `json:"name"`
			} `json:"models"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
			return nil, err
		}
		for _, m := range data.Models {
			id := strings.TrimPrefix(m.Name, "models/")
			models = append(models, ModelInfo{ID: id})
		}
	default:
		return nil, fmt.Errorf("unknown provider")
	}

	return models, nil
}

type StreamRequest struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Prompt   string `json:"prompt"`
	APIKey   string `json:"api_key"`
}

type StreamEvent struct {
	Type         string `json:"type"` // "chunk", "usage", "error", "done"
	Text         string `json:"text,omitempty"`
	Error        string `json:"error,omitempty"`
	PromptTokens int    `json:"prompt_tokens,omitempty"`
	DecodeTokens int    `json:"decode_tokens,omitempty"`
	TimestampMs  int64  `json:"timestamp_ms,omitempty"`
}

type Provider interface {
	Stream(ctx context.Context, req StreamRequest, eventChan chan<- StreamEvent) error
}

func Complete(ctx context.Context, p Provider, req StreamRequest) (string, error) {
	eventChan := make(chan StreamEvent, 100)
	errChan := make(chan error, 1)

	go func() {
		err := p.Stream(ctx, req, eventChan)
		if err != nil {
			errChan <- err
		}
		close(eventChan)
		close(errChan)
	}()

	var fullText string
	var errStr string

	for eventChan != nil || errChan != nil {
		select {
		case <-ctx.Done():
			return fullText, ctx.Err()
		case ev, ok := <-eventChan:
			if !ok {
				eventChan = nil
			} else {
				if ev.Type == "chunk" {
					fullText += ev.Text
				} else if ev.Type == "error" {
					errStr = ev.Error
				}
			}
		case err, ok := <-errChan:
			if !ok {
				errChan = nil
			} else if err != nil {
				return fullText, err
			}
		}
	}

	if errStr != "" {
		return fullText, fmt.Errorf("%s", errStr)
	}
	return fullText, nil
}
