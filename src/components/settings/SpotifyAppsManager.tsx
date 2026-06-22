// SpotifyAppsManager — central operacional multi-app/multi-conta.
// Cada APP é um card; contas vivem aninhadas dentro do app correspondente.
// Configs técnicas (Redirect URIs, scopes, edit/remove) ficam em <details> colapsável.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Plus, Star, Trash2, Pencil, Loader2, ExternalLink, AlertTriangle, LinkIcon, Copy, Check,
  Music2, RefreshCw, Settings2, ChevronDown, CheckCircle2, Eye, EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type SpotifyApp = {
  id: string;
  name: string;
  slug: string;
  client_id: string;
  client_id_preview: string;
  max_accounts: number;
  status: string;
  notes: string | null;
  owner_email: string | null;
  accounts_used: number;
  slots_remaining: number;
  created_at: string;
};

export type SpotifyAccount = {
  id: string;
  app_id: string | null;
  spotify_user_id: string;
  display_name: string | null;
  email: string | null;
  is_default: boolean;
  scope: string | null;
};

async function callAuth(qs: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-auth?${qs}`;
  const resp = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return resp.json();
}

const KNOWN_ORIGINS: { label: string; origin: string }[] = [
  { label: "Editor Lovable", origin: "https://f5e1a9fd-9e98-4abe-83b5-56808d1c1add.lovableproject.com" },
  { label: "Preview Lovable", origin: "https://id-preview--f5e1a9fd-9e98-4abe-83b5-56808d1c1add.lovable.app" },
  { label: "Publicado", origin: "https://genre-zenith.lovable.app" },
  { label: "Domínio próprio", origin: "https://engine.nexcreatorx.com" },
];

function buildAppRedirects(slug: string): { label: string; url: string }[] {
  return KNOWN_ORIGINS.map(({ label, origin }) => ({ label, url: `${origin}/spotify/callback/${slug}` }));
}

function RedirectUrisPanel({ slug }: { slug: string }) {
  const urls = useMemo(() => buildAppRedirects(slug), [slug]);
  const [copied, setCopied] = useState<string | null>(null);

  async function copyOne(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      toast.success("URL copiada");
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    } catch { toast.error("Falha ao copiar"); }
  }
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(urls.map((u) => u.url).join("\n"));
      toast.success(`${urls.length} URLs copiadas`);
    } catch { toast.error("Falha ao copiar"); }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
          Redirect URIs — colar no Spotify Developer
        </span>
        <button
          type="button"
          onClick={copyAll}
          className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <Copy className="h-2.5 w-2.5" /> Copiar {urls.length}
        </button>
      </div>
      <div className="space-y-1">
        {urls.map((u) => (
          <div key={u.url} className="flex items-start gap-2 group min-w-0">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70 w-16 shrink-0 pt-0.5">{u.label}</span>
            <code className="flex-1 min-w-0 text-[10px] font-mono text-foreground break-all leading-snug">{u.url}</code>
            <button
              type="button"
              onClick={() => copyOne(u.url)}
              className="opacity-50 hover:opacity-100 text-muted-foreground hover:text-primary transition shrink-0 mt-0.5"
              title="Copiar"
            >
              {copied === u.url ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CapacityBar({ used, max }: { used: number; max: number }) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((used / max) * 100));
  const tone =
    pct > 90 ? "bg-destructive"
    : pct > 60 ? "bg-warning"
    : "bg-success";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Capacidade</span>
        <span className="tabular-nums text-foreground font-medium">{used}/{max} contas</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface Props {
  accounts: SpotifyAccount[];
  requiredScopes: string[];
  isInIframe: boolean;
  onConnect: (appId: string, forceLogin: boolean) => void;
  onSetDefaultAccount: (id: string) => void;
  onRemoveAccount: (id: string) => void;
  onChange?: (apps: SpotifyApp[]) => void;
}

export function SpotifyAppsManager({
  accounts, requiredScopes, isInIframe,
  onConnect, onSetDefaultAccount, onRemoveAccount, onChange,
}: Props) {
  const [apps, setApps] = useState<SpotifyApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<SpotifyApp> | null>(null);
  const [saving, setSaving] = useState(false);
  const [scopes, setScopes] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [inviteAppId, setInviteAppId] = useState<string | null>(null);
  const [collapsedApps, setCollapsedApps] = useState<Set<string>>(new Set());
  const [hidePaused, setHidePaused] = useState(true);
  const initializedCollapse = useRef(false);
  const toggleAppCollapsed = (id: string) => setCollapsedApps((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const APPS_PER_PAGE = 5;

  async function load() {
    setLoading(true);
    const j = await callAuth("mode=apps");
    setLoading(false);
    if (j?.ok) {
      setApps(j.apps);
      onChange?.(j.apps);
    } else if (j?.error) {
      toast.error("Falha ao carregar apps", { description: j.error });
    }
  }

  async function loadScopes() {
    const j = await callAuth("mode=scopes");
    if (j?.ok && Array.isArray(j.scopes)) setScopes(j.scopes);
  }

  // load/loadScopes redefinidos a cada render; intencionalmente disparam só no mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); void loadScopes(); }, []);

  useEffect(() => {
    if (initializedCollapse.current || apps.length === 0) return;
    initializedCollapse.current = true;
    setCollapsedApps(new Set(apps.map((a) => a.id)));
  }, [apps]);

  async function save() {
    if (!editing) return;
    const body: any = {
      id: editing.id,
      name: (editing.name ?? "").trim(),
      max_accounts: Number(editing.max_accounts ?? 5),
      notes: editing.notes ?? null,
      owner_email: (editing as any).owner_email ?? null,
      status: editing.status ?? "active",
    };
    if (editing.slug) body.slug = String(editing.slug).trim();
    if ((editing as any).client_id) body.client_id = (editing as any).client_id;
    if ((editing as any).client_secret) body.client_secret = (editing as any).client_secret;

    if (!body.name) { toast.error("Informe o nome do app"); return; }
    if (!editing.id && (!body.client_id || !body.client_secret)) {
      toast.error("Client ID e Client Secret obrigatórios"); return;
    }

    setSaving(true);
    const j = await callAuth("mode=app_save", { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!j?.ok) { toast.error("Falha ao salvar", { description: j?.error }); return; }
    toast.success(editing.id ? "App atualizado" : "App cadastrado");
    setEditing(null);
    await load();
  }

  async function del(id: string, name: string) {
    if (!confirm(`Remover app "${name}"? Só funciona se não houver contas vinculadas.`)) return;
    const j = await callAuth("mode=app_delete", { method: "POST", body: JSON.stringify({ id }) });
    if (!j?.ok) { toast.error("Falha ao remover", { description: j?.error }); return; }
    toast.success("App removido");
    await load();
  }

  // ─── Resumo operacional ───
  const totalApps = apps.length;
  const totalMax = apps.reduce((sum, a) => sum + a.max_accounts, 0);
  const totalUsed = accounts.filter((a) => a.app_id && apps.some((x) => x.id === a.app_id)).length;
  const allHealthy = apps.length > 0 && apps.every((a) => a.status === "active");
  const pausedCount = apps.filter((a) => a.status !== "active").length;
  const visibleApps = useMemo(
    () => (hidePaused ? apps.filter((a) => a.status === "active") : apps),
    [apps, hidePaused],
  );
  const accountsByApp = useMemo(() => {
    const m = new Map<string, SpotifyAccount[]>();
    for (const a of accounts) {
      const k = a.app_id ?? "__legacy__";
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    return m;
  }, [accounts]);
  const legacyAccounts = accountsByApp.get("__legacy__") ?? [];

  return (
    <div className="space-y-4">
      {/* ─── Header operacional ─── */}
      <header className="nx-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Music2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold">Infraestrutura Spotify</h2>
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
              {loading ? "Carregando…" : (
                <>
                  <span className="text-foreground font-medium">{totalApps}</span> app{totalApps === 1 ? "" : "s"}
                  {" · "}
                  <span className="text-foreground font-medium">{totalUsed}/{totalMax}</span> contas
                  {" · "}
                  <span className={allHealthy ? "text-success" : "text-warning"}>
                    {totalApps === 0 ? "sem apps" : allHealthy ? "todas saudáveis" : "atenção"}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pausedCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setHidePaused((v) => !v)}
              className="h-8 text-xs gap-1.5"
              title={hidePaused ? "Mostrar apps pausadas/bloqueadas" : "Ocultar apps pausadas/bloqueadas"}
            >
              {hidePaused ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {hidePaused ? `Mostrar pausadas (${pausedCount})` : "Ocultar pausadas"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing({ name: "", max_accounts: 5, status: "active" })}
            className="h-8 text-xs gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Cadastrar app
          </Button>
        </div>
      </header>

      {/* ─── Aviso contextual único (iframe) ─── */}
      {isInIframe && (
        <div className="p-2.5 rounded-lg border border-warning/30 bg-warning/5 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            O Spotify bloqueia login dentro do preview. A conexão de contas abre em nova aba automaticamente.
          </p>
        </div>
      )}

      {/* ─── Apps ─── */}
      {loading ? (
        <div className="nx-card p-6 text-center text-xs text-muted-foreground">Carregando apps…</div>
      ) : apps.length === 0 ? (
        <div className="nx-card p-6 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-muted/40 border border-border flex items-center justify-center mx-auto">
            <Music2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Cadastre seu primeiro app Spotify</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-relaxed">
              Cada app aceita até 25 contas. Crie no{" "}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                Spotify Developer <ExternalLink className="h-3 w-3" />
              </a>{" "}
              e cole as credenciais aqui.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setEditing({ name: "", max_accounts: 5, status: "active" })}
            className="h-9 text-xs gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Cadastrar app
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleApps.slice(page * APPS_PER_PAGE, page * APPS_PER_PAGE + APPS_PER_PAGE).map((a) => {
            const appAccounts = accountsByApp.get(a.id) ?? [];
            // Deriva uso a partir das contas reais (prop), pra atualizar na hora ao deletar/conectar.
            const liveUsed = appAccounts.length;
            const full = liveUsed >= a.max_accounts;
            const isPaused = a.status !== "active";
            const isCollapsed = collapsedApps.has(a.id);
            return (
              <article key={a.id} className="nx-card overflow-hidden">
                {/* App header */}
                <header className={cn("p-4", !isCollapsed && "border-b border-border")}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => toggleAppCollapsed(a.id)}
                          className="h-6 w-6 -ml-1 rounded hover:bg-muted/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          title={isCollapsed ? "Expandir" : "Recolher"}
                          aria-expanded={!isCollapsed}
                        >
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isCollapsed && "-rotate-90")} />
                        </button>
                        <h3 className="text-sm font-bold">{a.name}</h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{a.slug}</span>
                        {isPaused ? (
                          <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-warning/30 text-warning bg-warning/10">
                            <span className="h-1.5 w-1.5 rounded-full bg-warning" /> pausado
                          </span>
                        ) : (
                          <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-success/30 text-success bg-success/10">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" /> ativo
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate mt-1">{a.client_id_preview}</div>
                      {a.owner_email ? (
                        <div
                          className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground min-w-0"
                          title={`Dono do app no Spotify Developer: ${a.owner_email}`}
                        >
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 shrink-0">Dono:</span>
                          <span className="truncate">{a.owner_email}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground/60 min-w-0 italic">
                          Dono do app não informado — edite o app para preencher.
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPaused || full}
                        onClick={() => setInviteAppId(a.id)}
                        className="h-8 text-xs gap-1.5 border-white/10 hover:bg-white/[0.06] disabled:opacity-50"
                        title={
                          isPaused ? "App pausado"
                          : full ? "Sem vagas neste app"
                          : `Gerar link de convite para "${a.name}"`
                        }
                      >
                        <LinkIcon className="h-3.5 w-3.5" /> Link de convite
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPaused || full}
                        onClick={() => onConnect(a.id, false)}
                        className="h-8 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                        title={
                          isPaused ? "App pausado"
                          : full ? "Sem vagas neste app"
                          : `Conectar nova conta no app "${a.name}"`
                        }
                      >
                        <LinkIcon className="h-3.5 w-3.5" /> Conectar conta
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3">
                    <CapacityBar used={liveUsed} max={a.max_accounts} />
                  </div>
                </header>

                {!isCollapsed && <>
                {/* Contas aninhadas */}
                <div className="p-4 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">
                    Contas vinculadas {appAccounts.length > 0 && <span className="text-muted-foreground/70">({appAccounts.length})</span>}
                  </div>
                  {appAccounts.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2">
                      Nenhuma conta vinculada ainda. Use "Conectar conta" acima.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 max-h-[210px] overflow-y-auto pr-1 -mr-1 nx-scroll">
                      {appAccounts.map((acc) => {
                        const grantedScopes: string[] = (acc.scope ?? "").split(/\s+/).filter(Boolean);
                        const missingScopes = requiredScopes.filter((s) => !grantedScopes.includes(s));
                        const needsReauth = requiredScopes.length > 0 && missingScopes.length > 0;
                        return (
                          <li key={acc.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-muted/20">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm truncate">{acc.display_name ?? acc.spotify_user_id}</span>
                                {acc.is_default && (
                                  <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                                    <Star className="h-2.5 w-2.5" /> padrão
                                  </span>
                                )}
                                {needsReauth && (
                                  <span
                                    className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/30"
                                    title={`Escopos faltando: ${missingScopes.join(", ")}`}
                                  >
                                    <AlertTriangle className="h-2.5 w-2.5" /> reautorizar
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground font-mono truncate">{acc.email ?? acc.spotify_user_id}</div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {needsReauth && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => onConnect(a.id, false)}
                                  className="h-8 px-2 text-xs gap-1 text-warning hover:bg-warning/10 hover:text-warning"
                                  title={`Reautorizar para conceder: ${missingScopes.join(", ")}`}
                                >
                                  <RefreshCw className="h-3 w-3" />
                                </Button>
                              )}
                              {!acc.is_default && (
                                <Button size="sm" variant="ghost" onClick={() => onSetDefaultAccount(acc.id)} className="h-8 w-8 p-0" title="Definir como padrão">
                                  <Star className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => onRemoveAccount(acc.id)} className="h-8 w-8 p-0 text-destructive hover:text-destructive" title="Remover conta">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Configurações avançadas (colapsável) */}
                <details className="group border-t border-border bg-muted/10">
                  <summary className="px-4 py-2.5 cursor-pointer list-none flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
                    <span className="inline-flex items-center gap-1.5">
                      <Settings2 className="h-3 w-3" /> Configurações avançadas
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="px-4 pb-4 pt-1 space-y-3">
                    <RedirectUrisPanel slug={a.slug} />
                    {scopes.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 block">
                          Escopos solicitados ({scopes.length})
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {scopes.map((s) => (
                            <span key={s} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">{s}</span>
                          ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Cada conta precisa estar em <strong>Users and Access</strong> deste app no Spotify Developer.
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(a)} className="h-7 text-xs gap-1.5">
                        <Pencil className="h-3 w-3" /> Editar app
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => del(a.id, a.name)} className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive">
                        <Trash2 className="h-3 w-3" /> Remover app
                      </Button>
                    </div>
                  </div>
                </details>
                </>}
              </article>
            );
          })}

          {/* Paginação de apps */}
          {visibleApps.length > APPS_PER_PAGE && (() => {
            const totalPages = Math.ceil(visibleApps.length / APPS_PER_PAGE);
            const safePage = Math.min(page, totalPages - 1);
            const from = safePage * APPS_PER_PAGE + 1;
            const to = Math.min(safePage * APPS_PER_PAGE + APPS_PER_PAGE, visibleApps.length);
            return (
              <div className="flex items-center justify-between gap-3 px-1 pt-1">
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  Apps <span className="text-foreground font-medium">{from}–{to}</span> de {visibleApps.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm" variant="outline"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="h-7 text-xs"
                  >
                    Anterior
                  </Button>
                  <span className="text-[11px] text-muted-foreground tabular-nums px-2">
                    {safePage + 1}/{totalPages}
                  </span>
                  <Button
                    size="sm" variant="outline"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    className="h-7 text-xs"
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* Contas legadas (sem app vinculado) */}
          {legacyAccounts.length > 0 && (
            <article className="nx-card overflow-hidden border-dashed">
              <header className="p-4 border-b border-border">
                <h3 className="text-sm font-bold">App legado (env)</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Contas autenticadas via credenciais antigas do servidor, sem app vinculado.
                </p>
              </header>
              <ul className="p-4 space-y-1.5">
                {legacyAccounts.map((acc) => (
                  <li key={acc.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-muted/20">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{acc.display_name ?? acc.spotify_user_id}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{acc.email ?? acc.spotify_user_id}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!acc.is_default && (
                        <Button size="sm" variant="ghost" onClick={() => onSetDefaultAccount(acc.id)} className="h-8 w-8 p-0" title="Definir como padrão">
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => onRemoveAccount(acc.id)} className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </div>
      )}

      {/* Dialog de edição/cadastro */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] p-0 bg-card border-border/60 shadow-2xl flex flex-col overflow-hidden">
          <DialogHeader className="space-y-2 px-6 pt-6 pb-3 border-b border-border/40 shrink-0">
            <DialogTitle className="text-lg font-semibold text-foreground">
              {editing?.id ? "Editar app Spotify" : "Cadastrar app Spotify"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Crie um app em{" "}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium">
                developer.spotify.com/dashboard
              </a>{" "}
              e cole as credenciais aqui.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0 nx-scroll min-w-0">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Nome interno</Label>
              <Input
                value={editing?.name ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s!, name: e.target.value }))}
                placeholder='Ex: "App principal", "App 2 - rock"'
                className="h-10 text-sm bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">
                Identificador (slug)
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">— usado na URL de retorno</span>
              </Label>
              <Input
                value={editing?.slug ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s!, slug: e.target.value }))}
                placeholder={editing?.id ? "" : "Deixe vazio pra gerar a partir do nome"}
                className="h-10 text-sm font-mono bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
              <p className="text-[10px] text-muted-foreground">Só letras minúsculas, números e hífen. Ex: <span className="font-mono">nexengine-03</span>.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Client ID</Label>
              <Input
                value={(editing as any)?.client_id ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s!, ...(editing as any), client_id: e.target.value } as any))}
                placeholder={editing?.id ? "Deixe vazio pra não alterar" : "32 caracteres hex"}
                className="h-10 text-sm font-mono bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Client Secret</Label>
              <Input
                type="password"
                value={(editing as any)?.client_secret ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s!, ...(editing as any), client_secret: e.target.value } as any))}
                placeholder={editing?.id ? "Deixe vazio pra não alterar" : "32 caracteres hex"}
                className="h-10 text-sm font-mono bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">Limite de contas</Label>
                <Input
                  type="number" min={1} max={25}
                  value={editing?.max_accounts ?? 5}
                  onChange={(e) => setEditing((s) => ({ ...s!, max_accounts: Number(e.target.value) || 5 }))}
                  className="h-10 text-sm bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                />
                <p className="text-[10px] text-muted-foreground">Spotify aceita até 25 em dev mode.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">Status</Label>
                <select
                  value={editing?.status ?? "active"}
                  onChange={(e) => setEditing((s) => ({ ...s!, status: e.target.value }))}
                  className="h-10 w-full rounded-md border border-border/60 bg-muted/30 px-3 text-sm text-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                >
                  <option value="active">Ativo</option>
                  <option value="paused">Pausado</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">E-mail do dono do app no Spotify Developer</Label>
              <Input
                type="email"
                placeholder="ex: rafa.desmirras@gmail.com"
                value={(editing as any)?.owner_email ?? ""}
                onChange={(e) => setEditing((s) => ({ ...(s as any)!, owner_email: e.target.value }))}
                className="h-10 text-sm bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20"
              />
              <p className="text-[10.5px] text-muted-foreground/80 leading-snug">
                Conta que criou o app no Spotify Developer (não é a conta da playlist).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Notas (opcional)</Label>
              <Textarea
                value={editing?.notes ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s!, notes: e.target.value }))}
                rows={2}
                className="text-sm bg-muted/30 border-border/60 focus-visible:border-primary/60 focus-visible:ring-primary/20 resize-none"
              />
            </div>
            {editing?.slug && (
              <div className="p-3 rounded-md bg-muted/20 border border-border/40">
                <RedirectUrisPanel slug={editing.slug} />
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-3 border-t border-border/40 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
            <Button size="sm" onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {editing?.id ? "Salvar" : "Cadastrar app"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InviteDialog
        appId={inviteAppId}
        app={apps.find((a) => a.id === inviteAppId) ?? null}
        onClose={() => setInviteAppId(null)}
      />
    </div>
  );
}

type InviteConnection = {
  display_name: string | null;
  email: string | null;
  spotify_user_id: string | null;
  connected_at: string; // ISO
};

function formatRelative(fromIso: string, nowMs: number): string {
  const diff = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 1000));
  if (diff < 5) return "agora mesmo";
  if (diff < 60) return `há ${diff} segundos`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `há ${min} ${min === 1 ? "minuto" : "minutos"}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} ${h === 1 ? "hora" : "horas"}`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

function InviteDialog({
  appId, app, onClose,
}: {
  appId: string | null;
  app: SpotifyApp | null;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState(48);
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connection, setConnection] = useState<InviteConnection | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!appId) {
      setLabel(""); setHours(48); setLink(null); setToken(null); setExpiresAt(null);
      setCopied(false); setConnection(null);
    }
  }, [appId]);

  // Tick pra atualizar tempo relativo enquanto o bloco de confirmação estiver visível.
  useEffect(() => {
    if (!connection) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [connection]);

  // Realtime: escuta evento `account_connected` no audit log filtrado pelo token do convite.
  useEffect(() => {
    if (!token || connection) return;
    const channel = supabase
      .channel(`spotify-invite-${token}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "spotify_oauth_audit",
          filter: `invite_token=eq.${token}`,
        },
        (payload) => {
          const row = payload.new as {
            event?: string;
            display_name?: string | null;
            email?: string | null;
            spotify_user_id?: string | null;
            created_at?: string;
          };
          if (row?.event !== "account_connected") return;
          setConnection({
            display_name: row.display_name ?? null,
            email: row.email ?? null,
            spotify_user_id: row.spotify_user_id ?? null,
            connected_at: row.created_at ?? new Date().toISOString(),
          });
          setNowMs(Date.now());
          toast.success("Conta conectada", {
            description: row.display_name || row.email || row.spotify_user_id || "Autorização concluída",
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [token, connection]);

  async function generate() {
    if (!appId) return;
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spotify-invite?mode=create`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ app_id: appId, label: label || null, hours, origin: window.location.origin }),
        },
      );
      const j = await resp.json();
      if (!j.ok) {
        toast.error("Falha ao gerar convite", { description: j.error });
      } else {
        setLink(j.url || `${window.location.origin}${j.path}`);
        setToken(j.token ?? null);
        setExpiresAt(j.expires_at);
        toast.success("Link de convite criado");
      }
    } catch (e) {
      toast.error("Erro de rede", { description: (e as Error).message });
    } finally {
      setCreating(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Falha ao copiar");
    }
  }

  return (
    <Dialog open={!!appId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Link de convite — {app?.name}</DialogTitle>
          <DialogDescription className="text-xs">
            Gere um link único e mande pro dono da conta Spotify. Ele autoriza
            direto com o e-mail e senha dele — você nunca vê a senha.
          </DialogDescription>
        </DialogHeader>

        {!link ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Identificação (opcional)</Label>
              <Input
                placeholder='Ex: "Conta do João — Cliente XYZ"'
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-9 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Aparece pra você no histórico e pra pessoa na página de autorização.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Validade</Label>
              <select
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="w-full h-9 rounded-md border border-border/40 bg-background px-2 text-sm"
              >
                <option value={6}>6 horas</option>
                <option value={24}>24 horas</option>
                <option value={48}>48 horas (recomendado)</option>
                <option value={168}>7 dias</option>
                <option value={336}>14 dias</option>
              </select>
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={onClose} disabled={creating}>Cancelar</Button>
              <Button size="sm" onClick={generate} disabled={creating} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Gerar link
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {connection ? (
              <div className="rounded-md border border-success/40 bg-success/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <Label className="text-[10px] uppercase tracking-wide text-success">Conta conectada</Label>
                </div>
                <div className="space-y-0.5">
                  {connection.display_name && (
                    <p className="text-sm font-medium text-foreground">{connection.display_name}</p>
                  )}
                  {connection.email && (
                    <p className="text-xs text-muted-foreground break-all">{connection.email}</p>
                  )}
                  {connection.spotify_user_id && (
                    <p className="text-[11px] font-mono text-muted-foreground/80">{connection.spotify_user_id}</p>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground pt-1 border-t border-success/20">
                  Conectada às{" "}
                  {new Date(connection.connected_at).toLocaleTimeString("pt-BR", {
                    hour: "2-digit", minute: "2-digit", second: "2-digit",
                  })}
                  {" · "}
                  {formatRelative(connection.connected_at, nowMs)}
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                <Label className="text-[10px] uppercase tracking-wide text-primary">Link gerado</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={link}
                    readOnly
                    className="h-9 text-xs font-mono bg-background"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button size="sm" variant="outline" onClick={copyLink} className="h-9 px-3 shrink-0">
                    {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {expiresAt && (
                  <p className="text-[11px] text-muted-foreground">
                    Válido até {new Date(expiresAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · uso único
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Aguardando autorização…
                </p>
              </div>
            )}
            {!connection && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Mande esse link pela pessoa por WhatsApp, e-mail ou onde preferir.
                Quando ela autorizar, a conta cai automaticamente no app{" "}
                <span className="text-foreground font-medium">{app?.name}</span>.
              </p>
            )}
            <DialogFooter>
              <Button size="sm" onClick={onClose} className="bg-primary text-primary-foreground hover:bg-primary/90">
                Fechar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
