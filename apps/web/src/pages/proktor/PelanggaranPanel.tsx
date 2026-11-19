import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { Badge, Button, Card } from '../../components/ui';
import { ErrorBanner, Select, TableWrap, Td, Th } from '../../components/admin';
import { ApiError, apiFetch } from '../../lib/api';

interface ViolationRow {
  id: string;
  type: string;
  createdAt: string;
  attempt: {
    id: string;
    violationCount: number;
    status: string;
    user: { name: string; username: string; nisn: string | null; kelas: { name: string } | null };
    session: { id: string; title: string | null; status: string; exam: { title: string } };
  };
}

interface GlobalData {
  count: number;
  limit: number;
  byType: Record<string, number>;
  sessions: Array<{ id: string; title: string | null; status: string; exam: { title: string } }>;
  data: ViolationRow[];
}

const TYPE_LABEL: Record<string, string> = {
  TAB_SWITCH: 'Pindah tab',
  FULLSCREEN_EXIT: 'Keluar fullscreen',
  WINDOW_BLUR: 'Jendela hilang fokus',
  COPY_ATTEMPT: 'Percobaan salin',
  PASTE_ATTEMPT: 'Percobaan tempel',
  CONTEXT_MENU: 'Klik kanan',
  SEB_MISSING: 'SEB tidak terdeteksi',
  DEVTOOLS_OPEN: 'DevTools terbuka',
  OTHER: 'Lainnya',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draf',
  SCHEDULED: 'Terjadwal',
  ACTIVE: 'Aktif',
  CLOSED: 'Ditutup',
};

/** Panel monitoring pelanggaran lintas sesi — ADMIN & PROKTOR (sidebar sendiri). */
export default function PelanggaranPanel() {
  const [sessionId, setSessionId] = useState('');
  const [data, setData] = useState<GlobalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}&limit=100` : '?limit=100';
      setData(await apiFetch<GlobalData>(`/integrity${qs}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat monitoring pelanggaran');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const topTypes = Object.entries(data?.byType ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-amber-500/30">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-xl font-extrabold">
              <ShieldAlert size={20} className="text-amber-500" /> Monitoring Pelanggaran
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Semua log pelanggaran (tab switch, fullscreen, devtools, dst) lintas sesi — terbaru di atas.
            </p>
          </div>
          <div className="w-48">
            <Select label="Sesi" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <option value="">Semua sesi</option>
              {(data?.sessions ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title ?? s.exam.title}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="ghost" type="button" onClick={() => void load()} disabled={loading} title="Muat ulang">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Muat ulang
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{data?.count ?? 0} catatan</Badge>
          {topTypes.slice(0, 5).map(([type, count]) => (
            <Badge key={type} className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {TYPE_LABEL[type] ?? type}: {count}
            </Badge>
          ))}
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <Card>
        {loading && !data ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Memuat…</p>
        ) : data && data.data.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Belum ada pelanggaran tercatat{sessionId ? ' di sesi ini' : ''}.
          </p>
        ) : data ? (
          <TableWrap>
            <thead>
              <tr>
                <Th>Waktu</Th>
                <Th>Peserta</Th>
                <Th>Sesi</Th>
                <Th>Pelanggaran</Th>
                <Th>Tipe</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((l) => (
                <tr key={l.id}>
                  <Td>{new Date(l.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' })}</Td>
                  <Td>
                    <span className="font-semibold">{l.attempt.user.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {l.attempt.user.nisn ?? l.attempt.user.username}
                      {l.attempt.user.kelas?.name ? ` · ${l.attempt.user.kelas.name}` : ''}
                    </span>
                  </Td>
                  <Td>
                    <span className="block max-w-56 truncate" title={l.attempt.session.exam.title}>
                      {l.attempt.session.title ?? l.attempt.session.exam.title}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {STATUS_LABEL[l.attempt.session.status] ?? l.attempt.session.status}
                    </span>
                  </Td>
                  <Td>{l.attempt.violationCount}</Td>
                  <Td>{TYPE_LABEL[l.type] ?? l.type}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : null}
      </Card>
    </div>
  );
}
