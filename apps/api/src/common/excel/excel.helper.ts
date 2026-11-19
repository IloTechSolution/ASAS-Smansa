import * as ExcelJS from 'exceljs';

/**
 * Cegah formula injection di Excel: nilai teks yang diawali =, +, -, @
 * dieksekusi sebagai rumus saat dibuka. Input berasal dari pengguna,
 * jadi harus diperlakukan sebagai teks.
 */
export function safeCell(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v.trimStart()) ? `'${v}` : v;
}

function cellToText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('');
    }
    if ('result' in o) return String(o.result ?? '');
    if (typeof o.text === 'string') return o.text;
    if (typeof o.hyperlink === 'string') return o.hyperlink;
    if ('error' in o) return '';
    return '';
  }
  return String(v);
}

/**
 * Baca sheet pertama menjadi array objek memakai baris 1 sebagai header.
 * Nilai dikembalikan string (trim), sel kosong = ''. Baris yang seluruhnya
 * kosong dilewati. Mengembalikan null bila sheet tidak ada.
 */
export async function readFirstSheet(buffer: Buffer): Promise<Array<Record<string, string>> | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const ws = wb.worksheets[0];
  if (!ws) return null;
  const headerRow = ws.getRow(1);
  const colCount = Math.max(headerRow.cellCount, 1);
  const headers: string[] = [];
  for (let c = 1; c <= colCount; c++) {
    headers[c - 1] = cellToText(headerRow.getCell(c)).trim();
  }
  const rows: Array<Record<string, string>> = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let hasValue = false;
    for (let c = 1; c <= headers.length; c++) {
      const key = headers[c - 1];
      const v = cellToText(row.getCell(c)).trim();
      obj[key || `col${c}`] = v;
      if (v) hasValue = true;
    }
    if (hasValue) rows.push(obj);
  });
  return rows;
}

export interface SheetInput {
  name: string;
  header?: unknown[];
  rows: unknown[][];
  widths?: number[];
}

/** Tulis workbook .xlsx dengan sanitasi formula injection di semua sel. */
export async function writeWorkbook(sheets: SheetInput[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CBT SMAN 1 Gorontalo';
  wb.created = new Date();
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name);
    const allRows = spec.header ? [spec.header, ...spec.rows] : spec.rows;
    if (spec.header) ws.addRow(spec.header.map(safeCell));
    for (const r of spec.rows) ws.addRow(r.map(safeCell));
    if (spec.widths) {
      ws.columns = spec.widths.map((w) => ({ width: w }));
    } else {
      const colCount = allRows.reduce((m, r) => Math.max(m, r.length), 0);
      for (let c = 1; c <= colCount; c++) {
        let maxLen = 10;
        for (const r of allRows) {
          const len = String(r[c - 1] ?? '').length;
          if (len > maxLen) maxLen = len;
        }
        ws.getColumn(c).width = Math.min(maxLen + 2, 60);
      }
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as unknown as ArrayBuffer);
}
