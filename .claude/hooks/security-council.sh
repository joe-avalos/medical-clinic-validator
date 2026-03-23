#!/bin/bash
set -euo pipefail

# Security Council — Reviews file changes for security issues.
# Fires on Stop event. No-ops if no files were changed.

DIFF=$(cd "$CLAUDE_PROJECT_DIR" && git diff --unified=3 2>/dev/null || true)
STAGED=$(cd "$CLAUDE_PROJECT_DIR" && git diff --cached --unified=3 2>/dev/null || true)
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
  echo '{"decision":"block","hookSpecificOutput":{"additionalContext":"[Security Council] WARNING: ANTHROPIC_API_KEY not set — security review skipped."}}'
  exit 0
fi

SYSTEM_PROMPT='You are a security review council for a medical/healthcare application handling PHI-adjacent data. Review the code changes below for:

1. OWASP Top 10 vulnerabilities (injection, XSS, SSRF, broken auth, etc.)
2. Secret/credential leaks (hardcoded keys, tokens, passwords)
3. Authentication/authorization bypasses
4. Insecure data handling (PII/PHI exposure, logging sensitive data)
5. Command injection or path traversal
6. Insecure dependencies or configurations
7. Missing input validation at system boundaries

Respond in this exact format:
- If NO issues found: "NO_ISSUES"
- If issues found: A concise bulleted list of findings with severity (CRITICAL/HIGH/MEDIUM/LOW) and the specific file/line. No preamble.'

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

# Log the review
LOG_DIR="${CLAUDE_PROJECT_DIR}/.claude/councils"
mkdir -p "$LOG_DIR"
COMMIT_SHORT=$(cd "$CLAUDE_PROJECT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo -e "[$TIMESTAMP] commit:${COMMIT_SHORT}\n${REVIEW}\n---\n" >> "${LOG_DIR}/security.log"

# Issues found — block stop so Claude sees the feedback and can act on it
jq -n --arg review "$REVIEW" '{
  "decision": "block",
  "hookSpecificOutput": {
    "additionalContext": ("[SECURITY COUNCIL REVIEW]\n" + $review + "\n\nAddress the above security findings before proceeding.")
  }
}'