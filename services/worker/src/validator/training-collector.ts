import { appendFileSync, chmodSync, existsSync, mkdirSync, statSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';
import { createLogger } from '../shared/logger.js';

const log = createLogger('training-collector');

export interface TrainingExample {
  timestamp: string;
  input: RawCompanyRecord;
  output: ValidationResult;
  provider: string;
  model: string;
}

const TRAINING_DIR = resolve(process.env.TRAINING_DATA_DIR || join(process.cwd(), 'training-data'));
const MAX_FILE_SIZE_MB = Math.max(1, parseInt(process.env.TRAINING_MAX_FILE_MB ?? '', 10) || 10);
const ENABLED = process.env.TRAINING_CAPTURE_ENABLED !== 'false'; // on by default

function ensureDir(): void {
  if (!existsSync(TRAINING_DIR)) {
    mkdirSync(TRAINING_DIR, { recursive: true, mode: 0o700 });
    log.info({ dir: TRAINING_DIR }, 'Created training data directory');
  }
}

function currentFilePath(): string {
  return join(TRAINING_DIR, 'captures.jsonl');
}

function rotateIfNeeded(filePath: string): void {
  if (!existsSync(filePath)) return;

  const stats = statSync(filePath);
  const sizeMB = stats.size / (1024 * 1024);

  if (sizeMB >= MAX_FILE_SIZE_MB) {
    const rotatedName = `captures-${Date.now()}.jsonl`;
    const rotatedPath = join(TRAINING_DIR, rotatedName);
    renameSync(filePath, rotatedPath);
    log.info({ rotatedTo: rotatedName, sizeMB: sizeMB.toFixed(2) }, 'Rotated training data file');
  }
}

export function captureTrainingExample(
  input: RawCompanyRecord,
  output: ValidationResult,
  provider: string,
  model: string,
): void {
  if (!ENABLED) return;

  // Skip fallback results — they're not useful training data
  if (output.riskFlags.includes('AI validation unavailable')) return;

  try {
    ensureDir();
    const filePath = currentFilePath();
    rotateIfNeeded(filePath);

    const example: TrainingExample = {
      timestamp: new Date().toISOString(),
      input,
      output,
      provider,
      model,
    };

    const isNew = !existsSync(filePath);
    appendFileSync(filePath, JSON.stringify(example) + '\n', 'utf-8');
    if (isNew) {
      chmodSync(filePath, 0o600);
    }
  } catch (err) {
    // Never let training capture break the main pipeline
    log.warn({ err: (err as Error).message }, 'Failed to capture training example');
  }
}

export function getTrainingStats(): { totalFiles: number; totalExamples: number; oldestCapture: string | null } {
  if (!existsSync(TRAINING_DIR)) {
    return { totalFiles: 0, totalExamples: 0, oldestCapture: null };
  }

  const files = readdirSync(TRAINING_DIR).filter((f) => f.endsWith('.jsonl'));
  let totalLines = 0;
  let oldestCapture: string | null = null;

  for (const file of files) {
    const filePath = join(TRAINING_DIR, file);
    const stats = statSync(filePath);
    // Rough line count from file size (avg ~500 bytes per example)
    totalLines += Math.max(1, Math.round(stats.size / 500));
    if (!oldestCapture || stats.birthtimeMs < new Date(oldestCapture).getTime()) {
      oldestCapture = stats.birthtime.toISOString();
    }
  }

  return { totalFiles: files.length, totalExamples: totalLines, oldestCapture };
}