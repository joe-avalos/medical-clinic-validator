# Medical Clinic Legal Validator

Accepts a medical clinic name, looks up its legal registration via OpenCorporates, validates it with Claude AI, and assigns a risk level.

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- npm

## Setup

```bash
# Install dependencies
npm install

# Copy environment file and fill in your keys
cp .env.example .env

# Start LocalStack + Redis
docker-compose up -d

# Start all services (API, workers, frontend)
npm run dev:services
```

## Services

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| API | http://localhost:3000 |
| LocalStack | http://localhost:4566 |

## AI Providers

The validator supports multiple AI providers, selectable per-request via the frontend dropdown:

| Provider | Config | Use Case |
|---|---|---|
| **Claude (API)** | Default. Set `ANTHROPIC_API_KEY` in `.env` | Production — fast, reliable |
| **Qwen (local)** | `QWEN_OLLAMA_URL=http://localhost:11434` | Dev testing — requires `ollama serve` running locally |
| **Qwen (Modal)** | `QWEN_OLLAMA_URL=https://<app>--medical-validator-inference.modal.run` | GPU inference — serverless T4, ~900ms/request |

### Qwen on Modal (serverless GPU)

```bash
# One-time setup
pip install modal
modal setup

# Upload model to Modal volume
modal volume create medical-validator-vol
modal volume put medical-validator-vol \
    training/ollama-model/medical-validator-q4_k_m.gguf \
    /model/medical-validator-q4_k_m.gguf

# Test locally (temporary, logs to terminal)
modal serve training/modal_serve.py

# Deploy permanently
modal deploy training/modal_serve.py
```

Update `.env`:
```
QWEN_OLLAMA_URL=https://<your-app>--medical-validator-inference.modal.run
QWEN_CONCURRENCY=5
QWEN_TIMEOUT_MS=15000
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a deep dive into all design decisions.