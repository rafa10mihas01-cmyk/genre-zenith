import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

function readCachedSession(): Session | null {
  if (typeof window === "undefined") return null;
  const key = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
  if (!key) return null;

  try {
    const cached = JSON.parse(window.localStorage.getItem(key) ?? "null");
    const session = cached?.currentSession ?? cached;
    const expiresAt = Number(session?.expires_at ?? 0);
    const stillValid = expiresAt > Math.floor(Date.now() / 1000) + 30;
    return session?.access_token && session?.user && stillValid ? (session as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readCachedSession());
  const [user, setUser] = useState<User | null>(() => readCachedSession()?.user ?? null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let released = false;
    const applySession = (s: Session | null) => {
      setSession(s);
      setUser(s?.user ?? null);
    };
    const release = () => {
      if (released) return;
      released = true;
      setLoading(false);
    };

    // Listener FIRST — destrava o boot na primeira mudança de estado
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      applySession(s);
      release();
    });

    // Then fetch existing session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      applySession(s);
      release();
    }).catch(() => {
      // gotrue indisponível — libera o app mesmo assim (rotas protegidas vão
      // redirecionar pra /auth se não houver sessão em cache).
      release();
    });

    // Hard fallback: se em 4s nada resolveu (lock preso, gotrue 504),
    // libera o splash sem apagar sessão em cache nem bloquear resolução tardia.
    const safety = setTimeout(release, 4000);

    return () => {
      clearTimeout(safety);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  // Perf: memoiza o value pra evitar re-render global em toda tela
  // consumidora a cada render do AuthProvider.
  const value = useMemo(
    () => ({ user, session, loading, signIn, signOut }),
    [user, session, loading, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
};
