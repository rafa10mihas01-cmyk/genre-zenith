// useClients — biblioteca de clientes do usuário (espelha useCuratorDeals.curators).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ClientType = "artist" | "label" | "manager" | "producer" | "other";

export type Client = {
  id: string;
  user_id: string;
  name: string;
  contact: string | null; // legado, mantido por compatibilidade
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  client_type: ClientType;
  company: string | null;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  spotify_artist_url: string | null;
  spotify_artist_id: string | null;
  image_url: string | null;
  city: string | null;
  country: string | null;
  primary_genre: string | null;
  monthly_listeners: number | null;
  document: string | null;
  payment_terms: string | null;
  tags: string[];
};

export type NewClientInput = {
  name: string;
  contact?: string | null;
  notes?: string | null;
  client_type?: ClientType;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  instagram?: string | null;
  spotify_artist_url?: string | null;
  city?: string | null;
  country?: string | null;
  primary_genre?: string | null;
  monthly_listeners?: number | null;
  document?: string | null;
  payment_terms?: string | null;
  tags?: string[];
};

// Helper: monta o payload de update apenas com chaves presentes em `input`.
function buildUpdatePayload(input: Partial<NewClientInput>) {
  const keys: (keyof NewClientInput)[] = [
    "name","contact","notes","client_type","company","email","phone","instagram",
    "spotify_artist_url","city","country","primary_genre","monthly_listeners",
    "document","payment_terms","tags",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (input[k] !== undefined) {
      const v = input[k];
      out[k] = typeof v === "string" ? (v as string) || null : v ?? null;
    }
  }
  return out;
}

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

  // Gap 5: enriquecimento opcional via /v1/artists/{id} a partir da spotify_artist_url.
  const enrichSpotifyIfPossible = useCallback(async (clientId: string, url: string | null | undefined) => {
    if (!url || !/artist\/[A-Za-z0-9]{22}/.test(url)) return;
    try {
      await supabase.functions.invoke("enrich-client-spotify", { body: { client_id: clientId } });
    } catch (e) {
      // Enrichment é best-effort — falha não interrompe o fluxo do cliente.
      console.warn("[useClients] enrich-client-spotify falhou:", e);
    }
  }, []);

  const addClient = useCallback(
    async (input: NewClientInput) => {
      if (!user) throw new Error("Usuário não autenticado");
      const payload = {
        user_id: user.id,
        name: input.name,
        ...buildUpdatePayload({ ...input, name: undefined }),
      };
      const { data, error: err } = await supabase
        .from("clients")
        .insert(payload as any)
        .select()
        .single();
      if (err) throw err;
      const created = data as Client;
      await enrichSpotifyIfPossible(created.id, input.spotify_artist_url);
      await load();
      return created;
    },
    [user, load, enrichSpotifyIfPossible],
  );

  const updateClient = useCallback(
    async (id: string, input: Partial<NewClientInput>) => {
      const { error: err } = await supabase
        .from("clients")
        .update(buildUpdatePayload(input) as any)
        .eq("id", id);
      if (err) throw err;
      if (input.spotify_artist_url !== undefined) {
        await enrichSpotifyIfPossible(id, input.spotify_artist_url);
      }
      await load();
    },
    [load, enrichSpotifyIfPossible],
  );

  const archiveClient = useCallback(
    async (id: string, archive = true) => {
      const { error: err } = await supabase
        .from("clients")
        .update({ archived_at: archive ? new Date().toISOString() : null })
        .eq("id", id);
      if (err) throw err;
      await load();
    },
    [load],
  );

  const deleteClient = useCallback(
    async (id: string) => {
      const { error: err } = await supabase.from("clients").delete().eq("id", id);
      if (err) throw err;
      await load();
    },
    [load],
  );

  return { clients, loading, error, addClient, updateClient, archiveClient, deleteClient, reload: load };
}
