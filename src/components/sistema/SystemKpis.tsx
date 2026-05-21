// SystemKpis — régua de KPIs operacionais no topo de /sistema.
// Lê vps_nodes, spotify_accounts e v_playlist_vps_assignment.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { KpiBig } from "@/components/KpiBig";
import { Server, KeyRound, ShieldCheck, ListMusic } from "lucide-react";

export function SystemKpis() {
  const [loading, setLoading] = useState(true);
  const [vpsActive, setVpsActive] = useState(0);
  const [vpsTotal, setVpsTotal] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const [accActive, setAccActive] = useState(0);
  const [accTotal, setAccTotal] = useState(0);
  const [accExpired, setAccExpired] = useState(0);
  const [playlists, setPlaylists] = useState(0);
  const [assignments, setAssignments] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [vpsRes, accRes, assignRes] = await Promise.all([
      supabase.from("vps_nodes").select("status, max_concurrent_sessions"),
      supabase.from("spotify_accounts").select("status"),
      supabase.from("v_playlist_vps_assignment").select("account_id, vps_node_id"),
    ]);
    const vps = (vpsRes.data ?? []) as any[];
    const acc = (accRes.data ?? []) as any[];
    const asg = (assignRes.data ?? []) as any[];
    setVpsTotal(vps.length);
    setVpsActive(vps.filter((v) => v.status === "active").length);
    setCapacity(vps.reduce((s, v) => s + (v.status === "active" ? (v.max_concurrent_sessions ?? 0) : 0), 0));
    setAccTotal(acc.length);
    setAccActive(acc.filter((a) => a.status === "active").length);
    setAccExpired(acc.filter((a) => a.status === "expired").length);
    setPlaylists(asg.length);
    setAssignments(new Set(asg.map((r) => `${r.account_id}::${r.vps_node_id ?? ""}`)).size);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiBig
        tier="hero"
        className="md:col-span-1"
        icon={Server}
        label="Servidores ativos"
        value={vpsActive}
        hint={`${vpsTotal} total · ${capacity} sessões`}
        domain="system"
        loading={loading}
      />
      <KpiBig
        icon={KeyRound}
        label="Contas ativas"
        value={accActive}
        hint={`${accTotal} cadastradas`}
        domain="system"
        loading={loading}
      />
      <KpiBig
        icon={ShieldCheck}
        label="Sessões expiradas"
        value={accExpired}
        hint={accExpired > 0 ? "Reautenticar" : "Tudo válido"}
        tone={accExpired > 0 ? "warning" : "success"}
        domain="system"
        loading={loading}
      />
      <KpiBig
        icon={ListMusic}
        label="Playlists operadas"
        value={playlists}
        hint={`${assignments} atribuições`}
        domain="playlists"
        loading={loading}
      />
    </section>
  );
}
