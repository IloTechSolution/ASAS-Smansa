import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ApiError, apiDownload, apiFetch } from '../../lib/api';
import { Badge, Button, Card } from '../../components/ui';
import { ErrorBanner, TableWrap, Td, Th } from '../../components/admin';

interface Row {
  user: { id: string; name: string; nisn: string | null; kelas?: { name: string } | null };
  attendance: { status: string } | null;
}

const OPTIONS = ['HADIR', 'TERLAMBAT', 'IZIN', 'SAKIT', 'ALPA'] as const;

export default function AttendancePanel({ sessionId: sessionIdProp }: { sessionId?: string }) {
  const { sessionId: sessionIdParam } = useParams();
  const sessionId = sessionIdProp || sessionIdParam || '';
  const [items, setItems] = useState<Row[]>([]);
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setError('');
    apiFetch<{ data: Row[] }>(`/sessions/${sessionId}/attendance`)
      .then((d) => {
        setItems(d.data || []);
        const map: Record<string, string> = {};
        for (const row of d.data || []) map[row.user.id] = row.attendance?.status || '';
        setStatusById(map);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal memuat absensi'));
  }, [sessionId]);

  const marked = items.filter((i) => statusById[i.user.id]).length;

  const downloadPdf = () => {
    setPdfBusy(true);
    setError('');
    apiDownload(`/sessions/${sessionId}/export/absensi/pdf`, `absensi-${sessionId}.pdf`)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal mengunduh PDF'))
      .finally(() => setPdfBusy(false));
  };

  const save = () => {
    // Kirim SEMUA baris: status terpilih = set, "Belum" = kosongkan
    // (server menghapus baris absensi) agar salah tanda bisa diperbaiki.
    const payload = items.map((i) => ({ userId: i.user.id, status: statusById[i.user.id] || 'BELUM' }));
    setError('');
    setSaved('');
    if (payload.length === 0) {
      setError('Tidak ada peserta di sesi ini.');
      return;
    }
    setSaving(true);
    apiFetch(`/sessions/${sessionId}/attendance`, {
      method: 'PUT',
      body: JSON.stringify({ items: payload }),
    })
      .then(() => {
        setSaved(`Absensi tersimpan: ${marked} peserta ditandai, ${payload.length - marked} dikosongkan.`);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal menyimpan absensi'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="flex items-center gap-2 text-xl font-extrabold">
              <ClipboardList size={20} /> Absensi Sesi
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Tandai kehadiran peserta. Memilih “— Belum —” menghapus tanda yang sudah tersimpan.
            </p>
          </div>
          <Badge>{marked}/{items.length} ditandai</Badge>
          <Button onClick={save} disabled={saving || items.length === 0}>{saving ? 'Menyimpan…' : 'Simpan absensi'}</Button>
          <Button variant="ghost" onClick={downloadPdf} disabled={pdfBusy}>{pdfBusy ? 'Menyiapkan…' : 'Absensi PDF'}</Button>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />
      {saved ? (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-300">
          {saved}
        </p>
      ) : null}

      <Card>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Belum ada peserta di sesi ini.
          </p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Nama</Th>
                <Th>NISN</Th>
                <Th>Kelas</Th>
                <Th>Absensi</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.user.id}>
                  <Td><p className="font-semibold">{i.user.name}</p></Td>
                  <Td>{i.user.nisn ?? '—'}</Td>
                  <Td>{i.user.kelas?.name ?? '—'}</Td>
                  <Td>
                    <select
                      value={statusById[i.user.id] || ''}
                      onChange={(e) => setStatusById((prev) => ({ ...prev, [i.user.id]: e.target.value }))}
                      className="input-base w-36"
                      aria-label={`Absensi ${i.user.name}`}
                    >
                      <option value="">— Belum —</option>
                      {OPTIONS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
