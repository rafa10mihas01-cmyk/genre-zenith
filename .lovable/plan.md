# Adicionar botão "Aprovar e distribuir" no header

Sim — exatamente esse header onde ficam Compartilhar, Auditar e Upload. Vou colocar o botão **"Aprovar e distribuir"** ali, ao lado do Auditar.

## O que muda

**Arquivo:** `src/components/campaign-hub/CampaignHero.tsx` (header da campanha — onde o Auditar foi adicionado).

**Novo botão "Aprovar e distribuir":**
- Aparece quando: `eco_dispatched_at IS NULL` (campanha ainda não foi distribuída internamente)
- Estilo: botão verde primário (destaque — é a ação principal pendente)
- Posição: à esquerda do Auditar, pra ser a primeira coisa que chama atenção
- Ação: mesma RPC que o botão "Distribuir agora" do Console já chama (`approve_campaign`), com toast de sucesso/erro
- Quando `client_approved_at` é null → toast de aviso: "Cliente ainda não aprovou o plano"
- Após sucesso: refetch da campanha → botão some sozinho (eco_dispatched_at preenchido)

**O que NÃO muda:**
- Botão "Distribuir agora" do `CampaignDistributionConsole` continua existindo (não remove nada)
- Nenhuma lógica de negócio nova — só reutiliza a RPC `approve_campaign` que já existe
- Sem mudança de DB, sem edge function nova

## Resultado

No header da campanha você passa a ver, na ordem:
**[Aprovar e distribuir] · [Compartilhar] · [Escudo] · [Auditar] · [Upload]**

Quando a campanha já estiver distribuída, o botão verde some e fica só o resto.
