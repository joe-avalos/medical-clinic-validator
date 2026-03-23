const TOKEN_KEY = 'mv_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? import.meta.env.VITE_DEV_JWT ?? null;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}