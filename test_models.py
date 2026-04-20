import requests
import json

try:
    print("Testing Anthropic...")
    # We don't have a real key, but we can see if it 404s or 401s
    res = requests.get('http://localhost:8080/api/models?provider=anthropic&api_key=fake')
    print(res.status_code, res.text)
except Exception as e:
    print(e)
