package db

import (
	"database/sql"
	"log"

	_ "github.com/glebarez/go-sqlite"
)

var DB *sql.DB

func InitDB() {
	var err error
	DB, err = sql.Open("sqlite", "./antigone-llm-bench.db")
	if err != nil {
		log.Fatal(err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		run_type TEXT,
		model TEXT,
		provider TEXT,
		ttft_ms REAL,
		prompt_rate REAL,
		decode_rate REAL,
		total_time_ms REAL,
		accuracy REAL
	);
	`
	_, err = DB.Exec(createTableQuery)
	if err != nil {
		log.Fatalf("Error creating runs table: %v", err)
	}
}

type RunRecord struct {
	ID           int     `json:"id"`
	Timestamp    string  `json:"timestamp"`
	RunType      string  `json:"run_type"`
	Model        string  `json:"model"`
	Provider     string  `json:"provider"`
	TTFTMs       float64 `json:"ttft_ms"`
	PromptRate   float64 `json:"prompt_rate"`
	DecodeRate   float64 `json:"decode_rate"`
	TotalTimeMs  float64 `json:"total_time_ms"`
	Accuracy     float64 `json:"accuracy"`
}

func InsertRun(record RunRecord) error {
	query := `
	INSERT INTO runs (run_type, model, provider, ttft_ms, prompt_rate, decode_rate, total_time_ms, accuracy)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := DB.Exec(query, record.RunType, record.Model, record.Provider, record.TTFTMs, record.PromptRate, record.DecodeRate, record.TotalTimeMs, record.Accuracy)
	return err
}

func GetHistory() ([]RunRecord, error) {
	query := `SELECT id, timestamp, run_type, model, provider, ttft_ms, prompt_rate, decode_rate, total_time_ms, accuracy FROM runs ORDER BY timestamp DESC`
	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []RunRecord
	for rows.Next() {
		var r RunRecord
		// handle NULLs for reals safely by scanning into sql.NullFloat64 first, but Go's SQLite driver handles it if we just use sql.NullFloat64, or wait, if accuracy can be NULL?
		// We can just use float64 because they are REAL. They might be 0.0 by default, but if we inserted standard 0.0 it works.
		// Let's use sql.NullFloat64 to be safe.
		var ttft, prompt, decode, total, acc sql.NullFloat64
		var model, provider, runType, ts sql.NullString

		err := rows.Scan(&r.ID, &ts, &runType, &model, &provider, &ttft, &prompt, &decode, &total, &acc)
		if err != nil {
			return nil, err
		}
		
		r.Timestamp = ts.String
		r.RunType = runType.String
		r.Model = model.String
		r.Provider = provider.String
		r.TTFTMs = ttft.Float64
		r.PromptRate = prompt.Float64
		r.DecodeRate = decode.Float64
		r.TotalTimeMs = total.Float64
		r.Accuracy = acc.Float64

		runs = append(runs, r)
	}
	// return empty array instead of null
	if runs == nil {
		runs = make([]RunRecord, 0)
	}
	return runs, nil
}

func ClearHistory() error {
	_, err := DB.Exec("DELETE FROM runs")
	return err
}
