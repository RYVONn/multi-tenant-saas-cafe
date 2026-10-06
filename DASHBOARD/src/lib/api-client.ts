// Thin fetch-based API client for the BACKEND Express API.
//
// - Base URL comes from VITE_API_URL (see .env.example), falling back to a
//   sane local default so `npm run dev` works out of the box.
// - Attaches `Authorization: Bearer <token>` from localStorage on every
//   request once a token exists (see TOKEN_KEY). The dashboard's auth is
//   still mock-only (src/lib/auth.tsx) — this is the hook real login will
//   write into once it exists.
// - Normalizes errors into a single `ApiError` shape so callers can show a
//   consistent message via sonner toasts.
// - On 401, clears the stored token and redirects to the login page.

const TOKEN_KEY = "cafe-saas-token";

export const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:3000/api";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable (SSR, privacy mode) — ignore.
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; query?: Record<string, string | number | boolean | undefined> };

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(path.replace(/^\//, ""), `${BASE_URL}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;
  const token = getToken();

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const res = await fetch(buildUrl(path, query), {
    ...rest,
    headers: {
      ...(isFormData ? {} : body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 401) {
    setToken(null);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new ApiError("Unauthorized", 401);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const extracted = data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : null;
    const message = extracted ?? (res.statusText || "Request failed");
    throw new ApiError(message, res.status);
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) => request<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
