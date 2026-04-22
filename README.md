# Antigone LLM Bench

Antigone LLM Bench is a full-stack benchmarking and evaluation suite for comparing the speed, accuracy, and performance of frontier Large Language Models (LLMs) across multiple providers (OpenAI, Anthropic, Google Gemini). It features a sleek React/Mantine frontend and a highly concurrent Go backend.

## 🚀 Features

- **Dynamic Model Discovery:** Automatically fetches the latest available model variants directly from the APIs when you enter your key (no more hardcoded, outdated model names!).
- **Live Performance Metrics:** Tracks and visualizes Time-To-First-Token (TTFT), Prompt Processing Rate (tokens/sec), and Decode Rate (tokens/sec) using real-time Recharts graphs.
- **Full Evaluation Mode:** Run high-concurrency benchmarks on standardized Hugging Face datasets to calculate exact-match accuracy against expected answers.
- **Persistent History:** Automatically saves all benchmarking runs, speeds, and scores to a local SQLite database for long-term historical comparison.
- **Secure by Default:** API keys are stored locally in your browser's `localStorage` and passed to the backend securely per-request. They are never saved to the database.

[![Watch the video](https://cdn.loom.com/sessions/thumbnails/7744d333b75a42a79fbcc672f69e5c67-e9e47f9e9a023d61-full-play.gif)](https://www.loom.com/share/7744d333b75a42a79fbcc672f69e5c67)
[![Watch the video](IMAGE_URL)](LOOM_VIDEO_URL)

## 🧪 Supported Benchmarks

The custom benchmarking engine connects to the Hugging Face Datasets API to stream evaluation questions dynamically. Supported datasets include:

1. **MMLU** (`cais/mmlu`) - General domain knowledge.
2. **MMLU Pro** (`TIGER-Lab/MMLU-Pro`) - Enhanced, harder reasoning.
3. **GSM8K** - Grade-school mathematical reasoning.
4. **HellaSwag** (`Rowan/hellaswag`) - Commonsense natural language inference.
5. **TruthfulQA** - Hallucination and factuality testing.
6. **SWE-bench Lite** (`princeton-nlp/SWE-bench_Lite`) - Software engineering problem statements.
7. **WebArena** *(Simulated Mode)* - Agentic tool-use proxy.
8. **AgentBench** *(Simulated Mode)* - Autonomous agent capabilities proxy.

## 🛠️ Technology Stack

- **Frontend:** React, TypeScript, Vite, Mantine UI v7, Recharts, Tabler Icons.
- **Backend:** Go (`net/http`), SQLite3 (for history tracking), Server-Sent Events (SSE) for streaming text and metrics.

## 📦 Getting Started

### Prerequisites
- [Go](https://go.dev/dl/) 1.21+
- [Node.js](https://nodejs.org/) 18+ and `npm`
- API Keys for the providers you wish to test (OpenAI, Anthropic, Gemini)
- A Hugging Face token (optional, but recommended to avoid dataset rate limits).

### 1. Start the Backend
```bash
cd backend
go mod tidy
go run main.go
```
The backend will automatically initialize a `history.db` SQLite database and start the API server on `http://localhost:8080`.

### 2. Start the Frontend
Open a new terminal window:
```bash
cd frontend
npm install
npm run dev
```
The frontend will start on `http://localhost:5173`.

## 🎮 Usage Guide

1. **Enter your API Keys:** Open the app and enter your API keys in the left sidebar.
2. **Auto-Populate Models:** Once you click away from the input field, the app will quietly query the provider for the latest valid models and dynamically add them to your dropdown list.
3. **Dashboard (Single Run):** Ask a single question to instantly see the Time-To-First-Token and generation speeds charted in real-time. You can use the "Run" dropdown to instantly pull a random question from any benchmark dataset.
4. **Full Evaluation Mode:** Toggle the "Full Evaluation Mode" switch to select a dataset, set a question limit, adjust concurrency (batch size), and run a full test block to determine model accuracy.
5. **History Tab:** Review past runs, compare model performance over time, or permanently clear your database using the red "Clear All History" button.
