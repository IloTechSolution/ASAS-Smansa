import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../../../lib/api';
import type { Paged } from '../../../lib/api';
import { Button, Card, TextInput } from '../../../components/ui';
import { ErrorBanner, Modal, Pagination, Select, TableWrap, Td, Th } from '../../../components/admin';
import { JadwalUjian } from './JadwalUjian';

interface ExamRow {
  id: string;
  title: string;
  mapel: { id: string; name: string };
  _count: { sessions: number; questions: number };
}

interface MapelOpt {
  id: string;
  name: string;
}

export function ExamList() {
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [mapelId, setMapelId] = useState('');
  const [mapels, setMapels] = useState<MapelOpt[]>([]);
  const [busy, setBusy] = useState(false);

  const limit = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (q.trim()) params.set('search', q.trim());
      const res = await apiFetch<Paged<ExamRow>>(`/exams?${params}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat ujian');
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<MapelOpt[]>('/mapel').then(setMapels).catch(() => undefined);
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiFetch('/exams', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), description: desc.trim() || null, mapelId }),
      });
      setModal(false);
      setTitle('');
      setDesc('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat ujian');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(r: ExamRow) {
    if (!window.confirm(`Hapus ujian "${r.title}"?`)) return;
    setError('');
    try {
      await apiFetch(`/exams/${r.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus ujian');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-extrabold">Ujian Saya</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Buat ujian, susun soal, lalu jadwalkan sesi.</p>
          </div>
          <Button type="button" onClick={() => setModal(true)}>+ Ujian</Button>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <JadwalUjian />

      <Card>
        <form
          className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(search);
          }}
        >
          <TextInput label="Cari" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Judul ujian…" />
          <div className="flex items-end">
            <Button type="submit" className="w-full">Cari</Button>
          </div>
        </form>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Belum ada ujian.</p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Judul</Th>
                  <Th>Mapel</Th>
                  <Th>Soal</Th>
                  <Th>Sesi</Th>
                  <Th>Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td><p className="font-bold">{r.title}</p></Td>
                    <Td>{r.mapel.name}</Td>
                    <Td>{r._count.questions}</Td>
                    <Td>{r._count.sessions}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <Link to={`/app/guru/ujian/${r.id}`}><Button type="button" variant="ghost">Susun</Button></Link>
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

      {modal ? (
        <Modal title="Ujian baru" onClose={() => setModal(false)}>
          <form onSubmit={onCreate} className="flex flex-col gap-3">
            <TextInput label="Judul" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="cth. UTS Ganjil" />
            <TextInput label="Deskripsi (opsional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <Select label="Mapel" value={mapelId} onChange={(e) => setMapelId(e.target.value)}>
              <option value="">— Pilih mapel —</option>
              {mapels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
            <Button type="submit" disabled={busy || !mapelId}>{busy ? 'Menyimpan…' : 'Buat'}</Button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
