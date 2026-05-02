// _shared/parse-spotify-paste.ts
// Parser determinístico do paste de "Top playlists" do Spotify for Artists.
//
// Formato observado: o Spotify cola tudo concatenado, e cada registro é:
//
//   <posição>\n
//   <nome da playlist>\n
//   <creator><streams>[<data>]<próxima-posição>
//
// Onde:
//   - posição: 1..999, sozinha numa linha
//   - creator: "Spotify" (editorial) ou "—" / "–" / "-" (não-editorial)
//   - streams: número pt-BR (1.234.567)
//   - data: opcional, formato "DD de <mês>. de YYYY"
//   - a próxima-posição vem GRUDADA no fim do registro (sem separador), depois
//     vem \n e o próximo nome.
//
// Estratégia: usamos uma regex global que captura
//   posição + nome + linha-de-rodapé(creator/streams/data + próxima-posição grudada)
// e a próxima posição é "devolvida" pela regex como início do próximo match
// via lookahead.

export type ParsedPasteRow = {
  position: number;
  name: string;
  creator: string | null;
  is_editorial: boolean;
  streams: number;
  added_at: string | null;
  added_at_raw: string | null;
};

const MONTHS_PT: Record<string, string> = {
  jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
  jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",
};

export function parsePtDate(input: string): string | null {
  const m = input.match(/(\d{1,2})\s+de\s+([a-zç]{3,})\.?\s+de\s+(\d{4})/i);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const monthKey = m[2].slice(0, 3).toLowerCase();
  const month = MONTHS_PT[monthKey];
  const year = m[3];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

function parsePtNumber(input: string): number {
  const cleaned = input.replace(/[^\d]/g, "");
  if (!cleaned) return 0;
  return parseInt(cleaned, 10);
}

const HEADER_REGEXES: RegExp[] = [
  /^Faixa$/i,
  /^Streams de todo o período$/i,
  /^Data de lançamento$/i,
  /^7 dias\s*28 dias\s*12 meses$/i,
  /^Filtros$/i,
  /^Visão geral\s*Localização\s*Playlists$/i,
  /^\d+\s+principais\s+playlists/i,
  /^Últimos\s+\d+\s+(dias?|meses?)$/i,
  /^Criada por$/i,
  /^Streams$/i,
  /^Adicionado em$/i,
];

function isHeaderLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return HEADER_REGEXES.some((re) => re.test(t));
}

export function parseSpotifyForArtistsPaste(raw: string): {
  rows: ParsedPasteRow[];
  song_name: string | null;
  total_streams_period: number | null;
} {
  if (!raw || typeof raw !== "string") {
    return { rows: [], song_name: null, total_streams_period: null };
  }

  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  const allLines = normalized.split("\n").map((l) => l.trim());

  // Metadados
  let song_name: string | null = null;
  for (let i = 0; i < allLines.length - 1; i++) {
    if (allLines[i].toLowerCase() === "faixa") {
      for (let j = i + 1; j < allLines.length; j++) {
        if (allLines[j]) { song_name = allLines[j]; break; }
      }
      break;
    }
  }

  let total_streams_period: number | null = null;
  for (let i = 0; i < allLines.length - 1; i++) {
    if (allLines[i].toLowerCase() === "streams de todo o período") {
      for (let j = i + 1; j < allLines.length; j++) {
        if (allLines[j]) {
          const n = parsePtNumber(allLines[j]);
          if (n > 0) total_streams_period = n;
          break;
        }
      }
      break;
    }
  }

  // Remove cabeçalhos e linhas vazias
  const lines = allLines.filter((l) => l && !isHeaderLine(l));
  const text = lines.join("\n");

  // Regex de UM registro:
  //   início-de-linha posição
  //   \n nome (qualquer coisa exceto \n)
  //   \n footer (creator/streams/data + próxima-pos grudada)
  //
  // O footer termina quando bate em "\n<nome-da-próxima>" — mas o problema é que
  // a próxima posição está GRUDADA no fim do footer.
  //
  // Solução: o footer é UMA linha só (até \n), e dentro dela os últimos dígitos
  // são a próxima posição. A regex captura:
  //   ^pos\n  nome  \n  footer
  // E depois a gente extrai do footer:
  //   - creator (Spotify | —)
  //   - streams (números pt-BR)
  //   - data opcional (com YYYY no fim)
  //   - próxima posição = dígitos finais não consumidos pela data/streams.
  //
  // O truque importante: se há data, ela termina em YYYY e os dígitos APÓS o
  // YYYY são a próxima posição. Se não há data, os dígitos finais isolados
  // podem ser parte dos streams OU a próxima posição. Precisamos olhar:
  // streams pt-BR usa "." como separador de milhar, então uma sequência tipo
  // "199.283" tem ponto. "199.2832" significa streams=199.283 e próxima-pos=2.
  // Heurística: o número de streams é tudo até o último ponto + 3 dígitos. O
  // que sobra depois disso é a próxima posição (1-3 dígitos).

  const registroRe = /(?:^|\n)(\d{1,3})\n([^\n]+)\n([^\n]+)/g;

  const rows: ParsedPasteRow[] = [];
  let match: RegExpExecArray | null;

  while ((match = registroRe.exec(text)) !== null) {
    const position = parseInt(match[1], 10);
    if (position < 1 || position > 999) continue;
    const name = match[2].trim();
    if (!name) continue;
    const footerRaw = match[3].trim();

    // A próxima iteração da regex precisa começar logo após \n da posição
    // que fica grudada no fim do footer. Como nossa regex consome o footer
    // inteiro, precisamos "rebobinar" o lastIndex pra antes da próxima posição.
    // Mas como a próxima posição está GRUDADA, ela está dentro do footer.
    // Vamos extrair, e também avançar o regex pra continuar do próximo \n.
    // (lastIndex já está depois do footer, ok — só perde 1 registro se a
    //  próxima posição não estiver grudada. Caso real: está sempre grudada.)

    // Detecta creator
    let is_editorial = false;
    let creator: string | null = null;
    let body = footerRaw;

    const editorialMatch = body.match(/^Spotify\b/);
    if (editorialMatch) {
      is_editorial = true;
      creator = "Spotify";
      body = body.slice(editorialMatch[0].length);
    } else {
      const dashMatch = body.match(/^[—–-]+/);
      if (dashMatch) body = body.slice(dashMatch[0].length);
    }
    body = body.trim();

    // Tenta achar data; se houver, separa: streams = antes da data, próx-pos = depois
    let streams = 0;
    let added_at: string | null = null;
    let added_at_raw: string | null = null;
    let nextPosOverride: number | null = null;

    const dateRe = /(\d{1,2})\s+de\s+([a-zç]{3,})\.?\s+de\s+(\d{4})/i;
    const dateMatch = body.match(dateRe);

    if (dateMatch && typeof dateMatch.index === "number") {
      const beforeDate = body.slice(0, dateMatch.index);
      streams = parsePtNumber(beforeDate);
      added_at_raw = dateMatch[0];
      added_at = parsePtDate(dateMatch[0]);
      const afterDate = body.slice(dateMatch.index + dateMatch[0].length).trim();
      // O que sobra depois da data deve ser a próxima posição (1-3 dígitos)
      const nextPosMatch = afterDate.match(/^(\d{1,3})/);
      if (nextPosMatch) {
        nextPosOverride = parseInt(nextPosMatch[1], 10);
      }
    } else {
      // Sem data: separa streams (X.YYY.ZZZ ou X.YYY ou XYZ) da próxima posição
      // Usa a regra do separador de milhar pt-BR: streams sempre termina em
      // grupos de 3 dígitos após o último ponto. Se há ponto: streams = parte
      // que termina em "." + 3 dígitos. O resto é próxima pos.
      const lastDot = body.lastIndexOf(".");
      if (lastDot >= 0) {
        // Pega 3 dígitos após o último ponto como fim dos streams
        const after = body.slice(lastDot + 1);
        const m3 = after.match(/^(\d{3})(\d{1,3})?$/);
        if (m3) {
          // streams completo = body até lastDot+1+3, próx pos = resto
          const streamsStr = body.slice(0, lastDot + 1 + 3);
          streams = parsePtNumber(streamsStr);
          if (m3[2]) nextPosOverride = parseInt(m3[2], 10);
        } else {
          // fallback: streams = tudo
          streams = parsePtNumber(body);
        }
      } else {
        // Sem ponto: tudo numérico junto. Difícil separar. Heurística:
        // se tem mais de 3 dígitos, últimos 1-2 podem ser próxima pos.
        // Mas pra evitar erro, considera tudo como streams.
        streams = parsePtNumber(body);
      }
    }

    rows.push({
      position,
      name,
      creator,
      is_editorial,
      streams,
      added_at,
      added_at_raw,
    });

    // Se detectamos próxima posição grudada, "rebobina" o regex pra capturá-la
    if (nextPosOverride !== null) {
      // Encontra onde essa próxima pos começa no text (último número grudado
      // no footer original). Reposiciona lastIndex.
      const footerStart = match.index + match[0].length - footerRaw.length;
      const nextPosStr = String(nextPosOverride);
      const nextPosIdxInFooter = footerRaw.lastIndexOf(nextPosStr);
      if (nextPosIdxInFooter >= 0) {
        registroRe.lastIndex = footerStart + nextPosIdxInFooter - 1; // -1 pra incluir \n
      }
    }
  }

  return { rows, song_name, total_streams_period };
}
