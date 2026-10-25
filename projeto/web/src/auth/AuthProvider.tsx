import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { PLATFORM } from "../lib/platform";
import type { Profile } from "../lib/types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  notice: string | null;
  setNotice: (msg: string | null) => void;
  refreshProfile: () => Promise<Profile | null>;
  /** Registra o login (log de acesso) e recusa contas pausadas/bloqueadas. */
  recordSignIn: (event?: "sign_in" | "signup") => Promise<void>;
  signOut: (reason?: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const INACTIVE_MSG: Record<string, string> = {
  paused: "Seu acesso foi pausado pelo professor.",
  blocked: "Seu acesso foi cancelado. Fale com o professor.",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from("edu_profiles").select("*").eq("id", userId).maybeSingle();
    setProfile((data as Profile) ?? null);
    return (data as Profile) ?? null;
  }, []);

  const signOut = useCallback(async (reason?: string) => {
    if (reason) setNotice(reason);
    await supabase.rpc("edu_log_access", { p_event: "sign_out", p_platform: PLATFORM, p_user_agent: navigator.userAgent }).then(
      () => undefined,
      () => undefined,
    );
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        const p = await loadProfile(data.session.user.id);
        if (!p) await supabase.auth.signOut(); // sessão sem perfil EduPDF
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setProfile(null);
      else setTimeout(() => void loadProfile(next.user.id), 0); // fora do callback do Auth
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Tempo real: se o admin pausar/bloquear, o app sai na hora.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`profile-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "edu_profiles", filter: `id=eq.${userId}` }, (payload) => {
        const next = payload.new as Profile;
        setProfile(next);
        if (next.status === "paused" || next.status === "blocked") void signOut(INACTIVE_MSG[next.status]);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, signOut]);

  // Se um perfil carregado estiver inativo (ex.: sessão antiga), encerra.
  useEffect(() => {
    if (profile && (profile.status === "paused" || profile.status === "blocked")) void signOut(INACTIVE_MSG[profile.status]);
  }, [profile, signOut]);

  const recordSignIn = useCallback(
    async (event: "sign_in" | "signup" = "sign_in") => {
      const { data, error } = await supabase.rpc("edu_log_access", {
        p_event: event,
        p_platform: PLATFORM,
        p_user_agent: navigator.userAgent,
      });
      if (error) {
        await supabase.auth.signOut(); // ex.: conta de outro sistema sem perfil EduPDF
        throw error;
      }
      const status = (data as { status: string }).status;
      if (status !== "active") {
        await supabase.auth.signOut();
        throw new Error(INACTIVE_MSG[status] ?? "Acesso indisponível.");
      }
      const { data: s } = await supabase.auth.getSession();
      if (s.session) await loadProfile(s.session.user.id);
    },
    [loadProfile],
  );

  const refreshProfile = useCallback(async () => (userId ? loadProfile(userId) : null), [userId, loadProfile]);

  const value = useMemo(
    () => ({ session, profile, loading, notice, setNotice, refreshProfile, recordSignIn, signOut }),
    [session, profile, loading, notice, refreshProfile, recordSignIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
