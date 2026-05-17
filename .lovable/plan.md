## Fase CRM — Curadores como pipeline comercial

Objetivo: sair de "outreach pontual" e virar **máquina operacional**. Sem IA nova, sem automação agressiva. Foco em organização, histórico e rastreamento.

---

### 1. Banco de dados (migration única)

**`external_curators` — novas colunas:**
- `pipeline_status` text default `'novo'` — enum lógico: novo, contatado, respondeu, negociando, fechado, sem_resposta, blacklist
- `commercial_score` jsonb default `{}` — `{responde_rapido, aceita_divulgacao, ticket_medio, confiabilidade, frequencia}` (0–5 cada)
- `operational_tags` text[] default `'{}'` — premium, whatsapp, aceita_trap, aceita_funk, caro, confiavel, demora_responder, top_conversao
- `whatsapp` text — número
- `last_response_at` timestamptz — quando respondeu pela última vez
- `followup_count` int default 0 — quantos follow-ups já enviados

**`curator_outreach_log` — novas colunas:**
- `event_type` text default `'sent'` — sent, opened, replied, followup_1, followup_2, note
- `note` text — observação manual ("respondeu no Insta", etc)

Trigger: ao inserir log com `event_type='replied'` → atualiza `external_curators.pipeline_status='respondeu'` e `last_response_at`.

---

### 2. UI — Card de curador (`CuradoresCRM.tsx`)

- **Borda colorida** por `pipeline_status`:
  - novo: muted
  - contatado: warning
  - respondeu: primary (verde)
  - negociando: blue
  - fechado: success
  - sem_resposta: destructive/40
  - blacklist: ring vermelho
- **Status pill** clicável → dropdown muda status manualmente
- **Tags** abaixo do nome (chips pequenos)
- **Score comercial** mini (5 dots/estrelas) no canto
- **CTA Follow-up** aparece quando: último contato > 5 dias E sem resposta E followup_count < 2
- Botão "Detalhes" → abre **CuradorDetailSheet** (novo)

---

### 3. Novo componente: `CuradorDetailSheet.tsx`

Sheet lateral (lg) com abas:

**Contato** (centralizado)
- Email · Instagram · WhatsApp em um único bloco
- Cada um com botões: copiar / abrir / enviar

**Timeline**
- Lista de eventos do `curator_outreach_log` ordenado desc
- Ícone por event_type, data, canal, nota opcional
- Componente `<Timeline>` já existe

**Score & Tags**
- 5 sliders (0–5) para score comercial
- Multi-select de tags operacionais
- Salvar em `external_curators`

**Notas**
- Textarea + botão "Adicionar nota" → grava log com event_type='note'

---

### 4. Dashboard de outreach

Bloco no topo da aba **Prospecção** (`Prospecao.tsx`), antes do grid:

```
[Enviados] [Resp.] [Taxa resp.] [Negociando] [Fechados] [Curadores ativos]
```

Cálculos via query em `curator_outreach_log` + `external_curators`.
Filtro de período (7d / 30d / tudo) — toggle simples.

---

### 5. Follow-up

- Botão "Follow-up #N" no card e na sheet
- Reutiliza `EmailPreviewDialog` com template variante (assunto: "Re: parceria NexEngine — follow-up")
- Após envio: incrementa `followup_count`, grava log com `event_type='followup_1'` ou `'followup_2'`
- Bloqueia após 2 follow-ups (mostra "Sem resposta — mover para Blacklist?")

---

### 6. Arquivos a tocar

**Novos:**
- `src/components/operacao/CuradorDetailSheet.tsx`
- `src/components/operacao/OutreachDashboard.tsx`
- `src/components/operacao/PipelineStatusBadge.tsx`
- `src/components/operacao/CommercialScoreEditor.tsx`
- migration SQL

**Editados:**
- `src/components/operacao/CuradoresCRM.tsx` (card refeito, status, tags, follow-up CTA)
- `src/components/operacao/EmailPreviewDialog.tsx` (suporte a `mode: 'followup'`)
- `src/pages/Prospecao.tsx` (dashboard no topo)
- `supabase/functions/_shared/transactional-email-templates/curator-outreach.tsx` (variante follow-up)

---

### 7. Não inclui (explícito)

- Sem IA / scoring automático
- Sem cron de follow-up automático (CTA manual)
- Sem integração WhatsApp API (só link `wa.me/`)
- Sem tracking de abertura real (vem em fase futura — campo já existe no log)

---

### Ordem de execução

1. Migration (status, score, tags, whatsapp, followup_count, event_type)
2. `PipelineStatusBadge` + `CommercialScoreEditor` (componentes atômicos)
3. `CuradorDetailSheet` (abas Contato/Timeline/Score/Notas)
4. Refazer card no `CuradoresCRM` com status colorido, tags, CTA follow-up
5. `OutreachDashboard` no topo de Prospecção
6. Variante follow-up no `EmailPreviewDialog` + template

Tempo estimado: 1 ciclo grande. Aprovar para seguir?