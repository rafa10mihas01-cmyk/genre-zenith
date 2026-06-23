---
name: Reorganizar sem remover capacidade
description: Antes de remover informação de uma tela, confirmar que ela já existe em outro local usando a MESMA fonte de dados. Sem equivalente = não remove, só colapsa.
type: preference
---
Antes de remover qualquer informação de uma tela durante reorganização visual:

1. Buscar (`rg`) por todas as referências à mesma fonte (tabela/view/RPC + campo) em `src/`.
2. Se já aparece em outra tela com a mesma fonte → pode remover do local atual.
3. Se NÃO aparece em nenhum outro lugar → **proibido remover**. Opções permitidas:
   - colapsar atrás de um disclosure ("Detalhes técnicos", "Avançado")
   - mover para o final da tela
   - reduzir densidade visual (fonte menor, sem cor de destaque)
   - agrupar com itens correlatos

**Why:** O objetivo da consolidação é reduzir complexidade visual sem reduzir capacidade operacional. Remover dado sem equivalente cria buraco operacional.
**How to apply:** Em qualquer task de "reorganizar/limpar UI", validar item por item antes de propor remoção.
