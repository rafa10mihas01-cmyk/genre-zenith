# Isolamento Campanha x Catálogo: análise e plano

## Análise (código e banco)

**1. Onde a origem da operação é definida**
- Tela "Adicionar música" (`AddCatalogTrackDialog.tsx`), com dois seletores:
  - destino (`destMode`): `catalog` ou `campaign`;
  - modo do lote (`batchTarget`): `genre` ou `playlists`.
- `batchTarget = genre` chama `distribute-catalog-track`. É a distribuição de Catálogo explícita.
- `batchTarget = playlists`, em qualquer destino, chama `place-catalog-track-on-playlist`. É o envio direcionado (Campanha ou manual).
- No banco, a origem só aparece depois, no envio já criado (`catalog_placements.origin`: `CATALOG` ou `MANUAL`). **A música em si não guarda nenhuma origem nem autorização.**

**2. Onde a música é cadastrada**
- `place-catalog-track-on-playlist/index.ts`, linhas 80–92: insere em `catalog_tracks` com `status='active'`.
- `distribute_catalog_track` (função do banco, chamada por `distribute-catalog-track`): insere em `catalog_tracks` e já chama `engine_create_distribution_plan` por conta própria.
- A coluna `catalog_tracks.status` tem o padrão `'active'`.

**3. Onde o gatilho de Catálogo é disparado**
- O gatilho `trg_catalog_track_create_plan` roda depois de todo cadastro de música, e também quando o status muda para `active`.
- Se `status='active'`, ele chama `engine_create_distribution_plan(NEW.id)` e depois `engine_run_distribution_wave()`.
- Depois disso, o `occupancy-executor`, que roda a cada minuto, executa os envios.

**4. Como distinguir Campanha, Catálogo e Manual**
- Hoje isso não é possível no nível da música: "ativa" vale para tudo.
- O único sinal confiável de autorização de Catálogo é o caminho `distribute_catalog_track`.

**5. Ponto correto para impedir o disparo indevido**
- Na origem da criação do plano, ou seja, no gatilho `trg_catalog_track_create_plan`. Não no executor.

**6. Garantir que Campanha nunca crie envios de Catálogo**
- O envio direcionado cadastra a música **sem autorização de Catálogo**.
- O plano de Catálogo só nasce quando essa autorização existe.

**7. Música cadastrada não é música autorizada**
- Criar um campo explícito de autorização, desligado por padrão. Só a distribuição de Catálogo explícita liga esse campo.

## Correção proposta

1. **Novo campo na música:** `catalog_distribution_authorized` (sim/não), **desligado por padrão**, mais a data e quem autorizou.
2. **Gatilho `trg_catalog_track_create_plan`:**
   - no cadastro, não cria mais plano sozinho;
   - na reativação (status muda para `active`), só cria plano se a música estiver autorizada.
3. **`distribute_catalog_track`** (Catálogo explícito): marca a música como autorizada antes de criar o plano. O comportamento atual do Catálogo fica igual.
4. **`place-catalog-track-on-playlist`** (Campanha/manual):
   - cadastra a música **sem autorização**;
   - não mexe na autorização de músicas que já existem;
   - faz só o envio pedido, como hoje.
5. **Proteção extra na origem:** `engine_create_distribution_plan` recusa músicas não autorizadas. Assim nenhum outro caminho futuro consegue criar plano de Catálogo sem autorização.
6. **Músicas que já existem:**
   - ficam autorizadas as que já tinham plano de Catálogo **antes de 27/09 11:13**;
   - não ficam autorizadas as músicas cadastradas pelo envio direcionado em 27/09 e 28/09 (as 179 do incidente).

## Limpeza do incidente (etapa separada, só com sua confirmação)

- Arquivar os envios de Catálogo **ainda não feitos** ligados às 240 músicas do incidente (cerca de 99,5 mil) e encerrar os 240 planos.
- Não mexer nos 2.516 já colocados, nem nos 179 envios manuais/Campanha (incluindo as 56 do Pantanal).

## Fora do escopo (preservado)

- Fluxo de Campanha homologado, Catálogo explícito, executor, Spotify, VPS, Agent, playlists.
- Quota por app, pausa para conta sem Premium e laço de sincronização do app 12: correções separadas, depois desta.

## Testes de aceitação

1. Música **nova** enviada para 1 playlist de Campanha: 1 envio `MANUAL` e **0** planos de Catálogo.
2. Música **nova** enviada para 1 playlist de Catálogo pelo modo direcionado: só 1 envio e 0 planos.
3. Lote de 5 músicas novas no modo direcionado: 5 envios, 0 planos, 0 envios `CATALOG`.
4. Música nova pela distribuição de Catálogo (por gênero): autorizada, 1 plano e envios `CATALOG` para o gênero, como hoje.
5. Música não autorizada inativada e depois reativada: 0 planos.
6. Música autorizada inativada e depois reativada: plano criado, como hoje.
7. Chamada direta a `engine_create_distribution_plan` com música não autorizada: recusada, 0 envios.
8. Música antiga do Catálogo: continua distribuindo normalmente.
9. Depois da limpeza: 0 envios `CATALOG` pendentes das músicas do incidente, e os 56 do Pantanal continuam na fila.

## Detalhes técnicos

- Uma migração: coluna nova, preenchimento das músicas antigas, e nova versão de `trg_catalog_track_create_plan`, `distribute_catalog_track` e `engine_create_distribution_plan`.
- Edição de `place-catalog-track-on-playlist/index.ts`: grava `catalog_distribution_authorized: false` explicitamente e publica a função de novo.
- Os testes rodam sem chamar o Spotify: é só conferir o que foi gravado no banco. Músicas de teste usam uma playlist de teste e são apagadas no fim.
