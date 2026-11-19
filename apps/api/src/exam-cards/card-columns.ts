/** Geometri kolom kartu login — titik dua digambar di x tetap untuk semua baris. */
export function cardColumns(x: number, cardW: number) {
  const labelX = x + 12;
  const labelW = 74;
  const colonX = labelX + labelW;
  const valueX = colonX + 12;
  const valueW = cardW - labelW - 24;
  return { labelX, labelW, colonX, valueX, valueW };
}
