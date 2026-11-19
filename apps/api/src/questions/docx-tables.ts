const KEY_MAP: Record<string, string> = {
  tipe: 'Tipe',
  type: 'Tipe',
  konten: 'Konten',
  content: 'Konten',
  soal: 'Konten',
  pertanyaan: 'Konten',
  'teks soal': 'Konten',
  bobot: 'Bobot',
  weight: 'Bobot',
  nilai: 'Bobot',
  skor: 'Mode Skor',
  'mode skor': 'Mode Skor',
  mode: 'Mode Skor',
  scoringmode: 'Mode Skor',
  pembahasan: 'Pembahasan',
  explanation: 'Pembahasan',
  'kunci pembahasan': 'Pembahasan',
  opsi: 'Opsi',
  choices: 'Opsi',
  pilihan: 'Opsi',
  kunci: 'Kunci',
  jawaban: 'Kunci',
  key: 'Kunci',
  kunciisian: 'KunciIsian',
  'kunci isian': 'KunciIsian',
  'jawaban isian': 'KunciIsian',
  kiri: 'Kiri',
  left: 'Kiri',
  'item kiri': 'Kiri',
  kanan: 'Kanan',
  right: 'Kanan',
  'item kanan': 'Kanan',
  pernyataan: 'Pernyataan',
  statements: 'Pernyataan',
};

export function normalizeDocxKey(k: string): string {
  const t = k.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^jawaban [a-h]$/.test(t)) return 'Opsi';
  return KEY_MAP[t] ?? t;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};

function cellText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li)\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, name: string) => ENTITIES[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function cellsOf(row: string): string[] {
  const cells: string[] = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(row))) cells.push(cellText(m[1] ?? ''));
  return cells;
}

export function parseDocxTables(html: string): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  const tables = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  let index = 0;
  while ((tableMatch = tables.exec(html))) {
    index += 1;
    const rowsHtml = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows: string[][] = [];
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowsHtml.exec(tableMatch[1] ?? ''))) {
      rows.push(cellsOf(rowMatch[1] ?? ''));
    }

    let label = `SOAL ${index}`;
    for (const cells of rows) {
      const one = cells.length === 1 ? (cells[0] ?? '') : '';
      const m = one.match(/^SOAL\s*[:.#-]?\s*(\d+)?/i);
      if (m) label = `SOAL ${m[1] ?? index}`;
    }

    const kv: Record<string, string> = {};
    const choices: Array<{ id: string; label: string }> = [];
    for (const cells of rows) {
      if (cells.length !== 2) continue;
      const rawLabel = cells[0] ?? '';
      const value = cells[1] ?? '';
      if (!rawLabel || !value) continue;
      const choice = rawLabel.match(/^jawaban\s+([a-h])$/i);
      if (choice) {
        choices.push({ id: (choice[1] ?? '').toUpperCase(), label: value });
        continue;
      }
      kv[normalizeDocxKey(rawLabel)] = value;
    }

    if (!kv.Tipe) continue;
    if (choices.length) {
      kv.Opsi = choices.map((c) => `${c.id}|${c.label}`).join(';');
    }
    result.push({ ...kv, __row: label });
  }
  return result;
}
