package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"antigone-llm-bench-backend/benchmark"
	"antigone-llm-bench-backend/db"
	"antigone-llm-bench-backend/llm"

	"github.com/rs/cors"
)

const (
	maxRequestBody = 1 << 20 // 1 MiB
	maxPromptLen   = 100_000
	maxModelLen    = 200
	maxBenchCount  = 1000
	maxConcurrency = 32
)

var validProviders = map[string]bool{
	"openai":    true,
	"anthropic": true,
	"gemini":    true,
}

var validDatasets = map[string]bool{
	"cais/mmlu":                     true,
	"TIGER-Lab/MMLU-Pro":            true,
	"gsm8k":                         true,
	"Rowan/hellaswag":               true,
	"truthful_qa":                   true,
	"princeton-nlp/SWE-bench_Lite":  true,
	"web_arena":                     true,
	"THUDM/AgentBench":              true,
}

var validRunTypes = map[string]bool{
	"stream":     true,
	"evaluation": true,
	"simulated":  true,
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	http.Error(w, msg, status)
}

func chatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)

	var req llm.StreamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if !validProviders[req.Provider] {
		writeJSONError(w, http.StatusBadRequest, "Unknown provider")
		return
	}
	if req.APIKey == "" {
		writeJSONError(w, http.StatusBadRequest, "api_key required")
		return
	}
	if len(req.Prompt) == 0 || len(req.Prompt) > maxPromptLen {
		writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("prompt length must be 1..%d", maxPromptLen))
		return
	}
	if len(req.Model) == 0 || len(req.Model) > maxModelLen {
		writeJSONError(w, http.StatusBadRequest, "invalid model")
		return
	}

	var provider llm.Provider
	switch req.Provider {
	case "openai":
		provider = &llm.OpenAIProvider{}
	case "anthropic":
		provider = &llm.AnthropicProvider{}
	case "gemini":
		provider = &llm.GeminiProvider{}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, "Streaming unsupported")
		return
	}

	ctx := r.Context()
	eventChan := make(chan llm.StreamEvent, 100)
	done := make(chan struct{})
	var streamErr error

	go func() {
		streamErr = provider.Stream(ctx, req, eventChan)
		close(eventChan)
		close(done)
	}()

	writeEvent := func(ev llm.StreamEvent) {
		b, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-eventChan:
			if !ok {
				<-done
				if streamErr != nil {
					writeEvent(llm.StreamEvent{Type: "error", Error: streamErr.Error()})
				} else {
					writeEvent(llm.StreamEvent{Type: "done"})
				}
				return
			}
			writeEvent(event)
		}
	}
}

func runBenchmarkHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)

	var req benchmark.BenchmarkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if !validProviders[req.Provider] {
		writeJSONError(w, http.StatusBadRequest, "Unknown provider")
		return
	}
	if !validDatasets[req.Dataset] {
		writeJSONError(w, http.StatusBadRequest, "Unknown dataset")
		return
	}
	if req.APIKey == "" {
		writeJSONError(w, http.StatusBadRequest, "api_key required")
		return
	}
	if len(req.Model) == 0 || len(req.Model) > maxModelLen {
		writeJSONError(w, http.StatusBadRequest, "invalid model")
		return
	}
	if req.Count < 1 {
		req.Count = 1
	}
	if req.Count > maxBenchCount {
		req.Count = maxBenchCount
	}
	if req.Concurrency < 1 {
		req.Concurrency = 1
	}
	if req.Concurrency > maxConcurrency {
		req.Concurrency = maxConcurrency
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, "Streaming unsupported")
		return
	}

	eventChan := make(chan benchmark.BenchmarkEvent, 100)
	ctx := r.Context()

	go benchmark.RunEvaluation(ctx, req, eventChan)

	for event := range eventChan {
		eventBytes, _ := json.Marshal(event)
		fmt.Fprintf(w, "data: %s\n\n", eventBytes)
		flusher.Flush()
		if event.Type == "done" || event.Type == "error" {
			return
		}
	}
}

func historyHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		runs, err := db.GetHistory()
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "failed to read history")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(runs)

	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
		var run db.RunRecord
		if err := json.NewDecoder(r.Body).Decode(&run); err != nil {
			writeJSONError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		if !validRunTypes[run.RunType] {
			writeJSONError(w, http.StatusBadRequest, "invalid run_type")
			return
		}
		if !validProviders[run.Provider] {
			writeJSONError(w, http.StatusBadRequest, "invalid provider")
			return
		}
		if len(run.Model) == 0 || len(run.Model) > maxModelLen {
			writeJSONError(w, http.StatusBadRequest, "invalid model")
			return
		}
		if err := db.InsertRun(run); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "failed to insert run")
			return
		}
		w.WriteHeader(http.StatusOK)

	case http.MethodDelete:
		if err := db.ClearHistory(); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "failed to clear history")
			return
		}
		w.WriteHeader(http.StatusOK)

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func modelsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	provider := r.URL.Query().Get("provider")
	if !validProviders[provider] {
		writeJSONError(w, http.StatusBadRequest, "Unknown provider")
		return
	}
	apiKey := r.Header.Get("X-Provider-Key")
	if apiKey == "" {
		writeJSONError(w, http.StatusBadRequest, "X-Provider-Key header required")
		return
	}

	models, err := llm.FetchModels(r.Context(), provider, apiKey)
	if err != nil {
		log.Printf("models fetch failed: %v", err)
		writeJSONError(w, http.StatusBadGateway, "failed to fetch models")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models)
}

func allowedOrigins() []string {
	raw := os.Getenv("ALLOWED_ORIGINS")
	if raw == "" {
		return []string{"http://localhost:5173"}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return []string{"http://localhost:5173"}
	}
	return out
}

func main() {
	db.InitDB()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/chat", chatHandler)
	mux.HandleFunc("/api/run-benchmark", runBenchmarkHandler)
	mux.HandleFunc("/api/history", historyHandler)
	mux.HandleFunc("/api/models", modelsHandler)

	origins := allowedOrigins()
	log.Printf("CORS allowed origins: %v", origins)

	c := cors.New(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodDelete, http.MethodOptions},
		AllowedHeaders:   []string{"Content-Type", "X-Provider-Key"},
		AllowCredentials: false,
	})

	server := &http.Server{
		Addr:              ":8080",
		Handler:           c.Handler(mux),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// WriteTimeout intentionally unset so SSE streams are not cut off.
	}

	log.Println("Starting server on :8080")
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
