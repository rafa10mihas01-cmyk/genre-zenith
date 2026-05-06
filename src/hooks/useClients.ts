// useClients — biblioteca de clientes do usuário (espelha useCuratorDeals.curators).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type Client = {
  id: string;
  user_id: string;
  name: string;
  contact: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewClientInput = {
  name: string;
  contact?: string | null;
  notes?: string | null;
};

export function useClients() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setClients([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setClients((data ?? []) as Client[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const addClient = useCallback(
    async (input: NewClientInput) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { data, error: err } = await supabase
        .from("clients")
        .insert({
          user_id: user.id,
          name: input.name,
          contact: input.contact ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single();
      if (err) throw err;
      await load();
      return data as Client;
    },
    [user, load],
  );

  const updateClient = useCallback(
    async (id: string, input: Partial<NewClientInput>) => {
      const { error: err } = await supabase
        .from("clients")
        .update({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.contact !== undefined && { contact: input.contact ?? null }),
          ...(input.notes !== undefined && { notes: input.notes ?? null }),
        })
        .eq("id", id);
      if (err) throw err;
      await load();
    },
    [load],
  );

  return { clients, loading, error, addClient, updateClient, reload: load };
}
