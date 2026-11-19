import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Badge, Card } from '../../../components/ui';
import { ErrorBanner, TableWrap, Td, Th } from '../../../components/admin';

type DayName = 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT';

interface SessionRow {
  id: string;
  title: string | null;
  status: 'SCHEDULED' | 'ACTIVE' | 'CLOSED' | 'DRAFT';
  hariPelaksanaan: DayName | null;
  visibleToSiswa: boolean;
  exam: { id: string; title: string; mapel?: { name: string } | null };
  kelasLinks: Array<{ kelas: { id: string; name: string } }>;
}

const DAYS: Array<{ value: DayName; label: string; chip: string }> = [
  { value: 'SENIN', label: 'Hari 1 · Senin', chip: 'Sen' },
  { value: 'SELASA', label: 'Hari 2 · Selasa', chip: 'Sel' },
  { value: 'RABU', label: 'Hari 3 · Rabu', chip: 'Rab' },
  { value: 'KAMIS', label: 'Hari 4 · Kamis', chip: 'Kam' },
  { value: 'JUMAT', label: 'Hari 5 · Jumat', chip: 'Jum' },
];
const DAY_LABEL: Record<DayName, string> = {
  SENIN: 'Hari 1 · Senin',
  SELASA: 'Hari 2 · Selasa',
  RABU: 'Hari 3 · Rabu',
  KAMIS: 'Hari 4 · Kamis',
  JUMAT: 'Hari 5 · Jumat',
};

/** Daftar ujian per hari pelaksanaan (Hari 1–5 / Senin–Jumat). */
export function JadwalUjian() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [day, setDay] = useState<'' | DayName>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = day ? `?hari=${day}&limit=100` : '?limit=100';
    apiFetch<{ data: SessionRow[] }>(`/sessions${qs}`)
      .then((r) => setRows(r.data.filter((s) => s.visibleToSiswa || s.status === 'ACTIVE')))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Gagal memuat jadwal'))
      .finally(() => setLoading(false));
  }, [day]);

  const byDay = new Map<DayName, SessionRow[]>();
  for (const r of rows) {
    const key = r.hariPelaksanaan ?? 'SENIN';
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="flex items-center gap-2 font-extrabold">
            <CalendarClock size={18} /> Hari Ujian
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Ujian yang tampil ke siswa, dikelompokkan per hari pelaksanaan.</p>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setDay('')}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${day === '' ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          Semua
        </button>
        {DAYS.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => setDay(day === d.value ? '' : d.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${day === d.value ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'}`}
            title={d.label}
          >
            {d.label}
          </button>
        ))}
      </div>
      <ErrorBanner message={error} onClose={() => setError('')} />
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-500">Memuat…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Belum ada ujian pada hari ini. Tampilkan sesi ke siswa dari panel pelaksanaan.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {[...byDay.entries()].map(([d, list]) => (
            <div key={d}>
              <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {DAY_LABEL[d]} <span className="font-medium normal-case">({list.length} ujian)</span>
              </p>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Ujian</Th>
                    <Th>Mapel</Th>
                    <Th>Kelas</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <Td><span className="font-medium">{r.title ?? r.exam.title}</span></Td>
                      <Td>{r.exam.mapel?.name ?? '—'}</Td>
                      <Td>{r.kelasLinks.map((k) => k.kelas.name).join(', ') || '—'}</Td>
                      <Td>
                        {r.visibleToSiswa ? <Badge className="border-emerald-500/40 text-emerald-600 dark:text-emerald-300">Tampil</Badge> : <Badge>{r.status}</Badge>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
