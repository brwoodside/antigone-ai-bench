FROM golang:1.21-alpine
WORKDIR /app
# Install gcc/musl-dev for SQLite CGO compilation
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o main .
CMD ["./main"]
