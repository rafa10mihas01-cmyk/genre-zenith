---
name: Termo "baseline" reservado à campanha
description: A palavra baseline só pode descrever a fotografia inicial da campanha em campaign_playlist_collections. Outros conceitos usam nomes específicos.
type: preference
---
A palavra **baseline** é reservada EXCLUSIVAMENTE para a fotografia inicial da campanha, vivendo em `campaign_playlist_collections.is_baseline` e consultada via `public.get_campaign_baseline()`.

Qualquer outro conceito que envolva "início" ou "primeira captura" deve usar um nome que descreva sua responsabilidade real. Exemplos canônicos já aplicados:

- `curator_deal_snapshots.is_initial_capture` → marco inicial da medição de plays (Fase 1.A.2).
- `curator_deal_logs.is_initial_capture_event` → evento que registrou o início da medição (Fase 1.A.3).
- `curator_playlists.is_initial_roster` → playlist fazia parte do conjunto inicial do deal (Fase 1.A.3).

**How to apply:** ao criar nova coluna/campo/variável, NÃO usar `baseline` se o conceito não for a baseline oficial da campanha. Renomear quaisquer novos usos seguindo o mesmo padrão de descrever a responsabilidade real.
