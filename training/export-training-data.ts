#!/usr/bin/env tsx
/**
 * Export training data from captured JSONL files into chat-completion format
 * for fine-tuning Qwen2.5-3B-Instruct.
 *
 * Usage:
 *   npx tsx training/export-training-data.ts [--input-dir path] [--output path] [--stats-only]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface RawCapture {
  timestamp: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  provider: string;
  model: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatExample {
  messages: ChatMessage[];
}

// ─── Config ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const inputDir = getArg('--input-dir') || join(process.cwd(), 'services/worker/training-data');
const outputPath = getArg('--output') || join(process.cwd(), 'training/dataset.jsonl');
const statsOnly = args.includes('--stats-only');

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

// ─── System prompt (must match prompts.ts exactly) ──────────────────

const SYSTEM_PROMPT = `You are a healthcare entity verification specialist. Your task is to analyze company registration data from OpenCorporates and determine if the entity is a legitimate, active healthcare provider.

You MUST respond with valid JSON only — no markdown, no explanation, no wrapping. The response must match this exact schema:

{
  "companyName": "string — official registered name",
  "jurisdiction": "string — jurisdiction code (e.g. us_mn)",
  "registrationNumber": "string — company registration number",
  "incorporationDate": "string|null — ISO 8601 date or null if unknown",
  "legalStatus": "Active|Inactive|Dissolved|Unknown",
  "standardizedAddress": "string — Proper Case, full address with validated 5-digit or ZIP+4 code (e.g. '200 First St SW, Rochester, MN 55905')",
  "providerType": "Clinic|Health System|Hospital|Urgent Care|Non-profit|Pharmacy|Laboratory|Unknown",
  "riskLevel": "LOW|MEDIUM|HIGH|UNKNOWN",
  "riskFlags": ["array of string flags describing any concerns"],
  "aiSummary": "string — plain-English summary of findings",
  "confidence": "HIGH|MEDIUM|LOW"
}

Risk level rules:
- LOW: Active registration, matches jurisdiction, no anomalies
- MEDIUM: Active but incomplete data, multiple registrations, minor discrepancies
- HIGH: Dissolved, suspended, inactive, or jurisdiction mismatch
- UNKNOWN: Not found or data is inconclusive`;

// ─── Load & deduplicate ─────────────────────────────────────────────

function loadCaptures(dir: string): RawCapture[] {
  if (!existsSync(dir)) {
    console.error(`Input directory not found: ${dir}`);
    process.exit(1);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  if (files.length === 0) {
    console.error(`No .jsonl files found in ${dir}`);
    process.exit(1);
  }

  const captures: RawCapture[] = [];
  let parseErrors = 0;

  for (const file of files) {
    const lines = readFileSync(join(dir, file), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        captures.push(JSON.parse(line) as RawCapture);
      } catch {
        parseErrors++;
      }
    }
  }

  if (parseErrors > 0) {
    console.warn(`Skipped ${parseErrors} malformed lines`);
  }

  return captures;
}

function deduplicateByInput(captures: RawCapture[]): RawCapture[] {
  const seen = new Map<string, RawCapture>();

  for (const capture of captures) {
    // Deduplicate by company number + jurisdiction
    const input = capture.input as Record<string, unknown>;
    const key = `${input.companyNumber ?? input.name}::${input.jurisdiction}`;

    // Keep the most recent capture for each unique input
    const existing = seen.get(key);
    if (!existing || capture.timestamp > existing.timestamp) {
      seen.set(key, capture);
    }
  }

  return Array.from(seen.values());
}

// ─── Convert to chat format ─────────────────────────────────────────

function toChatExample(capture: RawCapture): ChatExample {
  const userPrompt = `Analyze the following company registration record and produce a validation result.

Company data:
${JSON.stringify(capture.input, null, 2)}

Respond with a single JSON object only.`;

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: JSON.stringify(capture.output) },
    ],
  };
}

// ─── Stats ──────────────────────────────────────────────────────────

function printStats(captures: RawCapture[]): void {
  const riskCounts: Record<string, number> = {};
  const confidenceCounts: Record<string, number> = {};
  const providerTypeCounts: Record<string, number> = {};
  const legalStatusCounts: Record<string, number> = {};

  for (const c of captures) {
    const out = c.output as Record<string, unknown>;
    const risk = String(out.riskLevel ?? 'UNKNOWN');
    const conf = String(out.confidence ?? 'UNKNOWN');
    const ptype = String(out.providerType ?? 'Unknown');
    const lstatus = String(out.legalStatus ?? 'Unknown');

    riskCounts[risk] = (riskCounts[risk] || 0) + 1;
    confidenceCounts[conf] = (confidenceCounts[conf] || 0) + 1;
    providerTypeCounts[ptype] = (providerTypeCounts[ptype] || 0) + 1;
    legalStatusCounts[lstatus] = (legalStatusCounts[lstatus] || 0) + 1;
  }

  console.log('\n=== Training Data Stats ===\n');
  console.log(`Total examples: ${captures.length}`);
  console.log(`Date range: ${captures[0]?.timestamp ?? 'N/A'} → ${captures[captures.length - 1]?.timestamp ?? 'N/A'}`);

  console.log('\nRisk Level Distribution:');
  for (const [k, v] of Object.entries(riskCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(10)} ${v} (${((v / captures.length) * 100).toFixed(1)}%)`);
  }

  console.log('\nConfidence Distribution:');
  for (const [k, v] of Object.entries(confidenceCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(10)} ${v} (${((v / captures.length) * 100).toFixed(1)}%)`);
  }

  console.log('\nProvider Type Distribution:');
  for (const [k, v] of Object.entries(providerTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }

  console.log('\nLegal Status Distribution:');
  for (const [k, v] of Object.entries(legalStatusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${v}`);
  }

  // Coverage warnings
  const totalRisk = Object.values(riskCounts).reduce((a, b) => a + b, 0);
  const minPerClass = 30;
  const underrepresented = Object.entries(riskCounts).filter(([_, v]) => v < minPerClass);
  if (underrepresented.length > 0) {
    console.log('\nWarnings:');
    for (const [k, v] of underrepresented) {
      console.log(`  Risk level "${k}" has only ${v} examples (recommend ${minPerClass}+)`);
    }
  }

  if (captures.length < 300) {
    console.log(`\n  Total examples (${captures.length}) below recommended minimum of 300`);
  } else if (captures.length >= 500) {
    console.log('\n  Dataset size looks good for fine-tuning');
  }
}

// ─── Main ───────────────────────────────────────────────────────────

const raw = loadCaptures(inputDir);
const deduped = deduplicateByInput(raw);

console.log(`Loaded ${raw.length} captures, ${deduped.length} after deduplication`);

printStats(deduped);

if (statsOnly) {
  process.exit(0);
}

const chatExamples = deduped.map(toChatExample);
const output = chatExamples.map((e) => JSON.stringify(e)).join('\n') + '\n';
writeFileSync(outputPath, output, 'utf-8');
console.log(`\nExported ${chatExamples.length} examples to ${outputPath}`);