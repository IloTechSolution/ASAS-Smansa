import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiDownload, apiUpload, ApiError } from '../../lib/api';
import { Button } from '../../components/ui';
import { Modal } from '../../components/admin';

export interface QuestionImportResult {
  total: number;
  success: Array<{ row: number; id: string }>;
  failed: Array<{ row: number; error: string }>;
}

interface Props {
  close: () => void;
  result: QuestionImportResult | null;
  setResult: (r: QuestionImportResult | null) => void;
  setError: (m: string) => void;
  reload: () => void;
}

export function QuestionImportModal({ close, result, setResult, setError, reload }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function downloadTemplate() {
    try {
      await apiDownload('/questions/import/template', 'template-import-soal.xlsx');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengunduh template');
    }
  }

  async function downloadDocxTemplate() {
    try {
      await apiDownload('/questions/import/template-docx', 'template-import-soal.docx');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengunduh template Word');
    }
  }

  async function onImport(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Pilih file Excel dulu');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiUpload<QuestionImportResult>('/questions/import', formData);
      setResult(res);
      setFile(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import gagal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import soal" onClose={close} wide>
      <form onSubmit={onImport} className="flex flex-col gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Dua format didukung — Excel (<b>.xlsx</b>) dan Word (<b>.docx</b>). Isi sesuai contoh pada template,
          lalu unggah berkasnya. Baris yang salah dilaporkan; sisanya tetap masuk.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Contoh isi: <b>SOAL 1</b> lalu <b>Tipe:</b> PG · <b>Konten:</b> pertanyaan · <b>Opsi:</b> A|Jawaban 1;B|Jawaban 2 ·
          <b> Kunci:</b> A. Tipe lain: MATCHING (Kiri/Kanan), BENAR_SALAH (Pernyataan "teks|B/S"), ISIAN_SINGKAT (KunciIsian "jwb1,jwb2").
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">Maksimal 500 soal per impor. Gambar diisi manual setelah soal tersimpan.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={downloadTemplate}>
            Unduh template Excel
          </Button>
          <Button type="button" variant="ghost" onClick={downloadDocxTemplate}>
            Unduh template Word
          </Button>
        </div>
        <input
          type="file"
          accept=".xlsx,.xls,.docx"
          className="input-base"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button type="submit" disabled={busy || !file}>
          {busy ? 'Mengimpor…' : 'Impor'}
        </Button>
      </form>
      {result ? (
        <div className="mt-4 text-sm">
          <p className="font-bold">
            Hasil: {result.success.length} berhasil, {result.failed.length} gagal (dari {result.total})
          </p>
          {result.failed.length > 0 ? (
            <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
              {result.failed.map((f) => (
                <li key={f.row} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-red-500">
                  Baris {f.row}: {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
