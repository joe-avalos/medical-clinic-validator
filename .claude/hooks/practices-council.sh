#!/bin/bash
set -euo pipefail

# Best Practices Council — Reviews file changes for code quality.
# Fires on Stop event. No-ops if no files were changed.

# Drain stdin — hook system sends JSON on stdin which would be consumed by curl/source
cat > /dev/null 2>/dev/null || true

# Load API key from .env if not already in environment
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -f "${CLAUDE_PROJECT_DIR}/.env" ]; then
  set -a
  source "${CLAUDE_PROJECT_DIR}/.env"
  set +a
fi

DIFF=$(cd "$CLAUDE_PROJECT_DIR" && git diff --unified=3 -- ':!package-lock.json' 2>/dev/null || true)
STAGED=$(cd "$CLAUDE_PROJECT_DIR" && git diff --cached --unified=3 -- ':!package-lock.json' 2>/dev/null || true)
UNTRACKED=$(cd "$CLAUDE_PROJECT_DIR" && git ls-files --others --exclude-standard 2>/dev/null || true)

# Collect untracked file contents (new files that aren't in git yet)
UNTRACKED_CONTENT=""
if [ -n "$UNTRACKED" ]; then
  while IFS= read -r file; do
    if [ -f "$CLAUDE_PROJECT_DIR/$file" ] && [ ! -L "$CLAUDE_PROJECT_DIR/$file" ]; then
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

# If no uncommitted changes, check if the last commit hasn't been reviewed yet
if [ -z "$ALL_CHANGES" ]; then
  TRACKER="${CLAUDE_PROJECT_DIR}/.claude/councils/.last-reviewed-practices"
  CURRENT_COMMIT=$(cd "$CLAUDE_PROJECT_DIR" && git rev-parse HEAD 2>/dev/null || echo "")
  LAST_REVIEWED=$(cat "$TRACKER" 2>/dev/null || echo "")
  if [ -n "$CURRENT_COMMIT" ] && [ "$CURRENT_COMMIT" != "$LAST_REVIEWED" ]; then
    ALL_CHANGES=$(cd "$CLAUDE_PROJECT_DIR" && git diff HEAD~1..HEAD --unified=3 2>/dev/null || true)
  fi
fi

# No changes = nothing to review
if [ -z "$ALL_CHANGES" ]; then
  exit 0
fi

# Truncate to avoid blowing up the API call
ALL_CHANGES=$(printf '%s' "$ALL_CHANGES" | head -500 || true)

# Skip if this exact diff was already reviewed
DIFF_HASH=$(printf '%s' "$ALL_CHANGES" | shasum -a 256 | cut -d' ' -f1)
HASH_TRACKER="${CLAUDE_PROJECT_DIR}/.claude/councils/.last-diff-hash-practices"
LAST_HASH=$(cat "$HASH_TRACKER" 2>/dev/null || echo "")
if [ "$DIFF_HASH" = "$LAST_HASH" ]; then
  exit 0
fi
mkdir -p "${CLAUDE_PROJECT_DIR}/.claude/councils"
echo "$DIFF_HASH" > "$HASH_TRACKER"

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
  }" </dev/null 2>/dev/null || echo "API_ERROR")

if [ "$RESPONSE" = "API_ERROR" ]; then
  exit 0
fi

REVIEW=$(echo "$RESPONSE" | jq -r '.content[0].text // "NO_ISSUES"' 2>/dev/null || echo "NO_ISSUES")

# Mark commit as reviewed
CURRENT_COMMIT=$(cd "$CLAUDE_PROJECT_DIR" && git rev-parse HEAD 2>/dev/null || echo "")
if [ -n "$CURRENT_COMMIT" ]; then
  mkdir -p "${CLAUDE_PROJECT_DIR}/.claude/councils"
  echo "$CURRENT_COMMIT" > "${CLAUDE_PROJECT_DIR}/.claude/councils/.last-reviewed-practices"
fi

if [ "$REVIEW" = "NO_ISSUES" ]; then
  exit 0
fi

# Log the review
LOG_DIR="${CLAUDE_PROJECT_DIR}/.claude/councils"
mkdir -p "$LOG_DIR"
COMMIT_SHORT=$(cd "$CLAUDE_PROJECT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo -e "[$TIMESTAMP] commit:${COMMIT_SHORT}\n${REVIEW}\n---\n" >> "${LOG_DIR}/practices.log"

# Issues found — block stop so Claude sees the feedback and can act on it
jq -n --arg review "$REVIEW" '{
  "decision": "block",
  "reason": ("[BEST PRACTICES COUNCIL REVIEW]\n" + $review + "\n\nAddress the above findings before proceeding.")
}'