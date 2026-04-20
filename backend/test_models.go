package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	req, _ := http.NewRequest("GET", "http://localhost:8080/api/models?provider=openai&api_key=fake", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Println("Error:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	fmt.Println("Status:", resp.StatusCode)
	fmt.Println("Body:", string(body))
}
