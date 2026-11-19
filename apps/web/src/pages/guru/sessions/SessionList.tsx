import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../../../lib/api';
import type { Paged } from '../../../lib/api';
import { Badge, Button, Card, TextInput } from '../../../components/ui';
import { ErrorBanner, Pagination, Select, TableWrap, Td, Th } from '../../../components/admin';

type DayName = 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT';

interface SessionRow {
  id: string;
  title: string | null;
  status: string;
  hariPelaksanaan: DayName | null;
  visibleToSiswa: boolean;
  durationMin: number;
  exam: { id: string; title: string };
  kelasLinks: Array<{ kelas: { name: string } }>;
  _count: { attempts: number };
}

const DAYS: Array<{ value: DayName; short: string; label: string }> = [
  { value: 'SENIN', short: 'Sen', label: 'Hari 1 · Senin' },
  { value: 'SELASA', short: 'Sel', label: 'Hari 2 · Selasa' },
  { value: 'RABU', short: 'Rab', label: 'Hari 3 · Rabu' },
  { value: 'KAMIS', short: 'Kam', label: 'Hari 4 · Kamis' },
  { value: 'JUMAT', short: 'Jum', label: 'Hari 5 · Jumat' },
];
const DAY_LABEL: Record<DayName, string> = {
  SENIN: 'Hari 1 · Senin',
  SELASA: 'Hari 2 · Selasa',
  RABU: 'Hari 3 · Rabu',
  KAMIS: 'Hari 4 · Kamis',
  JUMAT: 'Hari 5 · Jumat',
};

export function SessionList() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [dayF, setDayF] = useState<'' | DayName>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const limit = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (q.trim()) params.set('search', q.trim());
      if (dayF) params.set('hari', dayF);
      const res = await apiFetch<Paged<SessionRow>>(`/sessions?${params}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat sesi');
    } finally {
      setLoading(false);
    }
  }, [page, q, dayF]);

  useEffect(() => {
    load();
  }, [load]);

  async function onDelete(r: SessionRow) {
    if (!window.confirm(`Hapus permanen sesi "${r.title ?? r.exam.title}"? Sesi beserta seluruh attempt, nilai, dan absensi akan ikut terhapus.`)) return;
    setError('');
    try {
      await apiFetch(`/sessions/${r.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus sesi');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-extrabold">Sesi Ujian</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Hari pelaksanaan & kelas peserta. Tampilkan/sembunyikan ujian ke siswa dari panel pelaksanaan.</p>
          </div>
          <Link to="/app/guru/sesi/baru"><Button type="button">+ Sesi</Button></Link>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <Card>
        <form
          className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(search);
          }}
        >
          <TextInput label="Cari" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Judul sesi/ujian…" />
          <Select label="Hari" value={dayF} onChange={(e) => { setDayF(e.target.value as typeof dayF); setPage(1); }}>
            <option value="">Semua hari</option>
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button type="submit" className="w-full">Cari</Button>
          </div>
        </form>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => { setDayF(''); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${dayF === '' ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'}`}>Semua</button>
          {DAYS.map((d) => (
            <button key={d.value} type="button" onClick={() => { setDayF(dayF === d.value ? '' : d.value); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${dayF === d.value ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'}`} title={d.label}>{d.short}</button>
          ))}
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Belum ada sesi.</p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Sesi / Ujian</Th>
                  <Th>Hari</Th>
                  <Th>Tampil siswa</Th>
                  <Th>Kelas</Th>
                  <Th>Peserta</Th>
                  <Th>Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <p className="font-bold">{r.title || '(tanpa judul)'}</p>
                      <p className="text-xs text-slate-500">{r.exam.title} · {r.durationMin} mnt</p>
                    </Td>
                    <Td>{r.hariPelaksanaan ? DAY_LABEL[r.hariPelaksanaan] : '—'}</Td>
                    <Td>
                      {r.visibleToSiswa
                        ? <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">Tampil</Badge>
                        : <Badge>Tersembunyi</Badge>}
                    </Td>
                    <Td>{r.kelasLinks.map((k) => k.kelas.name).join(', ') || '—'}</Td>
                    <Td>{r._count.attempts}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Link to={`/app/proktor/sesi/${r.id}/pengaturan`}><Button type="button" variant="ghost">Kelola</Button></Link>
                        <Link to={`/app/guru/sesi/${r.id}/penilaian`}><Button type="button" variant="ghost">Nilai</Button></Link>
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
    </div>
  );
}
