// useClients — biblioteca de clientes do usuário (espelha useCuratorDeals.curators).
// Refatorado para React Query: cache compartilhado entre /clientes e /clientes/:id,
// elimina spinner full-page ao voltar.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ClientType = "artist" | "label" | "manager" | "producer" | "other";

export type Client = {
  id: string;
  user_id: string;
  name: string;
  contact: string | null;
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
  logo_url: string | null;
  brand_color: string | null;
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
  logo_url?: string | null;
  brand_color?: string | null;
};

function buildUpdatePayload(input: Partial<NewClientInput>) {
  const keys: (keyof NewClientInput)[] = [
    "name","contact","notes","client_type","company","email","phone","instagram",
    "spotify_artist_url","city","country","primary_genre","monthly_listeners",
    "document","payment_terms","tags","logo_url","brand_color",
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

const CLIENTS_KEY = ["clients"] as const;

export function useClients() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: CLIENTS_KEY,
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Client[];
    },
  });

  const clients = query.data ?? [];
  const loading = query.isLoading && !query.data;
  const error = query.error ? (query.error as Error).message : null;

  const reload = useCallback(
    () => qc.invalidateQueries({ queryKey: CLIENTS_KEY }),
    [qc],
  );

  const enrichSpotifyIfPossible = useCallback(async (clientId: string, url: string | null | undefined) => {
    if (!url) return;
    if (!/artist\/[A-Za-z0-9]{22}/.test(url)) {
      console.warn("[useClients] URL Spotify inválida pro enrich:", url);
      return;
    }
    setEnrichingIds((prev) => {
      const next = new Set(prev);
      next.add(clientId);
      return next;
    });
    try {
      await supabase.functions.invoke("enrich-client-spotify", { body: { client_id: clientId } });
    } catch (e) {
      console.warn("[useClients] enrich-client-spotify falhou:", e);
    } finally {
      setEnrichingIds((prev) => {
        if (!prev.has(clientId)) return prev;
        const next = new Set(prev);
        next.delete(clientId);
        return next;
      });
    }
  }, []);

  const isEnriching = useCallback((id: string) => enrichingIds.has(id), [enrichingIds]);

  const addClient = useCallback(
    async (input: NewClientInput) => {
      if (!user) throw new Error("Usuário não autenticado");
      const payload = {
        user_id: user.id,
        name: input.name,
        ...buildUpdatePayload({ ...input, name: undefined }),
      };
      const { data, error } = await supabase
        .from("clients")
        .insert(payload as any)
        .select()
        .single();
      if (error) throw error;
      const created = data as Client;
      await enrichSpotifyIfPossible(created.id, input.spotify_artist_url);
      await reload();
      return created;
    },
    [user, reload, enrichSpotifyIfPossible],
  );

  const updateClient = useCallback(
    async (id: string, input: Partial<NewClientInput>) => {
      const { error } = await supabase
        .from("clients")
        .update(buildUpdatePayload(input) as any)
        .eq("id", id);
      if (error) throw error;
      if (input.spotify_artist_url) {
        await enrichSpotifyIfPossible(id, input.spotify_artist_url);
      }
      await reload();
    },
    [reload, enrichSpotifyIfPossible],
  );

  const archiveClient = useCallback(
    async (id: string, archive = true) => {
      const { error } = await supabase
        .from("clients")
        .update({ archived_at: archive ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
      await reload();
    },
    [reload],
  );

  const deleteClient = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
      await reload();
    },
    [reload],
  );

  return { clients, loading, error, addClient, updateClient, archiveClient, deleteClient, reload, isEnriching };
}
