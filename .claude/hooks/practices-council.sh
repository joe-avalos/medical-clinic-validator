#!/bin/bash
set -euo pipefail

# Best Practices Council — Reviews file changes for code quality.
# Fires on Stop event. No-ops if no files were changed.

DIFF=$(cd "$CLAUDE_PROJECT_DIR" && git diff --unified=3 2>/dev/null || true)
STAGED=$(cd "$CLAUDE_PROJECT_DIR" && git diff --cached --unified=3 2>/dev/null || true)
UNTRACKED=$(cd "$CLAUDE_PROJECT_DIR" && git ls-files --others --exclude-standard 2>/dev/null || true)

# Collect untracked file contents (new files that aren't in git yet)
UNTRACKED_CONTENT=""
if [ -n "$UNTRACKED" ]; then
  while IFS= read -r file; do
    if [ -f "$CLAUDE_PROJECT_DIR/$file" ]; then
      CONTENT=$(head -200 "$CLAUDE_PROJECT_DIR/$file" 2>/dev/null || true)
      if [ -n "$CONTENT" ]; then
        UNTRACKED_CONTENT="${UNTRACKED_CONTENT}
--- NEW FILE: ${file} ---
${CONTENT}
--- END FILE ---
"
      fi
    fi
  done <<< "$UNTRACKED"
fi

ALL_CHANGES="${DIFF}${STAGED}${UNTRACKED_CONTENT}"

# If no uncommitted changes, check the last commit (catches just-committed work)
if [ -z "$ALL_CHANGES" ]; then
  LAST_COMMIT_AGE=$(cd "$CLAUDE_PROJECT_DIR" && git log -1 --format=%ct 2>/dev/null || echo "0")
  NOW=$(date +%s)
  SECONDS_AGO=$((NOW - LAST_COMMIT_AGE))
  # Only review if the last commit was within the last 60 seconds
  if [ "$SECONDS_AGO" -lt 60 ]; then
    ALL_CHANGES=$(cd "$CLAUDE_PROJECT_DIR" && git diff HEAD~1..HEAD --unified=3 2>/dev/null || true)
  fi
fi

# No changes = nothing to review
if [ -z "$ALL_CHANGES" ]; then
  exit 0
fi

# Truncate to avoid blowing up the API call
ALL_CHANGES=$(echo "$ALL_CHANGES" | head -500)

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo '{"decision":"block","hookSpecificOutput":{"additionalContext":"[Best Practices Council] WARNING: ANTHROPIC_API_KEY not set — practices review skipped."}}'
  exit 0
fi

SYSTEM_PROMPT='You are a best practices review council for a TypeScript/Node.js project using AWS (SQS, DynamoDB), Express, Zod, and Docker. Review the code changes below for:

1. TypeScript strict mode violations (any types, missing type annotations at boundaries)
2. Error handling gaps (unhandled promises, missing try/catch at I/O boundaries)
3. Zod schema correctness (validation at system boundaries, proper parse vs safeParse usage)
4. AWS SDK best practices (proper error handling, resource cleanup)
5. Docker/IaC issues (missing health checks, volume misconfigurations, insecure defaults)
6. CloudFormation template errors (invalid resource types, missing required properties, incorrect references)
7. Naming conventions and code organization

Respond in this exact format:
- If NO issues found: "NO_ISSUES"
- If issues found: A concise bulleted list of findings with severity (HIGH/MEDIUM/LOW) and the specific file/line. No preamble.'

ESCAPED_CHANGES=$(echo "$ALL_CHANGES" | jq -Rs .)
ESCAPED_SYSTEM=$(echo "$SYSTEM_PROMPT" | jq -Rs .)

RESPONSE=$(curl -s --max-time 30 "https://api.anthropic.com/v1/messages" \
  -H "content-type: application/json" \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -d "{
    \"model\": \"claude-haiku-4-5-20251001\",
    \"max_tokens\": 1024,
    \"system\": ${ESCAPED_SYSTEM},
    \"messages\": [{\"role\": \"user\", \"content\": ${ESCAPED_CHANGES}}]
  }" 2>/dev/null || echo "API_ERROR")

if [ "$RESPONSE" = "API_ERROR" ]; then
  exit 0
fi

REVIEW=$(echo "$RESPONSE" | jq -r '.content[0].text // "NO_ISSUES"' 2>/dev/null || echo "NO_ISSUES")

if [ "$REVIEW" = "NO_ISSUES" ]; then
  exit 0
fi

# Issues found — block stop so Claude sees the feedback and can act on it
jq -n --arg review "$REVIEW" '{
  "decision": "block",
  "hookSpecificOutput": {
    "additionalContext": ("[BEST PRACTICES COUNCIL REVIEW]\n" + $review + "\n\nAddress the above findings before proceeding.")
  }
}'