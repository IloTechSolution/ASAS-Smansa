import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiUpload, ApiError } from '../../lib/api';
import { Button } from '../../components/ui';
import { Modal } from '../../components/admin';

export interface ImportResult {
  total: number;
  success: Array<{ row: number; username: string }>;
  failed: Array<{ row: number; username: string; error: string }>;
  ruangUpdates?: number;
  siswaRuangUpdates?: number;
}

interface Props {
  close: () => void;
  result: ImportResult | null;
  setResult: (r: ImportResult | null) => void;
  setError: (m: string) => void;
  reload: () => void;
}

export function UserImportModal({ close, result, setResult, setError, reload }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

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
      const res = await apiUpload<ImportResult>('/users/import', formData);
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
    <Modal title="Import pengguna (Excel)" onClose={close} wide>
      <form onSubmit={onImport} className="flex flex-col gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Kolom: Username | Password | Nama | Role (ADMIN/GURU/SISWA/PROKTOR) | NISN | Kelas (nama kelas).
          Untuk siswa, NISN boleh dikosongkan bila username sudah 10 digit.
        </p>
        <input
          type="file"
          accept=".xlsx,.xls"
          className="input-base"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button type="submit" disabled={busy || !file}>{busy ? 'Mengimpor…' : 'Impor'}</Button>
      </form>
      {result ? (
        <div className="mt-4 text-sm">
          <p className="font-bold">
            Hasil: {result.success.length} berhasil, {result.failed.length} gagal (dari {result.total})
          </p>
          {result.siswaRuangUpdates ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {result.siswaRuangUpdates} ruang siswa diperbarui dari kolom Ruang.
            </p>
          ) : null}
          {result.failed.length > 0 ? (
            <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
              {result.failed.map((f) => (
                <li key={f.row} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-red-500">
                  Baris {f.row} ({f.username}): {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
