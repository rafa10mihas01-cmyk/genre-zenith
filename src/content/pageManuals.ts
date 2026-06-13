/**
 * Conteúdo dos manuais por página.
 *
 * Cada chave (`manualKey`) é referenciada pelo <PageHeader manualKey="..." />
 * e renderizada por <PageManual />.
 *
 * RASCUNHO AUTOMÁTICO: o texto abaixo descreve o que cada página faz HOJE,
 * com base no código atual. O usuário vai revisar/substituir o texto de cada
 * página depois — manter o formato (title + subtitle + sections).
 *
 * Formato de seção:
 *   - heading: título curto da seção
 *   - body:    string única OU array de strings (cada item vira um parágrafo
 *              ou bullet — se começar com "• " é renderizado como bullet)
 */

export type ManualSection = {
  heading: string;
  body: string | string[];
};

export type PageManualData = {
  /** Título do painel (geralmente igual ao título da página). */
  title: string;
  /** Resumo de 1 linha — o que é essa página. */
  subtitle: string;
  /** Seções do manual, na ordem de exibição. */
  sections: ManualSection[];
};

export const PAGE_MANUALS: Record<string, PageManualData> = {
  // ────────────────────────────────────────────────────────────────────
  // COCKPIT
  // ────────────────────────────────────────────────────────────────────
  cockpit: {
    title: "Cockpit",
    subtitle: "Pulso diário da operação inteira em uma tela.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body:
          "É a primeira tela do dia. Mostra o que precisa da sua atenção AGORA: " +
          "curadoria pendente, campanhas em risco, deals próximos do vencimento, " +
          "alertas do sistema. Cada card é um atalho — clica e vai direto pra ação.",
      },
      {
        heading: "Quando usar",
        body: [
          "• Abrindo o sistema de manhã, pra decidir por onde começar.",
          "• Depois de cada pausa, pra recalibrar prioridades do dia.",
          "• Antes de reuniões, pra checar se nada urgente apareceu.",
        ],
      },
      {
        heading: "Quando NÃO usar",
        body:
          "Não é página de análise nem de relatório. Pra ver números históricos " +
          "use Analytics. Pra trabalhar uma entidade específica, vá direto pra " +
          "Clientes, Curadores, Campanhas, Deals ou Playlists.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // CLIENTES
  // ────────────────────────────────────────────────────────────────────
  clientes: {
    title: "Clientes",
    subtitle: "Artistas e labels que contrataram a NexEngine.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body:
          "Lista completa dos clientes ativos — quem é dono de um plano contratado. " +
          "Cada linha mostra o cliente, o plano em vigor, as campanhas ligadas e o " +
          "status geral da entrega.",
      },
      {
        heading: "Como cadastrar",
        body: [
          "• Clique em \"Novo cliente\" no topo direito.",
          "• Preencha nome, contato e selecione o plano contratado.",
          "• Após salvar, abra o cliente pra criar a primeira campanha.",
        ],
      },
      {
        heading: "Como abrir um cliente",
        body:
          "Clique em qualquer linha pra abrir a ficha completa — histórico de " +
          "campanhas, deals fechados, próximos passos e contatos.",
      },
      {
        heading: "Como NÃO usar",
        body:
          "Não cadastre curadores nem prospects aqui. Curadores vão pra /curadores " +
          "(aba Ativos ou Prospecção). Cliente é quem PAGA pela curadoria.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // CURADORES
  // ────────────────────────────────────────────────────────────────────
  curadores: {
    title: "Curadores",
    subtitle: "Quem aborda playlists e fecha deals em nome dos clientes.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body:
          "Página com duas abas distintas: ATIVOS (curadores que já fecharam deals " +
          "com a gente) e PROSPECÇÃO (CRM de leads importados via planilha que ainda " +
          "não viraram parceiros).",
      },
      {
        heading: "Aba Ativos",
        body:
          "Curadores reais ligados a deals fechados (tabela curators). Use pra " +
          "consultar histórico, performance, taxa de aprovação e gerenciar contatos " +
          "recorrentes.",
      },
      {
        heading: "Aba Prospecção",
        body:
          "CRM de leads (tabela external_curators). Importe planilhas XLSX, marque " +
          "status (Contatado, Negociando, Comprado, Recusado) e mova pra Ativos " +
          "quando o primeiro deal for fechado.",
      },
      {
        heading: "Como NÃO usar",
        body: [
          "• Status \"Comprado\" no CRM NÃO significa que existe deal real — " +
            "é só uma marcação do funil.",
          "• Não unifique as duas listas — são tabelas diferentes no banco, " +
            "com propósitos diferentes.",
          "• Não cadastre clientes aqui. Cliente vai pra /clientes.",
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // CAMPANHAS
  // ────────────────────────────────────────────────────────────────────
  campanhas: {
    title: "Campanhas",
    subtitle: "Plano de ação que conecta cliente, meta e curadores.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body:
          "Toda campanha em andamento e seu status. Campanha = combinação de " +
          "uma faixa do cliente + meta de adições em playlists + período + " +
          "orçamento. É o documento operacional que guia a equipe.",
      },
      {
        heading: "Como criar uma campanha",
        body: [
          "• Clique em \"Nova campanha\" e selecione o cliente.",
          "• Defina faixa, meta de adições, prazo e orçamento.",
          "• Após criada, distribua as adições por curador na aba Execução.",
        ],
      },
      {
        heading: "Recalcular",
        body:
          "O botão \"Recalcular\" reprocessa todas as campanhas listadas — " +
          "atualiza progresso, status, alertas e ranking. Use depois de importar " +
          "deals em lote ou quando suspeitar que os números estão desatualizados.",
      },
      {
        heading: "Como NÃO usar",
        body:
          "Não use campanhas pra controle financeiro de deals — isso vive em " +
          "Deals > Financeiro. Campanha é o PLANO; deal é a transação.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // DEALS (PLAYLIST DEALS)
  // ────────────────────────────────────────────────────────────────────
  deals: {
    title: "Negociações",
    subtitle: "Transações fechadas entre curador e playlist.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body:
          "Todo deal já cadastrado, separado por status: Ativos (rodando), " +
          "Concluídos (entregue), Financeiro (foco em pagamento) e Todos " +
          "(visão completa). Cada linha é uma transação real com curador, " +
          "playlist, faixa, valor e prazo.",
      },
      {
        heading: "Como criar um deal",
        body: [
          "• Clique em \"Novo\" no topo direito.",
          "• Escolha o tipo (individual, em lote ou via Comunidade).",
          "• Selecione curador, playlist e faixa; defina valor e janela.",
          "• Após criar, acompanhe o status até a confirmação de adição.",
        ],
      },
      {
        heading: "Abas",
        body: [
          "• Ativos — deals em curso, aguardando entrega ou confirmação.",
          "• Concluídos — entregues e validados.",
          "• Financeiro — visão por pagamento (pendente, pago, em conferência).",
          "• Todos — sem filtro de status.",
        ],
      },
      {
        heading: "Como NÃO usar",
        body:
          "Deals só mostra TRANSAÇÕES. Não cadastre curadores nem clientes " +
          "como sub-abas aqui — são entidades top-level em /curadores e /clientes.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // COMUNIDADE
  // ────────────────────────────────────────────────────────────────────
  comunidade: {
    title: "Comunidade",
    subtitle: "Camada social: convites, membros e pontuação.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body:
          "Painel admin da Comunidade NexEngine — quem entrou via convite, quem " +
          "está ativo, pontuação acumulada, campanhas internas e contas dos " +
          "membros. É onde a operação SOCIAL acontece (curadores em comunidade), " +
          "diferente dos curadores contratuais em /curadores.",
      },
      {
        heading: "Como convidar",
        body: [
          "• Clique em \"Novo\" → \"Convite\".",
          "• Cole o e-mail (ou múltiplos) e selecione o papel.",
          "• O convite é enviado e fica pendente até ser aceito.",
        ],
      },
      {
        heading: "Sub-abas",
        body: [
          "• Convites — pendentes, aceitos, expirados.",
          "• Membros — quem está dentro hoje, com papel e atividade.",
          "• Pontos — ranking e ajustes manuais.",
          "• Contas — gestão de credenciais e bloqueios.",
        ],
      },
      {
        heading: "Como NÃO usar",
        body:
          "Não trate Comunidade como CRM de prospecção — pra leads frios use " +
          "/curadores aba Prospecção. Comunidade é pra quem JÁ está dentro.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // PLAYLISTS (Catálogo)
  // ────────────────────────────────────────────────────────────────────
  playlists: {
    title: "Playlists",
    subtitle: "Inventário consultivo de playlists trabalhadas.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body:
          "Catálogo completo de playlists já mapeadas — gerenciadas pela casa, " +
          "de curadores parceiros e externas. Use pra consultar capa, dono, nicho, " +
          "tamanho, performance e histórico de deals antes de fechar uma negociação.",
      },
      {
        heading: "Diagnosticar uma playlist",
        body:
          "Abra a playlist e clique em \"Diagnosticar\" — o sistema analisa " +
          "tamanho, recorrência, dominância de artistas, faixas fora do nicho e " +
          "sugere o que adicionar/remover pra atingir o benchmark do mercado.",
      },
      {
        heading: "Aplicar capa gerenciada",
        body:
          "Em playlists gerenciadas, escolha a capa ideal e clique em \"Aplicar " +
          "capa\" — o sistema envia direto pro Spotify e confirma a atualização. " +
          "Se a capa antiga continuar aparecendo, é cache do cliente Spotify; " +
          "abra em anônima ou pull-to-refresh no app.",
      },
      {
        heading: "Como NÃO usar",
        body:
          "Não trate o catálogo como CRM de deals — Deals vive em /deals. Aqui " +
          "é INVENTÁRIO consultivo: \"quem é essa playlist, quanto cabe, em que " +
          "nicho ela está\".",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // ANALYTICS
  // ────────────────────────────────────────────────────────────────────
  analytics: {
    title: "Analytics",
    subtitle: "Leitura direta do motor de deals — entrega real, não promessa.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body:
          "Snapshot vivo da operação: quantos deals estão rodando, quantos plays " +
          "foram entregues de verdade (delta entre snapshots), ritmo de cada deal " +
          "ativo, quais playlists estão entregando mais e o custo por play real.",
      },
      {
        heading: "Como ler os KPIs do topo",
        body: [
          "• Deals ativos — quantos deals estão em execução agora.",
          "• Plays entregues (7d) — delta real de plays nos últimos 7 dias.",
          "• Média diária (30d) — plays entregues no mês ÷ 30.",
          "• Custo por play real — soma do custo dos deals com entrega ÷ plays entregues.",
        ],
      },
      {
        heading: "Ritmo dos deals ativos",
        body:
          "Cada linha compara o que o deal já entregou com o que deveria ter entregue " +
          "até hoje (proporcional à janela). Adiantado / No ritmo / Lento / Crítico. " +
          "Ordenado pelos mais críticos primeiro.",
      },
      {
        heading: "Fonte dos dados",
        body:
          "100% lido de curator_deals + curator_deal_snapshots + curator_deal_logs. " +
          "Sem dependência de campaigns, allocations ou views legadas — ver " +
          "docs/DEPRECATED_ANALYTICS.md.",
      },
    ],
  },

  financeiro: {
    title: "Financeiro",
    subtitle: "Custos, CPP e ranking de eficiência por curador.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body: [
          "• Total comprado, comprometido e saldo derivado (comprado − comprometido).",
          "• CPP médio global (custo por play) — referência pra avaliar todo curador novo.",
          "• Ranking de curadores ordenado por menor CPP — quem entrega mais barato fica no topo.",
          "• Histórico imutável das últimas compras (ledger).",
        ],
      },
      {
        heading: "Como usar",
        body: [
          "• Verde no CPP = mais barato que o CPP global. Âmbar = 50% mais caro que a média.",
          "• Use o ranking pra decidir pra QUEM mandar a próxima campanha primeiro.",
          "• Saldo derivado negativo significa que você prometeu mais plays do que comprou — revisar antes de fechar deal novo.",
        ],
      },
      {
        heading: "Como NÃO usar",
        body:
          "Os números aqui são derivados do ledger de compras (curator_purchases). " +
          "Pra ajustar saldo de um curador específico, use 'Adicionar saldo' no fluxo " +
          "de novo deal — NUNCA edite manualmente os totais.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // CATÁLOGO
  // ────────────────────────────────────────────────────────────────────
  catalogo: {
    title: "Catálogo",
    subtitle: "Segunda esteira de distribuição — em massa, paralela a Campanhas.",
    sections: [
      {
        heading: "O que você encontra aqui",
        body: [
          "• Músicas — todas as faixas registradas no catálogo + KPIs operacionais (totais, capacidade, placements ativos).",
          "• Playlists — ocupação por playlist do catálogo (capacidade · ocupadas · disponíveis).",
          "• Histórico — auditoria de cada distribuição executada.",
        ],
      },
      {
        heading: "Como funciona a distribuição",
        body: [
          "• Cola URL, URI ou Spotify ID da música.",
          "• O sistema resolve a faixa, cria baseline T0 (se nova) e distribui para todas as playlists do catálogo com vaga.",
          "• As únicas barreiras: música já presente naquela playlist OU playlist sem capacidade. Nada mais bloqueia.",
          "• Sem filtros de score, followers, performance ou elegibilidade — toda playlist do catálogo participa.",
        ],
      },
      {
        heading: "Catálogo ≠ Campanha",
        body: [
          "• Catálogo é distribuição em massa, sem custo por música, usando a infraestrutura própria.",
          "• Campanha continua sendo o produto premium, planejado e orientado por metas. As duas esteiras coexistem — promover uma música pra campanha não a remove do catálogo.",
        ],
      },
    ],
  },
};

