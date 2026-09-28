# Corrigir bloqueio indevido dos envios de Campanha

## Causa confirmada

O Spotify **não bloqueou os envios dessas contas**. O bloqueio aberto é somente de **consulta de metadados** (`context = enrichment`) no NexEngine 09. A parte de colocar músicas (`context = operation`) está normal.

Duas regras antigas do banco ignoram essa separação e tratam qualquer bloqueio do app como se também impedisse inserir músicas:
- `fn_sanitize_catalog_pending` reagendou os três pedidos para 29/09 às 08:10 (Brasília), com `circuit_breaker_open`;
- `claim_next_catalog_placements` também exclui os pedidos quando encontra qualquer bloqueio aberto.

Isso explica por que Metralha e “Se pá tu tá bom pra mim também” ficaram paradas. “Tchau e Bença 2” e “Cafajeste Xucro” foram enviadas normalmente pelo mesmo fluxo, confirmando que a escrita no Spotify está funcionando.

## Correção

1. Fazer `fn_sanitize_catalog_pending` considerar apenas bloqueios de **operação** ao reagendar envios.
2. Fazer `claim_next_catalog_placements` considerar apenas bloqueios de **operação** ao selecionar a fila.
3. Corrigir apenas os três pedidos afetados: remover o erro indevido e reagendar para agora, sem criar novas cópias.
4. Não fechar nem alterar o bloqueio de metadados; ele continua protegendo as consultas até expirar.
5. Não alterar cotas, Spotify, VPS, Agent, Catálogo, lógica de duplicação ou outros envios.

## Validação

- Confirmar que o bloqueio de metadados continua aberto e o de operação continua fechado.
- Executar a fila e conferir a resposta real do Spotify para os três pedidos.
- Confirmar no histórico quais entraram, quais já existiam e se houve algum erro verdadeiro.
- Verificar que nenhum placement fora desses três foi modificado pela correção de dados.
