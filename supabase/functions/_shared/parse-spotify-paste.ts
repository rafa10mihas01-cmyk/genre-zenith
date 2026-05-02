// _shared/parse-spotify-paste.ts
// Parser determinístico do paste de "Top playlists" do Spotify for Artists.
//
// O Spotify cola tudo concatenado num único "blob" multilinha:
//
//   1
//   Radio
//   Spotify199.283—2
//   FUNK 2026 🔥 AS MELHORES | TOP 100
//   —73.92420 de mar. de 20263
//   ACADEMIA FUNK ...
//
// Padrão por registro:
//   <posição-numérica numa linha sozinha>
//   <nome da playlist>
//   <criador: "Spotify" | "—"><streams pt-BR><data opcional><próxima-posição>
//
// Estratégia: trabalhar no texto inteiro (não em linhas isoladas), procurando
// a sequência "<streams><opcional data><próxima-posição-no-início-de-linha>".

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
  jan: "01",
  fev: "02",
  mar: "03",
  abr: "04",
  mai: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  set: "09",
  out: "10",
  nov: "11",
  dez: "12",
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
  /^Últimos\s+\d+\s+dias?$/i,
  /^Últimos\s+\d+\s+meses?$/i,
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

  // Normaliza
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  const allLines = normalized.split("\n").map((l) => l.trim());

  // Captura metadados antes do tratamento
  let song_name: string | null = null;
  for (let i = 0; i < allLines.length - 1; i++) {
    if (allLines[i].toLowerCase() === "faixa") {
      // Pula linhas vazias até achar conteúdo
      for (let j = i + 1; j < allLines.length; j++) {
        if (allLines[j]) {
          song_name = allLines[j];
          break;
        }
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

  // Filtra cabeçalhos e linhas vazias
  const lines = allLines.filter((l) => l && !isHeaderLine(l));

  // Trabalhamos no texto unido por \n. Usaremos regex global pra extrair cada
  // registro: posição → nome → bloco de "creator+streams+data" terminado pela
  // próxima posição (ou fim do texto).
  const text = lines.join("\n");

  // Regex que captura UM registro:
  //   ^<pos>\n<nome>\n<creator-streams-data...>
  // O "fim" do registro é a próxima linha que começa com um número 1..999 sozinho
  // (que será a próxima posição). Usamos lookahead pra não consumir.
  const registroRe =
    /(?:^|\n)(\d{1,3})\n([^\n]+)\n([\s\S]*?)(?=\n\d{1,3}\n|$)/g;

  const rows: ParsedPasteRow[] = [];
  let match: RegExpExecArray | null;
  while ((match = registroRe.exec(text)) !== null) {
    const position = parseInt(match[1], 10);
    if (position < 1 || position > 999) continue;
    const name = match[2].trim();
    if (!name) continue;
    const tail = match[3].trim();

    // Detecta editorial
    let is_editorial = false;
    let creator: string | null = null;
    let rest = tail;

    // Spotify pode aparecer como "Spotify123.456" (grudado) ou "Spotify\n123.456"
    const editorialMatch = rest.match(/^Spotify\b/);
    if (editorialMatch) {
      is_editorial = true;
      creator = "Spotify";
      rest = rest.slice(editorialMatch[0].length);
    } else {
      // não-editorial: pode começar com "—", "–" ou "-" (em-dash, en-dash, hífen)
      const dashMatch = rest.match(/^[—–-]+/);
      if (dashMatch) {
        rest = rest.slice(dashMatch[0].length);
      }
    }

    rest = rest.trim();

    // Procura data pt-BR no resto. Tudo antes da data (incluindo o dia da data)
    // é streams + dia. Streams é tudo que vem antes do dia da data.
    const dateRe = /(\d{1,2})\s+de\s+([a-zç]{3,})\.?\s+de\s+(\d{4})/i;
    const dateMatch = rest.match(dateRe);

    let streams = 0;
    let added_at: string | null = null;
    let added_at_raw: string | null = null;

    if (dateMatch && typeof dateMatch.index === "number") {
      const beforeDate = rest.slice(0, dateMatch.index);
      streams = parsePtNumber(beforeDate);
      added_at_raw = dateMatch[0];
      added_at = parsePtDate(dateMatch[0]);
    } else {
      streams = parsePtNumber(rest);
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
