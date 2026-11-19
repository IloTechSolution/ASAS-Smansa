import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../../lib/api';
import { Card } from '../../components/ui';
import { ErrorBanner, TableWrap, Td, Th } from '../../components/admin';

interface Row {
  id: string;
  createdAt: string;
  type: string;
  attempt?: { user?: { name?: string } | null } | null;
}

const TYPE_LABEL: Record<string, string> = {
  TAB_SWITCH: 'Pindah tab',
  FULLSCREEN_EXIT: 'Keluar fullscreen',
  WINDOW_BLUR: 'Jendela kehilangan fokus',
  COPY_ATTEMPT: 'Percobaan salin',
  PASTE_ATTEMPT: 'Percobaan tempel',
  CONTEXT_MENU: 'Klik kanan',
  SEB_MISSING: 'SEB tidak terdeteksi',
  DEVTOOLS_OPEN: 'DevTools terbuka',
  OTHER: 'Lainnya',
};

export default function IntegrityPanel({ sessionId: sessionIdProp }: { sessionId?: string }) {
  const { sessionId: sessionIdParam } = useParams();
  const sessionId = sessionIdProp || sessionIdParam || '';
  const [data, setData] = useState<Row[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    setError('');
    apiFetch<{ data?: Row[] }>(`/sessions/${sessionId}/integrity`)
      .then((d) => setData(d.data || []))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal memuat log integritas'));
  }, [sessionId]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="flex items-center gap-2 text-xl font-extrabold">
          <ShieldAlert size={20} /> Anti-Cheat / Integritas
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Catatan pelanggaran peserta selama ujian — tersimpan otomatis oleh ruang ujian siswa.
        </p>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <Card>
        {data.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Belum ada catatan pelanggaran di sesi ini.
          </p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Waktu</Th>
                <Th>Tipe</Th>
                <Th>Peserta</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id}>
                  <Td>{new Date(l.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</Td>
                  <Td>{TYPE_LABEL[l.type] ?? l.type}</Td>
                  <Td>{l.attempt?.user?.name ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
