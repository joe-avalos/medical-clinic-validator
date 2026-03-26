#!/bin/bash
set -euo pipefail

# Bootstrap script: starts Ollama server, then creates the medical-validator model if missing.

# Guard: ensure model files exist before proceeding
if [ ! -f /models/Modelfile ]; then
  echo "ERROR: /models/Modelfile not found. Mount training/ollama-model/ to /models."
  exit 1
fi
if ! ls /models/*.gguf 1>/dev/null 2>&1; then
  echo "ERROR: No .gguf file found in /models/. Ensure the model binary is present."
  exit 1
fi

# Start the server in background
ollama serve &
SERVER_PID=$!

# Wait for server to be ready (no curl in image — use ollama list)
echo "Waiting for Ollama server..."
MAX_WAIT=30
for i in $(seq 1 $MAX_WAIT); do
  if ollama list > /dev/null 2>&1; then
    echo "Ollama server ready."
    break
  fi
  if [ "$i" -eq "$MAX_WAIT" ]; then
    echo "ERROR: Ollama server did not start within ${MAX_WAIT}s"
    exit 1
  fi
  sleep 1
done

# Create model if it doesn't exist
if ! ollama list | grep -q "medical-validator"; then
  echo "Creating medical-validator model from GGUF..."
  ollama create medical-validator -f /models/Modelfile
  echo "Model created."
else
  echo "medical-validator model already exists."
fi

# Keep server in foreground
wait $SERVER_PID
