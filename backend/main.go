package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"antigone-llm-bench-backend/benchmark"
	"antigone-llm-bench-backend/db"
	"antigone-llm-bench-backend/llm"

	"github.com/rs/cors"
)

func chatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req llm.StreamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
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
	default:
		http.Error(w, "Unknown provider", http.StatusBadRequest)
		return
	}

	// Setup SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	eventChan := make(chan llm.StreamEvent, 100)
	errChan := make(chan error, 1)

	ctx := r.Context()

	go func() {
		err := provider.Stream(ctx, req, eventChan)
		if err != nil {
			errChan <- err
		}
		close(eventChan)
		close(errChan)
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case err := <-errChan:
			if err != nil {
				errMsg, _ := json.Marshal(llm.StreamEvent{Type: "error", Error: err.Error()})
				fmt.Fprintf(w, "data: %s\n\n", errMsg)
				flusher.Flush()
			}
		case event, ok := <-eventChan:
			if !ok {
				doneMsg, _ := json.Marshal(llm.StreamEvent{Type: "done"})
				fmt.Fprintf(w, "data: %s\n\n", doneMsg)
				flusher.Flush()
				return
			}
			eventBytes, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", eventBytes)
			flusher.Flush()
		}
	}
}

func runBenchmarkHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req benchmark.BenchmarkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
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
	if r.Method == http.MethodGet {
		runs, err := db.GetHistory()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(runs)
		return
	}

	if r.Method == http.MethodPost {
		var run db.RunRecord
		if err := json.NewDecoder(r.Body).Decode(&run); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		if err := db.InsertRun(run); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == http.MethodDelete {
		if err := db.ClearHistory(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func modelsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	provider := r.URL.Query().Get("provider")
	apiKey := r.URL.Query().Get("api_key")
	if apiKey == "" {
		http.Error(w, "API key required", http.StatusBadRequest)
		return
	}

	models, err := llm.FetchModels(provider, apiKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models)
}

func main() {
	db.InitDB()
	
	mux := http.NewServeMux()
	mux.HandleFunc("/api/chat", chatHandler)
	mux.HandleFunc("/api/run-benchmark", runBenchmarkHandler)
	mux.HandleFunc("/api/history", historyHandler)
	mux.HandleFunc("/api/models", modelsHandler)

	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	handler := c.Handler(mux)

	log.Println("Starting server on :8080")
	if err := http.ListenAndServe(":8080", handler); err != nil {
		log.Fatal(err)
	}
}
