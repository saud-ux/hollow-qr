import { errorMessageAr } from "../../shared/messages";
import type { ApiErrorBody } from "../../shared/types";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = () => Promise.resolve(null);

export function setTokenGetter(fn: TokenGetter) {
  getToken = fn;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiClientError(0, "NETWORK", "تعذّر الاتصال بالخادم، تحقق من الإنترنت");
  }
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // non-JSON error
    }
    const code = body?.error.code ?? "INTERNAL";
    throw new ApiClientError(res.status, code, body?.error.message ?? errorMessageAr(code), body?.error.details ?? {});
  }
  return res;
}

export async function apiGet<T>(path: string): Promise<T> {
  return (await (await request(path)).json()) as T;
}

export async function apiPost<T>(path: string, body: unknown = {}): Promise<T> {
  return (await (await request(path, { method: "POST", body: JSON.stringify(body) })).json()) as T;
}

/** Downloads an authenticated file (CSV exports) and saves it. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await request(path);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function errorText(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return errorMessageAr("INTERNAL");
}
