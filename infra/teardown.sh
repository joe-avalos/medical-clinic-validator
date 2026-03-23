#!/bin/bash
set -euo pipefail

# Medical Clinic Legal Validator — LocalStack Teardown
# Deletes all CloudFormation stacks from LocalStack.

echo "=== Medical Validator: Tearing down CloudFormation stacks ==="

STACKS=(
  "medical-validator-api-gateway"
  "medical-validator-iam"
  "medical-validator-sqs"
  "medical-validator-dynamodb"
)

for stack in "${STACKS[@]}"; do
  echo "Deleting stack: ${stack}..."
  awslocal cloudformation delete-stack --stack-name "${stack}" 2>/dev/null || true
done

echo "Waiting for stack deletion..."
for stack in "${STACKS[@]}"; do
  awslocal cloudformation wait stack-delete-complete --stack-name "${stack}" 2>/dev/null || true
done

echo "=== Teardown complete ==="
