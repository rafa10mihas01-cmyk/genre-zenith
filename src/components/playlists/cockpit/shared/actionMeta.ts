import { Trash2, ArrowDown, ArrowUp, Plus } from "lucide-react";

// Visual metadata por tipo de ação no Plano. Compartilhado entre ActionCard,
// BucketShell e seus consumidores — extraído sem alterar valores.
export const ACTION_META = {
  remove: { label: "Remover", Icon: Trash2, tone: "border-destructive/40 bg-destructive/10 text-destructive", hint: "Faixas sem tração ou saturadas" },
  demote: { label: "Mover pra baixo", Icon: ArrowDown, tone: "border-warning/40 bg-warning/10 text-warning", hint: "Na vitrine sem performance" },
  promote: { label: "Mover pro topo", Icon: ArrowUp, tone: "border-primary/40 bg-primary/10 text-primary", hint: "Mercado já reconheceu" },
  add: { label: "Adicionar", Icon: Plus, tone: "border-primary/50 bg-primary/15 text-primary", hint: "Faixas dominando o nicho" },
} as const;

export type ActionKind = keyof typeof ACTION_META;
