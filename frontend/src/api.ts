// Centralised API base resolution. When VITE_API_URL is empty the app uses
// same-origin requests (works behind Caddy at https://bench.brw.ai). Otherwise
// requests go to the configured host (e.g. http://localhost:8080 in dev).
const API_BASE: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}
