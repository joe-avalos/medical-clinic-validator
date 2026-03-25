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

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a deep dive into all design decisions.