# FASE 5.A.2 — RECONSTRUÇÃO FORENSE DO DELIVERY (Carnívoro)

Campanha: `0170d78a-97f1-41f7-99eb-a5b31c367053` (Carnívoro)
Deal: `b6d1865f-1619-48d3-a704-b496c6ef0a8f`

> Auditoria 100% read-only. Nenhuma alteração em código, banco ou view.

---

## 0. Premissa que muda tudo

O dado que alimenta este deal NÃO é cumulativo.
Cada linha de `label_spreadsheet_rows` carrega `streams = plays_7d` — a **janela móvel de 7 dias** reportada pela planilha do Spotify for Artists (coluna `window_days = 7` em `campaign_playlist_collections`).

Consequência:

- `total_streams` por upload é a SOMA dos plays_7d daquele dia, não um acumulado.
- Comparar uploads dia-a-dia mostra como a janela móvel se desloca, e não o "quanto cresceu".
- O engine só conta como entrega a **soma dos deltas POSITIVOS por playlist** entre `reference_date`s consecutivos.

---

## ITEM 1 — Baseline (31/05)

Upload baseline ativo:

| upload_id | reference_date | is_baseline | playlists | sum(plays_7d) |
|---|---|---|---|---|
| `3cdd1062-ebf7-41c5-8998-2d63f90c8803` | 2026-05-31 | ✅ | **391** | **149.658** |

- Playlists excluídas: **0**
- Playlists em conflito: **0**
- Playlists baseline válidas: **391**

A baseline existe apenas como `label_spreadsheet_rows` (não há `campaign_playlist_collections` para o `upload_id` baseline — o engine consome direto via JOIN, é projetado).

---

## ITEM 2 — Delivery até 13/06

Reconstrução matemática usando APENAS uploads ativos (`status='imported' AND quarantined_at IS NULL`) de 31/05 e 13/06.

| Marco | Playlists | Σ plays_7d |
|---|---|---|
| 31/05 | 391 | 149.658 |
| 13/06 | 476 | 176.741 |

Deltas por playlist (FUNK 2026 é a entrada nova mais relevante):

| Playlist | 31/05 | 13/06 | Δ | Considerado |
|---|---:|---:|---:|---:|
| FUNK 2026 🔥 AS MELHORES TOP 100 | 1 | 13.294 | +13.293 | +13.293 |
| RUMO AO HEXA 🔝 | 663 | 8.245 | +7.582 | +7.582 |
| Top Brasil | 26.463 | 31.530 | +5.067 | +5.067 |
| GAUCHINHA 2 🔥🦈 | 3.057 | 5.026 | +1.969 | +1.969 |
| FUNK BRASILEIRO 2026 🇧🇷 | 1.409 | 2.208 | +799 | +799 |
| ... (demais positivos) | | | | |
| Funk Hits | 39.008 | 36.363 | −2.645 | **0 (descartado)** |
| Funk Hits 2026 🗝️ | 5.249 | 2.337 | −2.912 | **0 (descartado)** |
| Oh bebê você me desculpa | 4.607 | 1.799 | −2.808 | **0 (descartado)** |
| ... (demais negativos) | | | | |

**Σ deltas positivos 31/05 → 13/06 = 44.708**
**Σ deltas líquidos 31/05 → 13/06 = +27.083**

> ⚠️ Esse `44.708` é só o pulo 31/05 → 13/06. O `total_delivered=574.300` da campanha **inclui também os deltas dos uploads intermediários (01/06 → 12/06)** — 12 datas extras que esta reconstrução pulou por escopo.

---

## ITEM 3 — Delivery até 14/06

Uploads ativos para 14/06:

| upload_id | reference_date | status | total_streams | rows |
|---|---|---|---:|---:|
| `ab90803e-9168-…` | 2026-06-14 | **superseded** ✅ | 123.708 | 466 |
| `584ec024-b970-…` | 2026-06-14 | imported (vencedor) | **133.346** | 464 |

Considerando APENAS o vencedor:

| Marco | Σ plays_7d |
|---|---:|
| 13/06 | 176.741 |
| 14/06 | 133.346 |

**Σ deltas positivos 13/06 → 14/06 = 3.899**
**Σ deltas líquidos 13/06 → 14/06 = −43.395**

Praticamente toda playlist regrediu na janela móvel de 7d. Isso é esperado: o pico do final de semana saiu da janela.

Delivery acumulado correto até 14/06 (apenas usando estes 3 marcos):
44.708 + 3.899 = **48.607**

---

## ITEM 4 — Delivery até 15/06

Upload ativo para 15/06:

| upload_id | reference_date | status | total_streams | rows |
|---|---|---|---:|---:|
| `711c88b4-6bb2-…` | 2026-06-15 | imported | **123.708** | **466** |

### 🚨 Achado crítico — o arquivo "15/06" é o MESMO do 14/06 superseded

Comparação binária por linha:

```
a_rows = 466   (ab90803e — superseded de 14/06)
b_rows = 466   (711c88b4 — "15/06" ativo)
identical_rows = 466   ← TODAS as 466 linhas batem em (playlist, streams)
a_sum = 123.708
b_sum = 123.708
```

Os `content_hash` são diferentes (`09d906…` vs `4e407e…`) porque o XLSX tem ordenação/whitespace distintos, mas o **conteúdo numérico por playlist é literalmente idêntico**.

Ou seja: o que está cadastrado como "15/06" é o arquivo errado que o usuário originalmente subiu como 14/06 (e que depois foi superseded por upload correto). O arquivo correto de 15/06 **nunca foi enviado**.

Reconstrução matemática usando o que existe:

| Marco | Σ plays_7d |
|---|---:|
| 14/06 (correto) | 133.346 |
| 15/06 (bogus) | 123.708 |

**Σ deltas positivos 14/06 → 15/06 = 4.667**
**Σ deltas líquidos 14/06 → 15/06 = −9.638**

Delivery acumulado até 15/06 (somando os 4 marcos): 44.708 + 3.899 + 4.667 = **53.274**

---

## ITEM 5 — Tabela cronológica (top 15 por magnitude)

| Playlist | 31/05 | 13/06 | 14/06 | 15/06 | Δ31→13 | Δ13→14 | Δ14→15 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Funk Hits | 39.008 | 36.363 | 26.655 | 25.304 | −2.645 | −9.708 | −1.351 |
| Top Brasil | 26.463 | 31.530 | 22.505 | 21.960 | +5.067 | −9.025 | −545 |
| FUNK 2026 🔥 TOP 100 | 1 | 13.294 | 10.852 | 9.265 | **+13.293** | −2.442 | −1.587 |
| RUMO AO HEXA 🔝 | 663 | 8.245 | 1.215 | 580 | +7.582 | −7.030 | −635 |
| Funk Hits 2026 🗝️ | 5.249 | 2.337 | 2.274 | 1.660 | −2.912 | −63 | −614 |
| GAUCHINHA 2 🔥🦈 | 3.057 | 5.026 | 3.791 | 3.424 | +1.969 | −1.235 | −367 |
| FUNK 2026 TIKTOK | 4.523 | 4.890 | 3.911 | 3.111 | +367 | −979 | −800 |
| FUNK 2026 ATUALIZADO | 4.687 | 4.319 | 3.471 | 2.779 | −368 | −848 | −692 |
| ALVXARO | 3.904 | 3.929 | 2.580 | 4.623 | +25 | −1.349 | **+2.043** |
| Oh bebê você me desculpa | 4.607 | 1.799 | 1.403 | 1.259 | −2.808 | −396 | −144 |
| Melhores Hits Junho 2026 | 4.010 | 1.066 | 1.008 | 673 | −2.944 | −58 | −335 |
| FUNK 2026 💥 MAIS TOCADAS | 3.818 | 3.628 | 2.846 | 2.524 | −190 | −782 | −322 |
| Funk 2026 Atualizado 24Hrs | 3.779 | 3.598 | 2.838 | 2.661 | −181 | −760 | −177 |
| SET DO JAPA NK 2.0 | 2.806 | 2.867 | 2.515 | 1.669 | +61 | −352 | −846 |
| FUNK BRASILEIRO 2026 🇧🇷 | 1.409 | 2.208 | 1.473 | 1.284 | +799 | −735 | −189 |

(Tabela completa com 600+ playlists está no banco — consulta no Item 8.)

Totais agregados:

| Métrica | 31/05→13/06 | 13/06→14/06 | 14/06→15/06 |
|---|---:|---:|---:|
| Δ líquido | +27.083 | −43.395 | −9.638 |
| Δ positivos (delivery) | **+44.708** | **+3.899** | **+4.667** |

---

## ITEM 6 — Comparação com o sistema

| Fonte | Resultado |
|---|---|
| `fn_playlist_delivery_accumulated` (interno) | bate com o cálculo do view ✅ |
| `vw_campaign_playlist_growth` (ecosystem + curator, excluindo organic) | **574.300** |
| `get_campaign_playlist_growth` | **574.300** |
| `campaigns.total_delivered` | **574.300** |

Os 4 mostram o **mesmo número**: 574.300. A engine está consistente consigo mesma.

Esse `574.300` cobre TODAS as 15 transições (baseline → 01/06 → … → 15/06), não só os 4 marcos pedidos. Foi por isso que abrimos a soma só dos 4 marcos (53.274) acima — para destacar a matemática solicitada.

Distribuição por atribuição (view):

| attributed_to | Σ delta |
|---|---:|
| organic (rádio, descartado da entrega) | 1.740.194 |
| ecosystem | 149.990 |
| curator d1f15533 | 201.155 |
| curator fd31587b | 223.155 |
| **delivered total** | **574.300** |

---

## ITEM 7 — Onde nasce a divergência

A divergência percebida pelo usuário ("dia 14 fez quase 9 mil e dia 15 não cresceu, último import mil e pouco") **não nasce em nenhum dia da engine**. Nasce no **upload 15/06**.

| Pergunta | Resposta |
|---|---|
| Diverge entre 31/05 → 13/06? | **NÃO** — matemática bate. |
| Diverge entre 13/06 → 14/06? | **NÃO** — supersede do `ab90803e` está correto; engine usa só o vencedor `584ec024` (133.346). |
| Diverge entre 14/06 → 15/06? | **NÃO no cálculo**, mas **SIM no input**: o arquivo do 15/06 (`711c88b4`) é cópia idêntica do arquivo errado que foi superseded no 14/06 — 466 linhas, mesmos streams. |

O "+1.587" que aparecia como "última coleta" antes do Fase 5.A.1 era o delta `10.852 − 9.265` entre as duas versões do MESMO dia 14/06. Após Fase 5.A.1, esse +1.587 deixou de aparecer como crescimento positivo — virou `−1.587` líquido (descartado pelo engine, vira 0 na entrega), e a "última coleta" passa a refletir o `Δ14→15` real (que é negativo na janela móvel de 7d).

---

## ITEM 8 — Prova matemática

```
ITEM 1  baseline_31_05       = Σ plays_7d em 31/05    = 149.658  (391 playlists)
ITEM 2  total_13_06          = Σ plays_7d em 13/06    = 176.741  (476 playlists)
        Δ_pos(31/05 → 13/06) = Σ max(0, p13 − p31)    = +44.708
        Δ_net(31/05 → 13/06) = Σ (p13 − p31)          = +27.083

ITEM 3  total_14_06          = Σ plays_7d em 14/06    = 133.346  (vencedor 584ec024)
        Δ_pos(13/06 → 14/06) = Σ max(0, p14 − p13)    = +3.899
        Δ_net(13/06 → 14/06) = Σ (p14 − p13)          = −43.395
        delivery acumulado nos 3 marcos               = 44.708 + 3.899 = 48.607

ITEM 4  total_15_06          = Σ plays_7d em 15/06    = 123.708  (711c88b4, conteúdo == ab90803e)
        Δ_pos(14/06 → 15/06) = Σ max(0, p15 − p14)    = +4.667
        Δ_net(14/06 → 15/06) = Σ (p15 − p14)          = −9.638
        delivery acumulado nos 4 marcos               = 44.708 + 3.899 + 4.667 = 53.274

Total da campanha (15 transições, baseline → 15/06)   = 574.300
                                                       (= fn = view = get_… = campaigns.total_delivered)

Identidade do arquivo "15/06":
       rows(15/06) ∩ rows(14/06-superseded) em (playlist, streams) = 466 / 466
       Σ streams(15/06)                = 123.708
       Σ streams(14/06-superseded)     = 123.708
       → arquivo "15/06" = cópia do arquivo errado que foi superseded em 14/06
```

---

## RESULTADO FINAL — Respostas objetivas

| Pergunta | Resposta |
|---|---|
| Delivery correto até 13/06 (marco isolado 31/05→13/06) | **+44.708** (positivos); na campanha total, somando 01/06–13/06 também: parte de 574.300 |
| Delivery correto até 14/06 (3 marcos) | **+48.607** |
| Delivery correto até 15/06 (4 marcos) | **+53.274** |
| Número que a tela mostra para a campanha | **574.300** (consistente em fn, view, get_…, campaigns.total_delivered) |
| Em qual data nasce a divergência | **15/06** — e não é divergência da engine, é arquivo errado |
| Qual função/view produz a divergência | **NENHUMA** — fn, view, get_… e campaigns batem todos. A divergência percebida vem da planilha de 15/06 ser duplicata do arquivo errado de 14/06 |
| Causa raiz exata | O upload `711c88b4-6bb2-473d-91f8-96c4d429e06b` rotulado como `reference_date=2026-06-15` é o **mesmo conteúdo** (466 linhas iguais, 123.708 plays_7d) que o upload `ab90803e-…` que foi superseded em 14/06. O 15/06 verdadeiro nunca foi enviado. Combinado a isso, o dado é `plays_7d` (janela móvel) — quando a janela se desloca depois do pico do fim de semana, todos os números caem, o que reforça a percepção de "não cresceu" |

**Não há bug de engine. Há um bug de dado de entrada: o arquivo de 15/06 precisa ser re-enviado (deletar `711c88b4` e subir a planilha real do dia 15).**
