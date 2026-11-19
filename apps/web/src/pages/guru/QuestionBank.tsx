import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { QuestionType } from '@cbt/shared';
import { QUESTION_TYPES, QUESTION_TYPE_LABEL } from '@cbt/shared';
import { apiDownload, apiFetch, ApiError } from '../../lib/api';
import type { Paged } from '../../lib/api';
import { Badge, Button, Card, TextInput } from '../../components/ui';
import { ErrorBanner, Pagination, Select, TableWrap, Td, Th } from '../../components/admin';
import { QuestionImportModal } from './QuestionImportModal';
import type { QuestionImportResult } from './QuestionImportModal';
import { QuestionPreview } from './QuestionPreview';
import type { PreviewData } from './QuestionPreview';

interface Row {
  id: string;
  type: QuestionType;
  content: string;
  weight: number;
  imageUrl: string | null;
  updatedAt: string;
  createdBy: { name: string };
  _count: { examLinks: number };
}

export function QuestionBank() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [savedFlash, setSavedFlash] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState<QuestionImportResult | null>(null);

  // Banner "Soal tersimpan" setelah redirect dari halaman simpan soal.
  useEffect(() => {
    const saved = (location.state as { saved?: string } | null)?.saved;
    if (saved) {
      setSavedFlash(`Soal berhasil ${saved === 'diubah' ? 'diubah' : 'dibuat'} dan tersimpan di bank soal.`);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  const limit = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (q.trim()) params.set('search', q.trim());
      if (typeF) params.set('type', typeF);
      const res = await apiFetch<Paged<Row>>(`/questions?${params}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat soal');
    } finally {
      setLoading(false);
    }
  }, [page, q, typeF]);

  useEffect(() => {
    load();
  }, [load]);

  async function onPreview(id: string) {
    setError('');
    try {
      setPreview(await apiFetch<PreviewData>(`/questions/${id}/preview`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal membuka pratinjau');
    }
  }

  async function onDuplicate(id: string) {
    setError('');
    try {
      await apiFetch(`/questions/${id}/duplicate`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menduplikasi');
    }
  }

  async function onExportCsv() {
    setError('');
    try {
      await apiDownload('/questions/export', 'bank-soal.csv');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mengekspor CSV');
    }
  }

  async function onDelete(r: Row) {
    if (!window.confirm('Hapus soal ini?')) return;
    setError('');
    try {
      await apiFetch(`/questions/${r.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menghapus soal');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-extrabold">Bank Soal</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">5 jenis soal + gambar + bobot.</p>
          </div>
          <Button type="button" variant="ghost" onClick={() => setShowImport(true)}>Impor Soal</Button>
          <Button type="button" variant="ghost" onClick={onExportCsv}>Export CSV</Button>
          <Link to="/app/guru/soal/baru"><Button type="button">+ Soal</Button></Link>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />
      {savedFlash ? (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-300" role="status">
          {savedFlash}
          <button type="button" className="ml-3 font-bold underline" onClick={() => setSavedFlash('')}>Tutup</button>
        </p>
      ) : null}

      <Card>
        <form
          className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(search);
          }}
        >
          <TextInput label="Cari" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Teks soal…" />
          <Select label="Jenis" value={typeF} onChange={(e) => { setTypeF(e.target.value); setPage(1); }}>
            <option value="">Semua</option>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button type="submit" className="w-full">Cari</Button>
          </div>
        </form>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Belum ada soal. Buat yang pertama!</p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Soal</Th>
                  <Th>Jenis</Th>
                  <Th>Bobot</Th>
                  <Th>Ujian</Th>
                  <Th>Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td><p className="max-w-md truncate font-medium">{r.content}</p></Td>
                    <Td><Badge>{QUESTION_TYPE_LABEL[r.type]}</Badge></Td>
                    <Td>{r.weight}</Td>
                    <Td>{r._count.examLinks}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" variant="ghost" onClick={() => onPreview(r.id)}>Pratinjau</Button>
                        <Link to={`/app/guru/soal/${r.id}/ubah`}><Button type="button" variant="ghost">Ubah</Button></Link>
                        <Button type="button" variant="ghost" onClick={() => onDuplicate(r.id)}>Duplikat</Button>
                        <Button type="button" variant="danger" onClick={() => onDelete(r)}>Hapus</Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="mt-3">
              <Pagination page={page} limit={limit} total={total} onPage={setPage} />
            </div>
          </>
        )}
      </Card>

      {showImport ? (
        <QuestionImportModal
          close={() => setShowImport(false)}
          result={importResult}
          setResult={setImportResult}
          setError={setError}
          reload={load}
        />
      ) : null}

      {preview ? <QuestionPreview q={preview} close={() => setPreview(null)} /> : null}
    </div>
  );
}
