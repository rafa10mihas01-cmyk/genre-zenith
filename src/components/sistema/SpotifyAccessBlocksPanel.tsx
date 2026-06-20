// Apps sem acesso — diagnóstico de Apps Spotify em Development Mode.
// Mostra exatamente quais apps/usuários/playlists estão sendo bloqueados
// porque o usuário não está na whitelist do Spotify Developer Dashboard.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Copy, AlertOctagon, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Row = {
  app_id: string | null;
  app_name: string | null;
  client_id: string | null;
  spotify_user_id: string | null;
  spotify_user_name: string | null;
  spotify_playlist_id: string | null;
  playlist_name: string | null;
  playlist_owner_id: string | null;
  playlist_owner_name: string | null;
  playlist_url: string | null;
  spotify_user_url: string | null;
  reason: string | null;
  error_count: number;
  first_seen: string | null;
  last_seen: string | null;
  sample_error: string | null;
};

function fmtLocal(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function copy(text: string, label = "Copiado") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Falha ao copiar");
  }
}

function useAccessBlocks() {
  return useQuery({
    queryKey: ["spotify-app-access-blocks"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("get_spotify_app_access_blocks" as never);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });
}

type BlockedApp = {
  id: string;
  name: string;
  quarantine_reason: string | null;
  updated_at: string | null;
};

function useBlockedApps() {
  return useQuery({
    queryKey: ["spotify-apps-dev-mode-blocked"],
    queryFn: async (): Promise<BlockedApp[]> => {
      const { data, error } = await supabase
        .from("spotify_apps")
        .select("id,name,quarantine_reason,updated_at")
        .eq("status", "quarantined")
        .like("quarantine_reason", "development_mode_blocked%")
        .order("name");
      if (error) throw error;
      return (data ?? []) as BlockedApp[];
    },
    refetchInterval: 60_000,
  });
}


export function SpotifyAccessBlocksPanel() {
  const { data, isLoading, refetch, isFetching } = useAccessBlocks();
  const rows = data ?? [];
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const summary = useMemo(() => {
    const apps = new Map<string, string>();
    const users = new Set<string>();
    const playlists = new Set<string>();
    let total = 0;
    for (const r of rows) {
      if (r.app_id) apps.set(r.app_id, r.app_name ?? r.app_id);
      if (r.spotify_user_id) users.add(r.spotify_user_id);
      if (r.spotify_playlist_id) playlists.add(r.spotify_playlist_id);
      total += r.error_count;
    }
    return {
      apps: Array.from(apps.entries()).map(([id, name]) => ({ id, name })),
      users: Array.from(users),
      playlists: Array.from(playlists),
      total,
    };
  }, [rows]);

  const groupedByApp = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const key = r.app_id ?? "unknown";
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [rows]);

  function toggle(key: string) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  return (
    <Card id="spotify-access-blocks" className="overflow-hidden scroll-mt-20">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <AlertOctagon className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold">Apps sem acesso (Development Mode)</h3>
          {summary.apps.length > 0 && (
            <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">
              {summary.apps.length} app{summary.apps.length > 1 ? "s" : ""} · {summary.users.length} usuário{summary.users.length !== 1 ? "s" : ""} · {summary.playlists.length} playlist{summary.playlists.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="flex items-start gap-2 px-4 py-2.5 border-b border-border bg-muted/30 text-[11px] text-muted-foreground">
        <AlertOctagon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div>
          Esses apps estão em <strong>Development Mode</strong> no Spotify e os usuários abaixo <strong>não estão na whitelist</strong>.
          Para resolver: abra o Developer Dashboard, vá em <em>User Management</em> e adicione o e-mail/ID do usuário,
          ou solicite <em>Extended Quota Mode</em>. Enquanto isso, toda chamada falha com 403 permanente (sem retry).
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 grid place-items-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">
          Nenhum bloqueio de whitelist detectado nas últimas tentativas.
        </div>
      ) : (
        <div>
          {groupedByApp.map(([appId, appRows]) => {
            const first = appRows[0];
            const isOpen = expanded.has(appId);
            const totalErrors = appRows.reduce((s, r) => s + r.error_count, 0);
            const uniqueUsers = new Set(appRows.map((r) => r.spotify_user_id).filter(Boolean)).size;
            const uniquePls = new Set(appRows.map((r) => r.spotify_playlist_id).filter(Boolean)).size;
            return (
              <div key={appId} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => toggle(appId)}
                  className="w-full grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-4 py-3 hover:bg-elevated/40 text-left"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{first.app_name ?? "App desconhecido"}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {first.client_id ?? "—"}
                    </div>
                  </div>
                  <div className="text-right text-xs tabular-nums">
                    <div className="text-foreground font-semibold">{totalErrors}</div>
                    <div className="text-[10px] text-muted-foreground">erros</div>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground tabular-nums min-w-[110px]">
                    {uniqueUsers} usuário{uniqueUsers !== 1 ? "s" : ""} · {uniquePls} playlist{uniquePls !== 1 ? "s" : ""}
                  </div>
                </button>

                {isOpen && (
                  <div className="bg-elevated/20 border-t border-border">
                    <div className="grid grid-cols-[1.2fr_1.5fr_1fr_auto_auto_auto] gap-3 items-center px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
                      <div>Usuário Spotify</div>
                      <div>Playlist</div>
                      <div>Owner</div>
                      <div className="text-right">Erros</div>
                      <div className="text-right">Última</div>
                      <div className="text-right">Ações</div>
                    </div>
                    {appRows.map((r, i) => (
                      <div
                        key={`${appId}-${r.spotify_user_id ?? "?"}-${r.spotify_playlist_id ?? "?"}-${i}`}
                        className="grid grid-cols-[1.2fr_1.5fr_1fr_auto_auto_auto] gap-3 items-center px-4 py-2.5 border-b border-border last:border-0 text-xs"
                      >
                        <div className="min-w-0">
                          {r.spotify_user_id ? (
                            <a
                              href={r.spotify_user_url ?? `https://open.spotify.com/user/${r.spotify_user_id}`}
                              target="_blank" rel="noreferrer"
                              className="text-foreground hover:text-primary inline-flex items-center gap-1 truncate"
                              title={r.spotify_user_id}
                            >
                              <span className="font-mono truncate">{r.spotify_user_name ?? r.spotify_user_id}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : <span className="text-muted-foreground">—</span>}
                        </div>
                        <div className="min-w-0">
                          {r.spotify_playlist_id ? (
                            <a
                              href={r.playlist_url ?? `https://open.spotify.com/playlist/${r.spotify_playlist_id}`}
                              target="_blank" rel="noreferrer"
                              className="text-foreground hover:text-primary inline-flex items-center gap-1 truncate"
                              title={r.spotify_playlist_id}
                            >
                              <span className="truncate">{r.playlist_name ?? r.spotify_playlist_id}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : <span className="text-muted-foreground">—</span>}
                        </div>
                        <div className="min-w-0 text-muted-foreground truncate" title={r.playlist_owner_id ?? undefined}>
                          {r.playlist_owner_name ?? r.playlist_owner_id ?? "—"}
                        </div>
                        <div className="text-right tabular-nums font-medium">{r.error_count}</div>
                        <div className="text-right tabular-nums text-muted-foreground">{fmtLocal(r.last_seen)}</div>
                        <div className="flex items-center justify-end gap-1">
                          {r.spotify_user_id && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-[11px] gap-1"
                              onClick={() => copy(r.spotify_user_id!, "Usuário copiado pra whitelist")}
                              title="Copiar usuário para colar em User Management"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-[11px] gap-1"
                            onClick={() => window.open("https://developer.spotify.com/dashboard", "_blank")}
                            title="Abrir Spotify Developer Dashboard"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="px-4 py-2 flex items-center justify-end gap-2 bg-muted/20">
                      {first.client_id && (
                        <Button
                          variant="outline" size="sm" className="h-7 text-[11px] gap-1"
                          onClick={() => copy(first.client_id!, "Client ID copiado")}
                        >
                          <Copy className="h-3 w-3" /> Client ID
                        </Button>
                      )}
                      <Button
                        variant="outline" size="sm" className="h-7 text-[11px] gap-1"
                        onClick={() => window.open("https://developer.spotify.com/dashboard", "_blank")}
                      >
                        <ExternalLink className="h-3 w-3" /> Developer Dashboard
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Resumo final */}
          <div className="px-4 py-3 bg-muted/20 border-t border-border text-[11px] text-muted-foreground space-y-1">
            <div><strong className="text-foreground">{summary.apps.length}</strong> app{summary.apps.length !== 1 ? "s" : ""} em Development Mode · <strong className="text-foreground">{summary.users.length}</strong> usuário{summary.users.length !== 1 ? "s" : ""} bloqueado{summary.users.length !== 1 ? "s" : ""} · <strong className="text-foreground">{summary.playlists.length}</strong> playlist{summary.playlists.length !== 1 ? "s" : ""} sem acesso · <strong className="text-foreground">{summary.total}</strong> erros totais</div>
          </div>
        </div>
      )}
    </Card>
  );
}
