import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
    let mounted = true;
    const authFallback = window.setTimeout(() => {
      if (mounted) setLoading(false);
    }, 2500);

    // Listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Then fetch existing session, but never keep the app blank if auth stalls.
    supabase.auth.getSession()
      .then(({ data: { session: s } }) => {
        if (!mounted) return;
        setSession(s);
        setUser(s?.user ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        setSession(null);
        setUser(null);
      })
      .finally(() => {
        if (!mounted) return;
        window.clearTimeout(authFallback);
        setLoading(false);
      });

    return () => {
      mounted = false;
      window.clearTimeout(authFallback);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return <Ctx.Provider value={{ user, session, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
};
