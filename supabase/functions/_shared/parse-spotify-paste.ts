// _shared/parse-spotify-paste.ts
// Parser determinístico do paste de "Top playlists" do Spotify for Artists.
//
// Formato fixo de cada linha (concatenado sem separador limpo):
//   <posição><nome da playlist><criador><streams><data adicionada>
//
// Exemplo bruto:
//   1
//
//   Radio
//
//   Spotify199.283—2
//
//   FUNK 2026 🔥 AS MELHORES | TOP 100
//
//   —73.92420 de mar. de 20263
//
// Onde criador é "Spotify" (editorial) ou "—" (não-editorial).
// Streams são números pt-BR (1.234 = 1234) e podem vir colados ao "—" ou "Spotify".
// Data é "DD de <mês>. de YYYY" em pt-BR (ex: "20 de mar. de 2026").

export type ParsedPasteRow = {
  position: number;
  name: string;
  creator: string | null; // "Spotify" para editorial, null caso contrário
  is_editorial: boolean;
  streams: number;
  added_at: string | null; // ISO date YYYY-MM-DD
  added_at_raw: string | null;
};

const MONTHS_PT: Record<string, string> = {
  "jan": "01",
  "fev": "02",
  "mar": "03",
  "abr": "04",
  "mai": "05",
  "jun": "06",
  "jul": "07",
  "ago": "08",
  "set": "09",
  "out": "10",
  "nov": "11",
  "dez": "12",
};

/** Converte "20 de mar. de 2026" → "2026-03-20". Retorna null se não bater. */
export function parsePtDate(input: string): string | null {
  const m = input.match(
    /(\d{1,2})\s+de\s+([a-zç]{3,})\.?\s+de\s+(\d{4})/i,
  );
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const monthKey = m[2].slice(0, 3).toLowerCase();
  const month = MONTHS_PT[monthKey];
  const year = m[3];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

/** Converte "1.234.567" / "1234" / "—" → number. "—" vira 0. */
function parsePtNumber(input: string): number {
  const cleaned = input.replace(/[^\d]/g, "");
  if (!cleaned) return 0;
  return parseInt(cleaned, 10);
}

/**
 * Parser principal. Recebe o texto cru e devolve as linhas de playlist.
 * Estratégia:
 *   1) Quebra o texto por linhas, ignora linhas vazias e cabeçalhos conhecidos.
 *   2) Procura tokens de posição (números puros 1..N) como âncoras.
 *   3) Entre duas âncoras, identifica: nome, criador, streams, data.
 */
export function parseSpotifyForArtistsPaste(raw: string): {
  rows: ParsedPasteRow[];
  song_name: string | null;
  total_streams_period: number | null;
} {
  if (!raw || typeof raw !== "string") {
    return { rows: [], song_name: null, total_streams_period: null };
  }

  // Cabeçalhos do Spotify for Artists que devemos ignorar
  const HEADER_TOKENS = new Set([
    "faixa",
    "streams de todo o período",
    "data de lançamento",
    "7 dias",
    "28 dias",
    "12 meses",
    "filtros",
    "visão geral",
    "localização",
    "playlists",
    "últimos 7 dias",
    "últimos 28 dias",
    "últimos 12 meses",
    "criada por",
    "streams",
    "adicionado em",
  ]);

  // Normaliza: troca múltiplos espaços/quebras por \n simples e tira BOM
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Detecta nome da música (primeira linha logo após "Faixa")
  let song_name: string | null = null;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].toLowerCase() === "faixa") {
      song_name = lines[i + 1];
      break;
    }
  }

  // Detecta total de streams do período (linha após "Streams de todo o período")
  let total_streams_period: number | null = null;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].toLowerCase() === "streams de todo o período") {
      const n = parsePtNumber(lines[i + 1]);
      if (n > 0) total_streams_period = n;
      break;
    }
  }

  // Filtra linhas de cabeçalho
  const cleanLines = lines.filter((l) => {
    const lc = l.toLowerCase();
    if (HEADER_TOKENS.has(lc)) return false;
    // Linhas tipo "100 principais playlists de X com esta música"
    if (/^\d+\s+principais\s+playlists/i.test(l)) return false;
    return true;
  });

  // O Spotify for Artists junta vários campos numa mesma linha,
  // ex: "—73.92420 de mar. de 20263". Precisamos quebrar.
  //
  // Estratégia: percorrer as linhas e dentro de cada uma, extrair tokens
  // de "data pt-br" e "número de posição" (1..1000). Separamos cada bloco
  // pelos números de posição no início.

  // Reconstroi o texto colando linhas adjacentes pra não perder limites
  // (o Spotify for Artists às vezes quebra "Spotify\n199.283—2" em duas linhas)
  const blob = cleanLines.join("\n");

  // Regex de uma linha de playlist:
  //   <posição>\n
  //   <nome>\n
  //   (Spotify)? streams (data)? <próxima posição>
  //
  // Mais robusto: vamos splitar por "âncoras de posição" — números puros
  // numa linha — e pra cada bloco extrair os campos.

  // Pega todas as posições candidatas: número puro numa linha sozinha
  // OU número grudado no fim de uma linha numérica (ex: "...20263" → próxima é 3)
  const rows: ParsedPasteRow[] = [];

  // Vamos usar regex global que captura cada "registro":
  // posição (linha só com número 1..N) seguida do bloco até a próxima posição.
  const linesArr = blob.split("\n");

  // Indices das linhas que são posição (número puro entre 1 e 999)
  const posIdx: number[] = [];
  for (let i = 0; i < linesArr.length; i++) {
    if (/^\d{1,3}$/.test(linesArr[i].trim())) {
      const n = parseInt(linesArr[i].trim(), 10);
      if (n >= 1 && n <= 999) posIdx.push(i);
    }
  }

  // Pra cada posição, o bloco vai dela até a próxima posição (exclusive)
  for (let p = 0; p < posIdx.length; p++) {
    const start = posIdx[p];
    const end = p + 1 < posIdx.length ? posIdx[p + 1] : linesArr.length;
    const position = parseInt(linesArr[start].trim(), 10);
    const block = linesArr.slice(start + 1, end);
    if (block.length === 0) continue;

    // Nome = primeira linha não-vazia do bloco
    const name = block[0]?.trim() ?? "";
    if (!name) continue;

    // O resto do bloco contém creator + streams + data (geralmente em 1-2 linhas)
    const tail = block.slice(1).join(" ").trim();

    // Detecta editorial: começa com "Spotify"
    let is_editorial = false;
    let creator: string | null = null;
    let restAfterCreator = tail;
    const editorialMatch = tail.match(/^Spotify\b/);
    if (editorialMatch) {
      is_editorial = true;
      creator = "Spotify";
      restAfterCreator = tail.slice(editorialMatch[0].length);
    } else {
      // Não-editorial: começa com "—" (em-dash)
      const dashMatch = tail.match(/^[—–-]+/);
      if (dashMatch) {
        restAfterCreator = tail.slice(dashMatch[0].length);
      }
    }

    // Agora restAfterCreator começa com streams (números pt-BR) e termina com data
    // Ex: "73.92420 de mar. de 2026" → streams=73924, data="20 de mar. de 2026"
    // OBS: o "20" da data fica grudado nos streams. Precisamos detectar a data
    // pelo padrão "DE <mês>. de YYYY" e o que vem antes da data é streams + dia.
    const dateRe = /(\d{1,2})\s+de\s+([a-zç]{3,})\.?\s+de\s+(\d{4})/i;
    const dateMatch = restAfterCreator.match(dateRe);

    let streams = 0;
    let added_at: string | null = null;
    let added_at_raw: string | null = null;

    if (dateMatch) {
      const dateStartIdx = dateMatch.index ?? 0;
      // Tudo antes do dia da data é streams. O dia da data é o primeiro
      // número de 1-2 dígitos que aparece em dateMatch.
      const beforeDate = restAfterCreator.slice(0, dateStartIdx);
      streams = parsePtNumber(beforeDate);
      added_at_raw = dateMatch[0];
      added_at = parsePtDate(dateMatch[0]);
    } else {
      // Sem data: tudo é streams
      streams = parsePtNumber(restAfterCreator);
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
  }

  return { rows, song_name, total_streams_period };
}
