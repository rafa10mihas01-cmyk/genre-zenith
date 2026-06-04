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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let done = false;
    const finish = (s: Session | null) => {
      if (done) return;
      done = true;
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    };

    // Listener FIRST — destrava o boot na primeira mudança de estado
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!done) {
        done = true;
        setLoading(false);
      }
    });

    // Then fetch existing session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      finish(s);
    }).catch(() => {
      // gotrue indisponível — libera o app mesmo assim (rotas protegidas vão
      // redirecionar pra /auth se não houver sessão).
      finish(null);
    });

    // Hard fallback: se em 4s nada resolveu (lock preso, gotrue 504),
    // libera o splash pra não deixar o usuário travado na tela preta.
    const safety = setTimeout(() => finish(null), 4000);

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
