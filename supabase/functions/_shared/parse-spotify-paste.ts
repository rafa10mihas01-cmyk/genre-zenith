// _shared/parse-spotify-paste.ts
// Parser determinístico do paste de "Top playlists" do Spotify for Artists.
//
// Layout pós-filtro (linhas com lixo removido):
//
//   <posição>
//   <nome>
//   <footer: creator + streams + [data] + próxima-posição-grudada>
//   <próximo nome>
//   <próximo footer>
//   ...
//
// O footer SEMPRE pertence ao registro anterior (não ao próximo). Ele contém:
//   creator: "Spotify" | "—" / "–" / "-"
//   streams: número pt-BR
//   data: opcional, "DD de <mês>. de YYYY"
//   próxima-posição grudada (1-3 dígitos finais)

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
  if (!month) return null;
  return `${m[3]}-${month}-${day}`;
}

function parsePtNumber(input: string): number {
  const cleaned = input.replace(/[^\d]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
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

/**
 * Parseia um footer e devolve { creator, streams, added_at, next_position }.
 * Footer pode ser tipo:
 *   "Spotify199.283—2"   → editorial, streams 199.283, próx-pos 2
 *   "—73.92420 de mar. de 20263" → não-editorial, streams 73.924, data, próx-pos 3
 *   "—302 de abr. de 2026" → último registro: streams 30, data, sem próx-pos
 *   "—2.500"             → sem data, sem próx-pos (último)
 */
function parseFooter(footer: string): {
  creator: string | null;
  is_editorial: boolean;
  streams: number;
  added_at: string | null;
  added_at_raw: string | null;
  next_position: number | null;
} {
  let body = footer.trim();
  let creator: string | null = null;
  let is_editorial = false;

  // Detecta creator no início
  const editorialMatch = body.match(/^Spotify(?=\d|—|–|-)/i);
  if (editorialMatch) {
    is_editorial = true;
    creator = "Spotify";
    body = body.slice(editorialMatch[0].length);
  } else {
    const dashMatch = body.match(/^[—–-]+/);
    if (dashMatch) body = body.slice(dashMatch[0].length);
  }
  body = body.trim();

  // Caso editorial: "Spotify199.283—2"
  // Após remover "Spotify" no começo, sobra "199.283—2". O "—" é o SEPARADOR
  // entre streams e próx-posição (porque editoriais não têm data e o "—"
  // representa "data inexistente"). Trata isso primeiro.
  if (is_editorial) {
    const dashSplit = body.split(/[—–-]+/);
    if (dashSplit.length >= 2) {
      const streamsPart = dashSplit[0];
      const nextPart = dashSplit[dashSplit.length - 1];
      const np = nextPart.match(/^(\d{1,3})$/);
      const streams = parsePtNumber(streamsPart);
      const next_position = np ? parseInt(np[1], 10) : null;
      return {
        creator,
        is_editorial,
        streams,
        added_at: null,
        added_at_raw: null,
        next_position,
      };
    }
  }

  let streams = 0;
  let added_at: string | null = null;
  let added_at_raw: string | null = null;
  let next_position: number | null = null;

  // Tenta achar data
  const dateRe = /(\d{1,2})\s+de\s+([a-zç]{3,})\.?\s+de\s+(\d{4})/i;
  const dateMatch = body.match(dateRe);

  if (dateMatch && typeof dateMatch.index === "number") {
    const beforeDate = body.slice(0, dateMatch.index);
    streams = parsePtNumber(beforeDate);
    added_at_raw = dateMatch[0];
    added_at = parsePtDate(dateMatch[0]);
    const afterDate = body.slice(dateMatch.index + dateMatch[0].length).trim();
    const nextPosMatch = afterDate.match(/^(\d{1,3})$/);
    if (nextPosMatch) next_position = parseInt(nextPosMatch[1], 10);
  } else {
    // Sem data. Streams pt-BR usa "." como milhar (3 dígitos por grupo).
    // Próx-pos vem grudada no fim. Ex: "2.5002" → streams=2.500, próx-pos=2
    const lastDot = body.lastIndexOf(".");
    if (lastDot >= 0) {
      const after = body.slice(lastDot + 1);
      const m3 = after.match(/^(\d{3})(\d{1,3})?$/);
      if (m3) {
        streams = parsePtNumber(body.slice(0, lastDot + 1 + 3));
        if (m3[2]) next_position = parseInt(m3[2], 10);
      } else {
        streams = parsePtNumber(body);
      }
    } else {
      streams = parsePtNumber(body);
    }
  }

  return { creator, is_editorial, streams, added_at, added_at_raw, next_position };
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

  const lines = allLines.filter((l) => l && !isHeaderLine(l));

  // Acha a primeira "posição 1" como ponto de partida das playlists
  // (antes disso pode ter linhas residuais como nome da música, total etc.)
  const startIdx = lines.findIndex((l) => l === "1");
  if (startIdx < 0) return { rows: [], song_name, total_streams_period };

  const rows: ParsedPasteRow[] = [];
  let expectedPos = 1;
  let i = startIdx;

  while (i < lines.length) {
    const posLine = lines[i];
    if (!/^\d{1,3}$/.test(posLine)) break;
    const position = parseInt(posLine, 10);
    if (position !== expectedPos) {
      // Posição inesperada: aborta pra evitar lixo
      break;
    }
    const name = lines[i + 1];
    const footer = lines[i + 2];
    if (!name || !footer) break;

    const f = parseFooter(footer);
    rows.push({
      position,
      name,
      creator: f.creator,
      is_editorial: f.is_editorial,
      streams: f.streams,
      added_at: f.added_at,
      added_at_raw: f.added_at_raw,
    });

    if (f.next_position !== null) {
      expectedPos = f.next_position;
      // A próxima posição não é uma linha separada — está consumida no footer.
      // Avança 2 linhas (nome + footer) e a "próxima posição" é virtual.
      i += 2;
      // Insere uma "linha virtual" da próxima posição: como não temos linha,
      // vamos usar fluxo direto: na próxima iteração esperamos que lines[i]
      // seja o NOME da próxima playlist (não a posição). Ajusta: i aponta pra
      // próximo nome, e tratamos diferente.
      //
      // Mais simples: muda a estrutura pra ler em pares (nome, footer) após a
      // posição inicial.
      break;
    } else {
      // último registro
      break;
    }
  }

  // Continua: já temos pos 1 lida. Agora i aponta pra pos 2 (nome). Lemos
  // pares (nome, footer) e usamos expectedPos pra atribuir.
  while (i < lines.length) {
    const name = lines[i];
    const footer = lines[i + 1];
    if (!name || !footer) break;
    // Defensivo: se nome parece ser apenas dígitos, não é playlist
    if (/^\d{1,3}$/.test(name)) break;

    const f = parseFooter(footer);
    rows.push({
      position: expectedPos,
      name,
      creator: f.creator,
      is_editorial: f.is_editorial,
      streams: f.streams,
      added_at: f.added_at,
      added_at_raw: f.added_at_raw,
    });

    if (f.next_position === null) break;
    expectedPos = f.next_position;
    i += 2;
  }

  return { rows, song_name, total_streams_period };
}
