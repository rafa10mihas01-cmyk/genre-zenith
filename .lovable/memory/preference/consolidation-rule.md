---
name: Regra de consolidação — nome ≠ responsabilidade
description: Princípio obrigatório em qualquer fase de consolidação (1.A, 1.B, …). Antes de DROP, comparar a pergunta de negócio, nunca o nome.
type: preference
---

Nunca decidir um DROP apenas porque dois componentes (tabela, coluna, função, trigger, edge function) têm nomes parecidos.

**Procedimento obrigatório antes de qualquer DROP:**

1. Identificar a pergunta de negócio que cada componente responde.
2. Comparar **responsabilidades**, não nomes.
3. Aplicar a decisão:
   - Responsabilidade **diferente** → renomear pra eliminar a ambiguidade. Não dropar.
   - Responsabilidade **igual** → consolidar na fonte oficial e dropar a duplicata.
   - Em dúvida → reportar e pedir reescopo, como aconteceu nas Fases 1.A.2 e 1.A.3.

**Why:** Nomes coincidentes (`is_baseline` em 4 tabelas diferentes, por exemplo) podem mascarar semânticas distintas. DROP sem auditoria de responsabilidade já provocaria perda de dados em fases anteriores (snapshots, deal_logs, curator_playlists).

**How to apply:** Todo Auditor BEFORE deve obrigatoriamente responder "qual pergunta de negócio essa coluna/objeto responde?" antes de listar dependências. Se a resposta for única no grão dela, é arquitetura oficial — não candidata a DROP.
