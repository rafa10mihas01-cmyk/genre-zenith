// placement-template-download
// Gera um XLSX modelo personalizado pro cliente preencher com placements.
// Inclui aba "Placements" com headers oficiais + 3 linhas de exemplo
// preenchidas com a faixa do deal, e aba "Instruções".
//
// Body: { client_token: string }
// Retorna: { ok: true, file_base64, file_name }
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import * as XLSX from "npm:xlsx@0.18.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function appError(error: string) {
  return jr({ ok: false, error, fallback: true }, 200);
}




Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.client_token ?? "").trim();
    if (!token) return appError("Link do cliente inválido. Reabra o portal pelo link enviado.");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: resolved, error: resErr } = await admin.rpc("resolve_client_token", {
      _token: token,
    });
    if (resErr) return appError(resErr.message);
    const row = Array.isArray(resolved) && resolved.length > 0 ? resolved[0] : null;
    if (!row?.deal_id) return appError("Link do cliente inválido ou expirado. Reabra o portal pelo link enviado.");

    // Tenta buscar info da faixa pra preencher exemplos
    let trackName = "Nome da música";
    let isrc = "BR0000000000";
    let artistName = "";
    if (row.song_id) {
      const { data: song } = await admin
        .from("curator_deal_songs")
        .select("song_name, song_artist")
        .eq("id", row.song_id)
        .maybeSingle();
      if (song?.song_name) trackName = song.song_name;
      if (song?.song_artist) artistName = song.song_artist;
    }

    const wb = XLSX.utils.book_new();

    // Aba 1: Placements
    const headers = [
      "#",
      "VERSION NAME",
      "ISRC",
      "PLAYLIST",
      "PLAYLIST URL",
      "COUNTRY",
      "OWNER NAME",
      "CURRENT POSITION",
      "STREAMS",
    ];
    const examples = [
      [1, trackName, isrc, "Funk Hits", "https://open.spotify.com/playlist/37i9dQZF1DX0XUfTFmNBRM", "BR", "spotify", 6, 277160],
      [2, trackName, isrc, "Top Brasil", "https://open.spotify.com/playlist/37i9dQZF1DWVCKO3xAlT1Q", "BR", "spotify", 17, 212060],
      [3, trackName, isrc, "Nome da playlist do curador", "https://open.spotify.com/playlist/XXXXXXXXXXXXXXXXXXXXXX", "BR", "id_do_dono", 4, 28751],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet([headers, ...examples]);
    ws1["!cols"] = [
      { wch: 4 }, { wch: 24 }, { wch: 14 }, { wch: 32 }, { wch: 52 },
      { wch: 8 }, { wch: 28 }, { wch: 10 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, "Placements");

    // Aba 2: Instruções
    const instr = [
      ["INSTRUÇÕES — Planilha de Placements NexEngine"],
      [""],
      [`Música: ${trackName}${artistName ? ` — ${artistName}` : ""}`],
      [`ISRC: ${isrc}`],
      [""],
      ["Como preencher:"],
      ["1. Apague as 3 linhas de exemplo da aba 'Placements'."],
      ["2. Cole as linhas do export da sua distribuidora OU do Spotify for Artists."],
      ["3. Mantenha os nomes das colunas exatamente como estão."],
      ["4. Salve em .xlsx e suba aqui no portal."],
      [""],
      ["Você também pode subir o CSV cru exportado do Spotify"],
      ["(Nome;URI;Streams;Posição;URL) — o sistema reconhece automaticamente."],
      [""],
      ["Significado das colunas:"],
      ["#                 → número da linha (pode deixar em branco)"],
      ["VERSION NAME      → nome da faixa"],
      ["ISRC              → código ISRC da faixa (12 caracteres)"],
      ["PLAYLIST          → nome da playlist"],
      ["PLAYLIST URL      → link da playlist no Spotify (https://open.spotify.com/playlist/...)"],
      ["COUNTRY           → código do país (BR, US, etc)"],
      ["OWNER NAME        → ID ou nome do dono da playlist"],
      ["CURRENT POSITION  → posição da faixa dentro da playlist"],
      ["STREAMS           → total de streams gerados pela playlist"],
      [""],
      ["Frequência recomendada: subir uma nova planilha todos os dias."],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(instr);
    ws2["!cols"] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Instruções");

    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
    const safeTrack = trackName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40);
    return jr({
      ok: true,
      file_base64: b64,
      file_name: `placements_${safeTrack}_modelo.xlsx`,
    });
  } catch (e) {
    return appError(e instanceof Error ? e.message : String(e));
  }
});
