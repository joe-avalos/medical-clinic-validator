# Agent: IaC
> **Role:** All infrastructure definition, LocalStack simulation, Docker Compose orchestration, and CloudFormation stack management.
> **Scope:** This agent owns everything infrastructure. It has no knowledge of application business logic — it only knows about AWS resource definitions, environment wiring, and deployment procedures.

---

## Responsibilities

- Define all AWS resources via CloudFormation templates
- Configure Docker Compose for full local environment
- Bootstrap LocalStack with required resources on startup
- Define IAM roles and least-privilege policies for each service
- Manage environment variable contracts between services
- Provide deterministic local setup — `docker-compose up` must fully work from cold start

## Out of Scope

- Does NOT implement application logic
- Does NOT write TypeScript services
- Does NOT define business rules or data schemas (only resource-level config)
- Does NOT manage application-level secrets (only wires them as env vars)

---

## Auth Responsibility

None at the application level. Owns IAM roles and policies — defines what each service is *allowed* to do in AWS.

> ⚠️ *Compliance Note: A future compliance pass (HIPAA / SOC2) must evaluate: VPC isolation for all services, encryption at rest for DynamoDB (SSE with KMS), encryption in transit (TLS enforcement), CloudTrail audit logging, S3 access logging, and IAM policy hardening. LocalStack does not enforce these — production deployment requires explicit configuration.*

---

## Project Structure

```
infra/
├── cloudformation/
│   ├── template.yaml              # Root stack — references nested stacks
│   ├── stacks/
│   │   ├── dynamodb.yaml          # verifications + jobs tables, GSI
│   │   ├── sqs.yaml               # 3x FIFO queues + DLQs
│   │   ├── elasticache.yaml       # Redis cluster stub
│   │   ├── api-gateway.yaml       # REST API + JWT authorizer
│   │   └── iam.yaml               # Roles + policies per service
│   └── parameters/
│       ├── local.json             # LocalStack endpoint overrides
│       └── prod.json              # Production values (placeholder)
├── scripts/
│   ├── bootstrap.sh               # Run after LocalStack starts
│   └── teardown.sh                # Clean up LocalStack state
└── docker-compose.yml
```

---

## Docker Compose Services

```yaml
services:

  localstack:
    image: localstack/localstack:3
    ports:
      - "4566:4566"
    environment:
      SERVICES: sqs,dynamodb,apigateway,iam,cloudformation
      DEFAULT_REGION: us-east-1
      EAGER_SERVICE_LOADING: 1
    volumes:
      - ./infra/scripts:/etc/localstack/init/ready.d
      - localstack_data:/var/lib/localstack

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru

  api:
    build: ./services/api
    ports:
      - "3000:3000"
    depends_on:
      - localstack
      - redis
    environment:
      - PORT=3000
      - DYNAMODB_ENDPOINT=http://localstack:4566
      - SQS_VERIFICATION_QUEUE_URL=...
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}

  worker-scraper:
    build: ./services/worker
    depends_on:
      - localstack
      - redis
    environment:
      - WORKER_TYPE=scraper
      - DYNAMODB_ENDPOINT=http://localstack:4566
      - SQS_VERIFICATION_QUEUE_URL=...
      - SQS_VALIDATION_QUEUE_URL=...
      - REDIS_URL=redis://redis:6379
      - OPENCORPORATES_API_KEY=${OPENCORPORATES_API_KEY}

  worker-validator:
    build: ./services/worker
    depends_on:
      - localstack
    environment:
      - WORKER_TYPE=ai-validator
      - SQS_VALIDATION_QUEUE_URL=...
      - SQS_STORAGE_QUEUE_URL=...
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

  worker-storage:
    build: ./services/worker
    depends_on:
      - localstack
      - redis
    environment:
      - WORKER_TYPE=storage
      - DYNAMODB_ENDPOINT=http://localstack:4566
      - SQS_STORAGE_QUEUE_URL=...
      - REDIS_URL=redis://redis:6379

volumes:
  localstack_data:
```

---

## CloudFormation Stacks

### Root: `template.yaml`

Nested stack orchestrator. Passes shared parameters (env name, region) to each child stack.

---

### `stacks/dynamodb.yaml`

```yaml
Resources:
  VerificationsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: verifications
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: pk, AttributeType: S }
        - { AttributeName: sk, AttributeType: S }
        - { AttributeName: riskLevel, AttributeType: S }
        - { AttributeName: validatedAt, AttributeType: S }
      KeySchema:
        - { AttributeName: pk, KeyType: HASH }
        - { AttributeName: sk, KeyType: RANGE }
      GlobalSecondaryIndexes:
        - IndexName: riskLevel-validatedAt-index
          KeySchema:
            - { AttributeName: riskLevel, KeyType: HASH }
            - { AttributeName: validatedAt, KeyType: RANGE }
          Projection: { ProjectionType: ALL }
      TimeToLiveSpecification:
        AttributeName: ttl
        Enabled: true

  JobsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: jobs
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: pk, AttributeType: S }
        - { AttributeName: sk, AttributeType: S }
      KeySchema:
        - { AttributeName: pk, KeyType: HASH }
        - { AttributeName: sk, KeyType: RANGE }
```

---

### `stacks/sqs.yaml`

Three FIFO queues, each with a paired Dead Letter Queue:

| Queue | Purpose | Consumers |
|---|---|---|
| `verification-queue.fifo` | New jobs from API | Scraper Worker |
| `validation-queue.fifo` | Scraped results | AI Validator Worker |
| `storage-queue.fifo` | Validated results | Storage Worker |

```yaml
# Pattern repeated for all 3 queues
VerificationQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: verification-queue.fifo
    FifoQueue: true
    VisibilityTimeout: 30
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt VerificationDLQ.Arn
      maxReceiveCount: 3

VerificationDLQ:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: verification-dlq.fifo
    FifoQueue: true
    MessageRetentionPeriod: 1209600   # 14 days
```

---

### `stacks/iam.yaml`

Least-privilege roles per service:

| Role | Allowed Actions |
|---|---|
| `ApiRole` | `sqs:SendMessage` (verification-queue), `dynamodb:PutItem` + `GetItem` (jobs) |
| `ScraperWorkerRole` | `sqs:ReceiveMessage` + `DeleteMessage` (verification-queue), `sqs:SendMessage` (validation-queue), `dynamodb:UpdateItem` (jobs) |
| `ValidatorWorkerRole` | `sqs:ReceiveMessage` + `DeleteMessage` (validation-queue), `sqs:SendMessage` (storage-queue) |
| `StorageWorkerRole` | `sqs:ReceiveMessage` + `DeleteMessage` (storage-queue), `dynamodb:PutItem` (verifications), `dynamodb:UpdateItem` (jobs) |
| `ApiRole` (updated) | `sqs:SendMessage` (verification-queue), `dynamodb:PutItem` + `GetItem` (jobs), `dynamodb:Query` (verifications GSI) |

---

### `stacks/api-gateway.yaml`

```yaml
# REST API with JWT authorizer
MedicalValidatorApi:
  Type: AWS::ApiGateway::RestApi
  Properties:
    Name: medical-validator-api

JwtAuthorizer:
  Type: AWS::ApiGateway::Authorizer
  Properties:
    Type: TOKEN
    RestApiId: !Ref MedicalValidatorApi
    IdentitySource: method.request.header.Authorization
```

---

### `parameters/local.json`

```json
{
  "Parameters": {
    "DynamoDBEndpoint": "http://localhost:4566",
    "SQSEndpoint": "http://localhost:4566",
    "Environment": "local",
    "Region": "us-east-1",
    "AccountId": "000000000000"
  }
}
```

---

## Bootstrap Script (`scripts/bootstrap.sh`)

Runs automatically via LocalStack init hooks after LocalStack is ready:

```bash
#!/bin/bash
# Deploy CloudFormation stacks to LocalStack
awslocal cloudformation deploy \
  --template-file /infra/cloudformation/template.yaml \
  --stack-name medical-validator \
  --parameter-overrides file:///infra/cloudformation/parameters/local.json \
  --capabilities CAPABILITY_IAM
```

---

## Startup Order

```
1. localstack     (health check: http://localhost:4566/_localstack/health)
2. redis          (health check: redis-cli ping)
3. bootstrap.sh   (CloudFormation deploy — runs once on localstack ready)
4. api            (depends on: localstack + redis)
5. worker-scraper     (depends on: localstack + redis)
6. worker-validator   (depends on: localstack)
7. worker-storage     (depends on: localstack + redis)
```

---

## Environment Variables Reference

All services receive environment variables via Docker Compose. Secrets (JWT_SECRET, ANTHROPIC_API_KEY, OPENCORPORATES_API_KEY) are loaded from `.env` file — never committed to source control.

```bash
# .env.example
JWT_SECRET=your-local-dev-secret
ANTHROPIC_API_KEY=sk-ant-...
OPENCORPORATES_API_KEY=         # optional
AWS_ACCESS_KEY_ID=test          # LocalStack dummy
AWS_SECRET_ACCESS_KEY=test      # LocalStack dummy
AWS_DEFAULT_REGION=us-east-1
```

---

## Testing Requirements

- Smoke test: `docker-compose up` completes without errors
- Smoke test: `bootstrap.sh` creates all CloudFormation resources in LocalStack
- Smoke test: All 3 SQS queues + DLQs exist and are queryable
- Smoke test: Both DynamoDB tables exist with correct key schema and GSI
- Validation: IAM roles created with correct action boundaries
- Validation: Redis is reachable from all worker containers
