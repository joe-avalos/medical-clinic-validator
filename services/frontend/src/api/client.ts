import axios from 'axios';
import type { RiskLevel } from '@medical-validator/shared';
import { getToken, clearToken } from '../lib/auth.js';

export interface VerifyResponse {
  jobId: string;
  status: 'queued' | 'completed';
  pollUrl: string;
  cached?: boolean;
  cachedAt?: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  results?: Record<string, unknown>[];
  errorMessage?: string;
}

export interface RecordsResponse {
  records: Record<string, unknown>[];
  total: number;
  nextCursor?: string;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearToken();
    }
    return Promise.reject(error);
  },
);

export async function checkHealth(): Promise<boolean> {
  try {
    await api.get('/health', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function submitVerification(
  companyName: string,
  jurisdiction?: string,
  forceRefresh?: boolean,
): Promise<VerifyResponse> {
  const body: Record<string, unknown> = { companyName };
  if (jurisdiction) body.jurisdiction = jurisdiction;
  if (forceRefresh) body.forceRefresh = true;
  const { data } = await api.post<VerifyResponse>('/verify', body);
  return data;
}

export async function fetchJobStatus(jobId: string): Promise<JobStatusResponse> {
  const { data } = await api.get<JobStatusResponse>(`/verify/${jobId}/status`);
  return data;
}

export interface TelemetryRecord {
  jobId: string;
  companyName: string;
  normalizedName: string;
  scraperProvider: string;
  aiProvider: string;
  cacheHit: boolean;
  companiesFound: number;
  pipelinePath: string;
  validationOutcomes: { success: number; fallback: number; empty: number };
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
}

export interface TelemetryResponse {
  records: TelemetryRecord[];
  total: number;
  nextCursor?: string;
}

export async function fetchTelemetry(params: {
  pipelinePath?: string;
  limit?: number;
  cursor?: string;
}): Promise<TelemetryResponse> {
  const query: Record<string, string> = {};
  if (params.pipelinePath) query.pipelinePath = params.pipelinePath;
  if (params.limit) query.limit = String(params.limit);
  if (params.cursor) query.cursor = params.cursor;
  const { data } = await api.get<TelemetryResponse>('/telemetry', { params: query });
  return data;
}

export async function fetchRecords(params: {
  riskLevel?: RiskLevel;
  limit?: number;
  cursor?: string;
}): Promise<RecordsResponse> {
  const query: Record<string, string> = {};
  if (params.riskLevel) query.riskLevel = params.riskLevel;
  if (params.limit) query.limit = String(params.limit);
  if (params.cursor) query.cursor = params.cursor;
  const { data } = await api.get<RecordsResponse>('/records', { params: query });
  return data;
}