// Teste sintético: valida fix do bot-upload-print aceitando JSON base64.
// Usa BOT_API_KEY do env (não exposto ao cliente).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dealId = url.searchParams.get("deal_id") ?? "11317f14-486b-4d31-b44e-9ceae9415f62";
  const songId = url.searchParams.get("song_id") ?? "50a3cfb2-53c3-4ea7-92d7-6751f65e998a";
  const correlationId = `synthetic-${Date.now()}`;

  const payload = {
    content_base64: PNG_1x1,
    deal_id: dealId,
    song_id: songId,
    label: "playlists-part-1-of-1",
    correlation_id: correlationId,
    dom_playlists: [
      { name: "Synthetic Test Playlist", url: "https://open.spotify.com/playlist/synthetic-test-001", plays_text: "42" },
    ],
  };

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/bot-upload-print`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-key": BOT_API_KEY,
      "x-correlation-id": correlationId,
      "x-bot-name": "synthetic-test",
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch (_) { /* keep text */ }

  return new Response(JSON.stringify({
    sent: { ...payload, content_base64: `<${PNG_1x1.length} chars>` },
    upstream_status: resp.status,
    upstream_body: body,
    correlation_id: correlationId,
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
