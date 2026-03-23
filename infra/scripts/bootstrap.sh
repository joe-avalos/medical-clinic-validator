#!/bin/bash
set -euo pipefail

# Medical Clinic Legal Validator — LocalStack Bootstrap
# Deploys individual CloudFormation stacks to LocalStack.
# Runs automatically via LocalStack init hooks (mounted to /etc/localstack/init/ready.d).

STACK_DIR="/opt/cloudformation/stacks"
PARAMS_FILE="/opt/cloudformation/parameters/local.json"

echo "=== Medical Validator: Starting CloudFormation bootstrap ==="

# 1. DynamoDB tables
echo "[1/4] Deploying DynamoDB stack..."
awslocal cloudformation deploy \
  --template-file "${STACK_DIR}/dynamodb.yaml" \
  --stack-name medical-validator-dynamodb \
  --parameter-overrides Environment=local \
  --no-fail-on-empty-changeset

# 2. SQS queues + DLQs
echo "[2/4] Deploying SQS stack..."
awslocal cloudformation deploy \
  --template-file "${STACK_DIR}/sqs.yaml" \
  --stack-name medical-validator-sqs \
  --parameter-overrides Environment=local \
  --no-fail-on-empty-changeset

# 3. IAM roles
echo "[3/4] Deploying IAM stack..."
awslocal cloudformation deploy \
  --template-file "${STACK_DIR}/iam.yaml" \
  --stack-name medical-validator-iam \
  --parameter-overrides Environment=local AccountId=000000000000 Region=us-east-1 \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset

# 4. API Gateway
echo "[4/4] Deploying API Gateway stack..."
awslocal cloudformation deploy \
  --template-file "${STACK_DIR}/api-gateway.yaml" \
  --stack-name medical-validator-api-gateway \
  --parameter-overrides Environment=local \
  --no-fail-on-empty-changeset

# ElastiCache stack skipped in local — Redis runs via Docker Compose

echo ""
echo "=== Verifying deployed resources ==="

echo "DynamoDB tables:"
awslocal dynamodb list-tables

echo ""
echo "SQS queues:"
awslocal sqs list-queues

echo ""
echo "IAM roles:"
awslocal iam list-roles --query 'Roles[?starts_with(RoleName, `medical-validator`)].RoleName'

echo ""
echo "=== Bootstrap complete ==="
