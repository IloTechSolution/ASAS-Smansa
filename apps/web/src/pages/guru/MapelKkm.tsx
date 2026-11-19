import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import { Card } from '../../components/ui';
import { ErrorBanner, TableWrap, Td, Th } from '../../components/admin';
import { KkmField } from '../../components/KkmField';

interface MapelRow {
  id: string;
  name: string;
  code: string | null;
  kkm: number;
}

/**
 * KKM per mata pelajaran — diatur oleh guru mapel.
 * Dipakai untuk ketuntasan pada hasil ujian & ekspor Excel nilai.
 */
export function GuruMapelKkm() {
  const [rows, setRows] = useState<MapelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await apiFetch<MapelRow[]>('/mapel'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat mapel');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-xl font-extrabold">KKM Mata Pelajaran</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Kriteria Ketuntasan Minimal per mapel — ditentukan guru mata pelajaran.
          Nilai ketuntasan tampil di papan penilaian & ekspor Excel nilai.
        </p>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <Card>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Belum ada mapel — minta admin membuatnya dulu.</p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Mata Pelajaran</Th>
                <Th>Kode</Th>
                <Th>KKM (0–100)</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <Td><p className="font-bold">{m.name}</p></Td>
                  <Td>{m.code ?? '—'}</Td>
                  <Td><KkmField mapelId={m.id} kkm={m.kkm} onSaved={load} /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
