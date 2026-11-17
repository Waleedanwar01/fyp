import axios from "axios";
import Cookies from "js-cookie";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

const ACCESS_TOKEN_COOKIE = "avtr_access_token";
const REFRESH_TOKEN_COOKIE = "avtr_refresh_token";

const cookieOptions = () => ({
  // "strict": these cookies are never needed on a cross-site request (no
  // links into this app carry auth), so there's no reason to relax it to
  // "lax" the way a public content site would.
  sameSite: "strict" as const,
  secure: typeof window !== "undefined" && window.location.protocol === "https:",
});

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return Cookies.get(ACCESS_TOKEN_COOKIE) ?? null;
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return Cookies.get(REFRESH_TOKEN_COOKIE) ?? null;
}

export function setTokens(access: string, refresh: string): void {
  // Matches the backend: REFRESH_TOKEN_LIFETIME / the 24h absolute session
  // cap in CustomTokenRefreshSerializer both cap out at 24 hours, so there's
  // no reason for the cookie holding it to outlive that.
  Cookies.set(ACCESS_TOKEN_COOKIE, access, { ...cookieOptions(), expires: 1 });
  Cookies.set(REFRESH_TOKEN_COOKIE, refresh, { ...cookieOptions(), expires: 1 });
}

export function clearTokens(): void {
  Cookies.remove(ACCESS_TOKEN_COOKIE);
  Cookies.remove(REFRESH_TOKEN_COOKIE);
}

export const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  try {
    const { data } = await axios.post(`${API_BASE_URL}/auth/token/refresh/`, { refresh });
    const newRefresh = (data.refresh as string | undefined) ?? refresh;
    setTokens(data.access, newRefresh);
    return data.access as string;
  } catch {
    clearTokens();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original._retry && getRefreshToken()) {
      original._retry = true;
      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
      const newAccess = await refreshPromise;
      if (newAccess) {
        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      }
    }
    // A write refused because the subscription lapsed: let the app shell
    // show its "Renew to continue" prompt (components/billing/subscription-lock.tsx).
    const method = (original?.method ?? "get").toLowerCase();
    if (error.response?.status === 402 && method !== "get" && typeof window !== "undefined") {
      const detail = (error.response.data as { detail?: string } | undefined)?.detail;
      window.dispatchEvent(new CustomEvent("avtr:subscription-required", { detail }));
    }
    return Promise.reject(error);
  }
);

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data as Record<string, unknown>;
    if (typeof data.detail === "string") return data.detail;

    const firstKey = Object.keys(data)[0];
    if (firstKey) {
      const value = data[firstKey];
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      if (typeof value === "string") return value;
    }
  }
  return "Something went wrong. Please try again.";
}

/** The login endpoint attaches a `warning` field (e.g. "2 attempts
 * remaining") alongside `detail` when a failed login is approaching the
 * account-lockout threshold -- surfaced separately so it can be styled
 * differently from the error itself. */
export function extractErrorWarning(error: unknown): string | null {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data as Record<string, unknown>;
    if (typeof data.warning === "string") return data.warning;
  }
  return null;
}
