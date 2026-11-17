"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, clearTokens, getAccessToken, getRefreshToken, setTokens } from "@/lib/api";

// Auto-logout after this long with no user interaction, even though the
// underlying tokens are still technically valid -- separate from (and
// shorter than) the backend's 24-hour absolute session cap, which covers
// the "left it open all day" case; this covers "walked away mid-session."
const IDLE_LOGOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"] as const;

export type Agency = {
  id: string;
  name: string;
  subdomain: string | null;
  logo_url: string;
  white_label_config: Record<string, unknown>;
  created_at: string;
};

export type User = {
  id: string;
  email: string;
  role: "admin" | "member";
  agency: Agency | null;
  is_active: boolean;
  date_joined: string;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    agencyName: string,
    email: string,
    password: string,
    plan?: string,
    billingInterval?: "monthly" | "yearly"
  ) => Promise<void>;
  verifyEmail: (uid: string, token: string) => Promise<void>;
  acceptInvite: (uid: string, token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Push a freshly saved agency into the signed-in user, so the app
   * shell's name, logo and colours update without a page reload. */
  updateAgency: (agency: Agency) => void;
};

const ME_QUERY_KEY = ["auth", "me"];

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<User | null> {
  if (!getAccessToken()) return null;
  try {
    const { data } = await api.get<User>("/auth/me/");
    return data;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: 60_000,
    retry: false,
  });

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post("/auth/token/", { email, password });
      setTokens(data.access, data.refresh);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
    [queryClient]
  );

  const register = useCallback(
    async (
      agencyName: string,
      email: string,
      password: string,
      plan?: string,
      billingInterval?: "monthly" | "yearly"
    ) => {
      // No tokens come back here -- the account is created inactive and can't
      // log in until the emailed verification link is followed (see verifyEmail).
      const payload: Record<string, unknown> = {
        agency_name: agencyName,
        email,
        password,
      };
      if (plan) {
        payload.plan = plan;
        payload.billing_interval = billingInterval || "monthly";
      }
      await api.post("/auth/register/", payload);
    },
    []
  );

  const verifyEmail = useCallback(
    async (uid: string, token: string) => {
      const { data } = await api.post("/auth/verify-email/", { uid, token });
      setTokens(data.access, data.refresh);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
    [queryClient]
  );

  const acceptInvite = useCallback(
    async (uid: string, token: string, password: string) => {
      const { data } = await api.post("/team-members/accept-invite/", { uid, token, password });
      setTokens(data.access, data.refresh);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
    [queryClient]
  );

  const logout = useCallback(async () => {
    const refresh = getRefreshToken();
    if (refresh) {
      try {
        await api.post("/auth/token/blacklist/", { refresh });
      } catch {
        // Token may already be invalid/expired -- clearing client state is what matters.
      }
    }
    clearTokens();
    queryClient.setQueryData(ME_QUERY_KEY, null);
    router.push("/login");
  }, [queryClient, router]);

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;

    const resetIdleTimer = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(logout, IDLE_LOGOUT_MS);
    };

    resetIdleTimer();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetIdleTimer));

    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetIdleTimer));
    };
  }, [user, logout]);

  const updateAgency = (agency: Agency) => {
    queryClient.setQueryData<User | null>(ME_QUERY_KEY, (prev) => (prev ? { ...prev, agency } : prev));
  };

  return (
    <AuthContext.Provider
      value={{ user: user ?? null, loading: isLoading, login, register, verifyEmail, acceptInvite, logout, updateAgency }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
