import urllib.request

url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:streamGenerateContent?key=invalid"
try:
    req = urllib.request.Request(url, method="POST")
    urllib.request.urlopen(req)
except Exception as e:
    print(e)
