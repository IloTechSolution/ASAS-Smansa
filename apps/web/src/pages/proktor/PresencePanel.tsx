import { useCallback, useEffect, useMemo, useState } from 'react';
import { Radio, RefreshCw, Search } from 'lucide-react';
import { Badge, Button, Card } from '../../components/ui';
import { ErrorBanner, Select, TableWrap, Td, Th } from '../../components/admin';
import { ApiError, apiFetch } from '../../lib/api';

interface PresenceRow {
  id: string;
  name: string;
  username: string;
  nisn: string | null;
  kelas: { name: string } | null;
  lastSeenAt: string;
  online: boolean;
  inExam: { sessionId: string; title: string } | null;
}

interface PresenceResponse {
  serverTime: string;
  onlineCount: number;
  inExamCount: number;
  recentCount: number;
  data: PresenceRow[];
}

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return 'baru saja';
  if (sec < 60) return `${sec} dtk lalu`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} mnt lalu`;
  const hour = Math.floor(min / 60);
  return `${hour} jam lalu`;
}

/** Panel kehadiran realtime siswa — siapa yang sedang online/aktif. ADMIN & PROKTOR. */
export default function PresencePanel() {
  const [data, setData] = useState<PresenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kelas, setKelas] = useState('');
  const [showRecent, setShowRecent] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const qs = showRecent ? '' : '?recent=false';
      setData(await apiFetch<PresenceResponse>(`/presence/siswa${qs}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat presence siswa');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showRecent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  const kelasOptions = useMemo(
    () => [...new Set((data?.data ?? []).map((r) => r.kelas?.name).filter((v): v is string => Boolean(v)))].sort(),
    [data],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.data ?? []).filter((r) => {
      if (kelas && r.kelas?.name !== kelas) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        (r.nisn ?? '').includes(q)
      );
    });
  }, [data, query, kelas]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-brand-500/30">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-extrabold">
              <Radio size={20} className="text-brand-500" /> Siswa Online
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
              </span>
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Presence realtime siswa yang membuka aplikasi / ruang ujian — diperbarui otomatis tiap 10 detik.
            </p>
          </div>
          <Button variant="ghost" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Segarkan
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-emerald-500/10 py-2">
            <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-300">{data?.onlineCount ?? 0}</div>
            <div className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">Online sekarang</div>
          </div>
          <div className="rounded-xl bg-amber-500/10 py-2">
            <div className="text-lg font-extrabold text-amber-600 dark:text-amber-300">{data?.inExamCount ?? 0}</div>
            <div className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">Di ruang ujian</div>
          </div>
          <div className="rounded-xl bg-slate-500/10 py-2">
            <div className="text-lg font-extrabold text-slate-500 dark:text-slate-400">{data?.recentCount ?? 0}</div>
            <div className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">Baru keluar (≤15 mnt)</div>
          </div>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="kehadiran-search" className="mb-1.5 block text-sm font-semibold">Cari</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="kehadiran-search"
                className="input-base pl-9"
                placeholder="Nama / username / NISN…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <Select label="Kelas" value={kelas} onChange={(e) => setKelas(e.target.value)}>
            <option value="">Semua kelas</option>
            {kelasOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
          <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={showRecent} onChange={(e) => setShowRecent(e.target.checked)} />
            Sertakan yang baru keluar
          </label>
        </div>
      </Card>

      {loading ? (
        <Card className="text-center text-sm text-slate-500">Memuat kehadiran…</Card>
      ) : rows.length === 0 ? (
        <Card className="text-center text-sm text-slate-500 dark:text-slate-400">
          {data && data.data.length === 0
            ? 'Belum ada siswa yang terdeteksi online. Presence terbaca saat siswa membuka aplikasi atau ruang ujian.'
            : 'Tidak ada data yang cocok dengan filter.'}
        </Card>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Peserta</Th>
              <Th>NISN</Th>
              <Th>Kelas</Th>
              <Th>Status</Th>
              <Th>Terakhir aktif</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id} className={row.online ? undefined : 'opacity-60'}>
                <Td className="text-xs text-slate-400">{i + 1}</Td>
                <Td>
                  <div className="min-w-0">
                    <p className="font-bold leading-tight">{row.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{row.username}</p>
                  </div>
                </Td>
                <Td className="font-mono text-xs">{row.nisn ?? '-'}</Td>
                <Td>{row.kelas?.name ?? '-'}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.online ? (
                      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                        ONLINE
                      </Badge>
                    ) : (
                      <Badge className="border-slate-400/40 text-slate-500 dark:text-slate-400">
                        OFFLINE
                      </Badge>
                    )}
                    {row.inExam ? (
                      <span title={row.inExam.title}>
                        <Badge className="max-w-48 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                          DI UJIAN
                        </Badge>
                      </span>
                    ) : null}
                  </div>
                </Td>
                <Td className="text-xs text-slate-500 dark:text-slate-400">{timeAgo(row.lastSeenAt)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <p className="text-center text-[11px] text-slate-400">
        Presence realtime dari aktivitas siswa (bukan data login database). Tidak merekam isi jawaban atau aktivitas klik.
      </p>
    </div>
  );
}
