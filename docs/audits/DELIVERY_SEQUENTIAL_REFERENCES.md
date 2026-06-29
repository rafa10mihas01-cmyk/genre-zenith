# Delivery — Referências sequenciais sem agrupamento por data

## Decisão oficial

O primeiro upload válido de cada playlist em uma campanha é a baseline/ponto de
partida e gera delta 0. Todo upload válido posterior soma em sequência.

## Regra

```text
delta = 0                                    se é o primeiro upload válido
delta = plays_7d                             se upload posterior é last_24h/last_day
delta = max(0, plays_7d - leitura_anterior)  nos demais casos
```

## Ordem

A ordem oficial é `label_spreadsheet_uploads.created_at`. A `reference_date` é
apenas rótulo visual/auditável e nunca agrupa, substitui ou remove upload.

## Supersede

`status='superseded'`, `superseded_at` e `superseded_by` em
`label_spreadsheet_uploads` são legado histórico. Não excluem cálculo e não
devem ser usados para esconder upload válido na interface. Apenas uploads em
quarentena ficam fora.

## Caso motivador

Se três planilhas diferentes forem enviadas no mesmo dia ou com a mesma data de
referência, as três são entregas sequenciais válidas depois da baseline. Não são
duplicatas por data.