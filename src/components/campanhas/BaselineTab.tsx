// BaselineTab — aba que mostra todas as playlists capturadas na baseline da
// campanha, organizadas por streams iniciais (maior pro menor), com capa,
// link pro Spotify, dono e seguidores.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Flag, ExternalLink, Music2, Users, FileSpreadsheet, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

type Row = {
  playlist_id: string;
  plays: number;
  captured_at: string;
  playlist_name: string | null;
  spotify_url: string | null;
  image_url: string | null;
  followers: number | null;
  spotify_owner_name: string | null;
  spotify_playlist_id: string | null;
  spotify_owner_id: string | null;
  isInternal?: boolean;
  curatorName?: string | null;
};


type BaselineUpload = {
  id: string;
  file_name: string | null;
  file_path: string | null;
  created_at: string;
  rows_imported: number | null;
};

type Props = {
  dealId: string | null;
};


function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

export function BaselineTab({ dealId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [upload, setUpload] = useState<BaselineUpload | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!dealId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);

      // 1) Pega o upload baseline mais antigo
      const { data: uploadRow } = await supabase
        .from("label_spreadsheet_uploads")
        .select("id, file_name, file_path, created_at, rows_imported")
        .eq("deal_id", dealId)
        .eq("is_baseline", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!uploadRow || cancelled) {
        setRows([]);
        setUpload(null);
        setCapturedAt(null);
        setLoading(false);
        return;
      }

      // 2) Lê as linhas brutas da planilha
      const { data: rawRows } = await supabase
        .from("label_spreadsheet_rows")
        .select("id, playlist_name, playlist_url, playlist_spotify_id, owner_name, streams, matched_playlist_id, matched_curator_id, is_internal, position")
        .eq("upload_id", uploadRow.id)
        .order("streams", { ascending: false });

      const raw = (rawRows ?? []) as Array<{
        id: string;
        playlist_name: string | null;
        playlist_url: string | null;
        playlist_spotify_id: string | null;
        owner_name: string | null;
        streams: number | null;
        matched_playlist_id: string | null;
        matched_curator_id: string | null;
        is_internal: boolean | null;
        position: number | null;
      }>;

      // 3) Enriquece via curator_playlists + cache spotify
      const spIds = Array.from(new Set(raw.map((r) => r.playlist_spotify_id).filter(Boolean) as string[]));
      const [cpRes, cacheRes] = await Promise.all([
        spIds.length
          ? supabase
              .from("curator_playlists")
              .select("spotify_playlist_id, image_url, followers, spotify_owner_id, spotify_owner_name, spotify_url")
              .in("spotify_playlist_id", spIds)
          : Promise.resolve({ data: [] as Array<any> }),
        spIds.length
          ? supabase
              .from("spotify_playlist_cache")
              .select("spotify_playlist_id, image_url, followers, owner_name")
              .in("spotify_playlist_id", spIds)
          : Promise.resolve({ data: [] as Array<any> }),
      ]);
      const cpMap = new Map((cpRes.data ?? []).map((p: any) => [p.spotify_playlist_id, p]));
      const cacheMap = new Map((cacheRes.data ?? []).map((p: any) => [p.spotify_playlist_id, p]));

      // 4) Engine + Curador
      const ownerIds = Array.from(
        new Set(
          raw
            .map((r) => cpMap.get(r.playlist_spotify_id ?? "")?.spotify_owner_id as string | undefined)
            .filter(Boolean) as string[],
        ),
      );
      const [internalRes, curatorsRes] = await Promise.all([
        spIds.length
          ? supabase.from("playlists").select("spotify_playlist_id").eq("ownership", "own").in("spotify_playlist_id", spIds)
          : Promise.resolve({ data: [] as Array<{ spotify_playlist_id: string }> }),
        ownerIds.length
          ? supabase.from("curators").select("spotify_owner_id, name").in("spotify_owner_id", ownerIds)
          : Promise.resolve({ data: [] as Array<{ spotify_owner_id: string; name: string }> }),
      ]);
      const internalSet = new Set((internalRes.data ?? []).map((p) => p.spotify_playlist_id));
      const curatorMap = new Map((curatorsRes.data ?? []).map((c) => [c.spotify_owner_id, c.name]));

      const buildRows = (cm: Map<string, any>): Row[] =>
        raw.map((r) => {
          const cp = r.playlist_spotify_id ? cpMap.get(r.playlist_spotify_id) : null;
          const cache = r.playlist_spotify_id ? cm.get(r.playlist_spotify_id) : null;
          const ownerId = cp?.spotify_owner_id ?? null;
          return {
            playlist_id: r.id,
            plays: Number(r.streams ?? 0),
            captured_at: uploadRow.created_at,
            playlist_name: r.playlist_name,
            spotify_url: r.playlist_url ?? cp?.spotify_url ?? null,
            image_url: cp?.image_url ?? cache?.image_url ?? null,
            followers: cp?.followers ?? cache?.followers ?? null,
            spotify_owner_name: r.owner_name ?? cp?.spotify_owner_name ?? cache?.owner_name ?? null,
            spotify_playlist_id: r.playlist_spotify_id,
            spotify_owner_id: ownerId,
            isInternal: r.playlist_spotify_id ? internalSet.has(r.playlist_spotify_id) : false,
            curatorName: ownerId ? curatorMap.get(ownerId) ?? null : null,
          };
        });

      if (cancelled) return;
      setRows(buildRows(cacheMap));
      setCapturedAt(uploadRow.created_at);
      setUpload(uploadRow as BaselineUpload);
      setLoading(false);

      // 5) Hidratação on-demand: IDs sem capa em nenhuma fonte
      const missing = spIds.filter((id) => {
        const cp = cpMap.get(id);
        const cache = cacheMap.get(id);
        return !cp?.image_url && !cache?.image_url;
      });

      if (missing.length === 0) return;

      setHydrating(true);
      try {
        // Chunks de 50 por chamada
        const merged = new Map(cacheMap);
        for (let i = 0; i < missing.length; i += 50) {
          if (cancelled) return;
          const chunk = missing.slice(i, i + 50);
          const { data } = await supabase.functions.invoke("enrich-playlist-covers", {
            body: { playlist_ids: chunk },
          });
          const cached = (data?.cached ?? []) as Array<{
            spotify_playlist_id: string;
            image_url: string | null;
            followers: number | null;
            owner_name: string | null;
          }>;
          cached.forEach((c) => merged.set(c.spotify_playlist_id, c));
          if (!cancelled) setRows(buildRows(merged));
        }
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);



  async function handleDownload() {
    if (!upload?.file_path) {
      toast({ title: "Planilha não disponível", description: "O arquivo original não foi armazenado.", variant: "destructive" });
      return;
    }
    setDownloading(true);
    const { data, error } = await supabase.storage
      .from("label-spreadsheets")
      .createSignedUrl(upload.file_path, 60 * 10);
    setDownloading(false);
    if (error || !data?.signedUrl) {
      toast({ title: "Erro ao gerar link", description: error?.message ?? "Tente novamente.", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }


  const totalStreams = useMemo(() => rows.reduce((acc, r) => acc + r.plays, 0), [rows]);

  if (!dealId) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          A campanha ainda não tem deal vinculado. Distribua pro ecossistema pra começar a registrar baseline.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header resumo */}
      <Card className="border-border/60 bg-card">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2.5">
              <Flag className="h-4 w-4 text-primary mt-0.5" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">Baseline da campanha</h2>
                  <span className="text-[10px] uppercase tracking-wide border border-primary/40 text-primary rounded px-1.5 py-0.5 font-medium">
                    Referência
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                  Ponto de partida. Os streams entregues são calculados subtraindo estes valores
                  dos números atuais. Tudo que já existia antes não conta como entrega.
                </p>
              </div>
            </div>
            <div className="flex gap-4 text-right">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Playlists</div>
                <div className="text-lg font-semibold text-foreground tabular-nums">{rows.length}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Streams iniciais</div>
                <div className="text-lg font-semibold text-foreground tabular-nums">{fmt(totalStreams)}</div>
              </div>
              {capturedAt && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Capturada</div>
                  <div className="text-sm font-medium text-foreground">
                    {new Date(capturedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Planilha original importada */}
      {upload && (
        <Card className="border-border/60 bg-card">
          <CardContent className="p-4 flex items-center gap-3 flex-wrap">
            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0 border border-border/60">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground truncate">
                {upload.file_name ?? "planilha.xlsx"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Importada em{" "}
                {new Date(upload.created_at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {upload.rows_imported != null && <> · {fmt(upload.rows_imported)} linhas</>}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownload}
              disabled={downloading || !upload.file_path}
              className="shrink-0"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {downloading ? "Gerando..." : "Baixar planilha"}
            </Button>
          </CardContent>
        </Card>
      )}



      {/* Lista de playlists */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            Nenhuma baseline registrada ainda. Importe a primeira planilha pra capturar o ponto de partida.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 bg-card">
          <CardContent className="p-0">
            {/* ~15 linhas visíveis (~56px cada) e scroll pro resto */}
            <ul className="divide-y divide-border/60 max-h-[840px] overflow-y-auto">

              {rows.map((r, idx) => (
                <li
                  key={r.playlist_id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="text-[11px] tabular-nums text-muted-foreground w-6 text-right shrink-0">
                    {idx + 1}
                  </div>
                  {r.image_url ? (
                    <img
                      src={r.image_url}
                      alt=""
                      className="h-10 w-10 rounded object-cover shrink-0 border border-border/60"
                      loading="lazy"
                    />
                  ) : hydrating && r.spotify_playlist_id ? (
                    <Skeleton className="h-10 w-10 rounded shrink-0" />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0 border border-border/60">
                      <Music2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {r.playlist_name ?? "Playlist sem nome"}
                      </span>
                      {r.isInternal && (
                        <span
                          className="text-[9px] uppercase tracking-wide bg-primary/15 text-primary border border-primary/40 rounded px-1.5 py-0.5 font-semibold shrink-0"
                          title="Playlist do nosso inventário interno"
                        >
                          Engine
                        </span>
                      )}
                      {!r.isInternal && r.curatorName && (
                        <span
                          className="text-[9px] uppercase tracking-wide bg-purple-500/15 text-purple-400 border border-purple-500/40 rounded px-1.5 py-0.5 font-semibold shrink-0"
                          title={`Curador cadastrado: ${r.curatorName}`}
                        >
                          Curador
                        </span>
                      )}

                      {r.spotify_url && (
                        <a
                          href={r.spotify_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-primary shrink-0"
                          title="Abrir no Spotify"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate flex items-center gap-2">
                      {r.spotify_owner_name && <span>{r.spotify_owner_name}</span>}
                      {r.followers != null && (
                        <span className="flex items-center gap-0.5">
                          <Users className="h-2.5 w-2.5" />
                          {fmt(r.followers)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums text-foreground">{fmt(r.plays)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">streams</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
