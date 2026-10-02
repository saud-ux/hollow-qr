import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MeResponse } from "../../shared/types";
import { apiGet, setTokenGetter } from "./api";

interface AuthState {
  supabase: SupabaseClient;
  session: Session | null;
  /** true until the initial session has been restored from storage */
  loading: boolean;
  me: MeResponse | null;
  meError: unknown;
  refreshMe: () => Promise<MeResponse | null>;
  signOut: () => Promise<void>;
  /** set when the user arrived through a password-recovery link */
  recovery: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ supabase, children }: { supabase: SupabaseClient; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<unknown>(null);
  const [recovery, setRecovery] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    setTokenGetter(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });
    void supabase.auth.getSession().then(({ data }) => {
      sessionRef.current = data.session;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      sessionRef.current = next;
      setSession(next);
      if (!next) setMe(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const refreshMe = useCallback(async () => {
    if (!sessionRef.current) {
      setMe(null);
      return null;
    }
    try {
      const data = await apiGet<MeResponse>("/api/me");
      setMe(data);
      setMeError(null);
      return data;
    } catch (err) {
      setMeError(err);
      return null;
    }
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    apiGet<MeResponse>("/api/me")
      .then((data) => {
        if (!alive) return;
        setMe(data);
        setMeError(null);
      })
      .catch((err: unknown) => alive && setMeError(err));
    return () => {
      alive = false;
    };
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setMe(null);
  }, [supabase]);

  const value = useMemo(
    () => ({ supabase, session, loading, me, meError, refreshMe, signOut, recovery }),
    [supabase, session, loading, me, meError, refreshMe, signOut, recovery],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
