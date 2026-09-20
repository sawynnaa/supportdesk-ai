export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
    credentials: 'same-origin',
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, data.code, data.message || '请求失败');
  }
  return data;
}
export function post<T = any>(path: string, body: any = {}, headers: Record<string, string> = {}) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body), headers });
}
export function streamFetch(path: string, body: any, signal: AbortSignal) {
  return fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(body),
    signal,
  });
}
export const date = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
