import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const BOT_INGEST_TOKEN = Deno.env.get('BOT_INGEST_TOKEN')

function verifyToken(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!BOT_INGEST_TOKEN || token !== BOT_INGEST_TOKEN) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    verifyToken(req)
  } catch (r) { return r as Response }

  const body = await req.json().catch(() => ({}))
  const action = body.action

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    if (action === 'list_playlists_to_observe') {
      const { data, error } = await supabase
        .from('playlists_to_observe')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false })

      if (error) throw error
      return new Response(JSON.stringify({ playlists: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'observe_playlist') {
      const { playlist_id, snapshot, hostname } = body
      if (!playlist_id || !snapshot) {
        return new Response(JSON.stringify({ error: 'Missing playlist_id or snapshot' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const { data, error } = await supabase
        .from('playlist_observations')
        .insert({ playlist_id, snapshot, hostname })
        .select()
        .single()

      if (error) throw error
      return new Response(JSON.stringify({ ok: true, observation: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'log_run_start') {
      const { hostname } = body
      const { data, error } = await supabase
        .from('observer_runs')
        .insert({ hostname, status: 'running' })
        .select()
        .single()

      if (error) throw error
      return new Response(JSON.stringify({ ok: true, run: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'log_run_end') {
      const { run_id, playlists_processed, status, error: errMsg } = body
      const { data, error } = await supabase
        .from('observer_runs')
        .update({ ended_at: new Date().toISOString(), playlists_processed, status, error: errMsg })
        .eq('id', run_id)
        .select()
        .single()

      if (error) throw error
      return new Response(JSON.stringify({ ok: true, run: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
