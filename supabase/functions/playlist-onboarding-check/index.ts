// playlist-onboarding-check — avalia uma managed_playlist contra padrões mínimos
// do nicho e grava onboarding_checklist + promove pra "testing" quando estável.
// Body: { playlist_id: string }   (managed_playlists.id)
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Checklist = {
  name_ok: boolean;
  description_ok: boolean;
  min_tracks_ok: boolean;
  cover_ok: boolean;
  niche_alignment_ok: boolean;
  niche_alignment_score: number; // 0..1
  blocking_issues: string[];
  hints: string[];
  ready_for_deals: boolean;
  checked_at: string;
};

const MIN_TRACKS = 25;
const MIN_NAME_LEN = 6;
const MIN_DESC_LEN = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const isCron = CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  const isService = req.headers.get("Authorization") === `Bearer ${SERVICE_KEY}`;
  if (!isCron && !isService) {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string = body?.playlist_id;
    if (!playlistId) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: pl, error } = await supabase
      .from("managed_playlists")
      .select("id, name, description, cover_url, tracks_count, genre_id, lifecycle_stage, onboarding_ready_streak")
      .eq("id", playlistId)
      .maybeSingle();
    if (error || !pl) return jr({ ok: false, error: error?.message ?? "not found" }, 404);

    // Benchmark do nicho (se houver)
    let benchmark: { tracks_p50: number | null; tracks_p75: number | null } | null = null;
    if (pl.genre_id) {
      const { data: b } = await supabase
        .from("genre_benchmarks")
        .select("tracks_p50, tracks_p75")
        .eq("genre_id", pl.genre_id)
        .maybeSingle();
      benchmark = b as any;
    }

    const blocking: string[] = [];
    const hints: string[] = [];

    const name = (pl.name ?? "").trim();
    const desc = (pl.description ?? "").trim();
    const tracks = pl.tracks_count ?? 0;
    const cover = !!pl.cover_url;

    const name_ok = name.length >= MIN_NAME_LEN;
    if (!name_ok) blocking.push("name_too_short");

    const description_ok = desc.length >= MIN_DESC_LEN;
    if (!description_ok) blocking.push("description_empty_or_short");

    // Tamanho mínimo: usa benchmark p50 se existir, senão MIN_TRACKS
    const targetMin = Math.max(MIN_TRACKS, Math.floor((benchmark?.tracks_p50 ?? MIN_TRACKS) * 0.5));
    const min_tracks_ok = tracks >= targetMin;
    if (!min_tracks_ok) blocking.push(`min_tracks_${targetMin}`);

    const cover_ok = cover;
    if (!cover_ok) blocking.push("cover_missing");

    // Alinhamento de nicho: aproximação pelo tamanho atual vs p50/p75
    let alignment = 0.5;
    if (benchmark?.tracks_p50 && benchmark.tracks_p50 > 0) {
      const ratio = Math.min(tracks / benchmark.tracks_p50, 1.5);
      alignment = Math.max(0, Math.min(1, ratio / 1.2));
    } else if (tracks >= MIN_TRACKS) {
      alignment = 0.7;
    }
    const niche_alignment_ok = alignment >= 0.6;
    if (!niche_alignment_ok) hints.push("tamanho abaixo da média do nicho");

    const ready_for_deals = name_ok && description_ok && min_tracks_ok && cover_ok;

    const checklist: Checklist = {
      name_ok,
      description_ok,
      min_tracks_ok,
      cover_ok,
      niche_alignment_ok,
      niche_alignment_score: Number(alignment.toFixed(2)),
      blocking_issues: blocking,
      hints,
      ready_for_deals,
      checked_at: new Date().toISOString(),
    };

    // Atualiza streak e estágio
    const newStreak = ready_for_deals ? (pl.onboarding_ready_streak ?? 0) + 1 : 0;
    const update: Record<string, unknown> = {
      onboarding_checklist: checklist,
      onboarding_ready_streak: newStreak,
      last_onboarding_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Promove pra "testing" após 3 checagens consecutivas saudáveis
    if (pl.lifecycle_stage === "onboarding" && newStreak >= 3) {
      update.lifecycle_stage = "testing";
      update.onboarding_completed_at = new Date().toISOString();
    }

    await supabase.from("managed_playlists").update(update).eq("id", pl.id);

    return jr({ ok: true, checklist, lifecycle_stage: update.lifecycle_stage ?? pl.lifecycle_stage, streak: newStreak });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
