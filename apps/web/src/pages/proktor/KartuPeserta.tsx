import { useCallback, useEffect, useState } from 'react';
import { IdCard, Printer } from 'lucide-react';
import { apiDownload, apiFetch, ApiError } from '../../lib/api';
import { Badge, Button, Card, TextInput } from '../../components/ui';
import { ErrorBanner, Select, TableWrap, Td, Th } from '../../components/admin';
import { useAuth } from '../../auth/AuthContext';

interface CountInfo {
  total: number;
  kelas: Array<{ id: string; name: string; ruang: string | null; total: number }>;
}

/** Kartu Login universal — berlaku untuk SEMUA ujian; A4 portrait, 8 kartu per halaman (2×4). */
export default function KartuPeserta() {
  const { user } = useAuth();
  const [info, setInfo] = useState<CountInfo | null>(null);
  const [kelasId, setKelasId] = useState('');
  const [judul, setJudul] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Mode agregat (admin tanpa switcher sekolah) — PDF butuh sekolah terpilih.
  const aggregate = user?.role === 'ADMIN' && !(localStorage.getItem('cbt_school_id') ?? '').trim();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [all, filtered] = await Promise.all([
        apiFetch<CountInfo>('/kartu/count'),
        apiFetch<{ total: number }>(`/kartu/count?kelasId=${encodeURIComponent(kelasId)}`),
      ]);
      setInfo(all);
      setCount(filtered.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  }, [kelasId]);

  useEffect(() => {
    void load();
  }, [load]);

  const print = async () => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (kelasId) params.set('kelasId', kelasId);
      if (judul.trim()) params.set('judul', judul.trim());
      const qs = params.toString();
      await apiDownload(`/kartu/pdf${qs ? `?${qs}` : ''}`, kelasId ? 'kartu-login-kelas.pdf' : 'kartu-login-semua.pdf');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mengunduh PDF');
    } finally {
      setBusy(false);
    }
  };

  const pages = count !== null ? Math.ceil(count / 8) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-xl font-extrabold">
              <IdCard size={20} /> Kartu Login
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Satu kartu per siswa — berlaku untuk <b>SELURUH ujian</b>. Berisi logo sekolah (bila ada), QR ke CBT,
              nama, kelas, username/NISN, password awal, ruang ujian, dan tanda tangan kepala sekolah.
              PDF A4 portrait, 8 kartu per halaman.
            </p>
          </div>
          <Badge>{count ?? '…'} kartu</Badge>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      {aggregate ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-300">
          Mode Semua Sekolah — pilih sekolah di kanan atas dulu untuk membuat PDF kartu (tiap sekolah dicetak terpisah).
        </p>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Select label="Kelas" value={kelasId} onChange={(e) => setKelasId(e.target.value)}>
              <option value="">Semua kelas</option>
              {(info?.kelas ?? []).map((k) => (
                <option key={k.id} value={k.id}>{k.name}{k.ruang ? ` · R. ${k.ruang}` : ''}</option>
              ))}
            </Select>
          </div>
          <div className="w-80">
            <TextInput
              label="Judul acara (opsional, 1 baris)"
              value={judul}
              onChange={(e) => setJudul(e.target.value)}
              placeholder="mis. ASSESMEN SUMATIF AKHIR SEMESTER KELAS X"
              maxLength={120}
            />
          </div>
          <Button type="button" variant="gold" onClick={print} disabled={busy || loading || aggregate || (count ?? 0) === 0}>
            <Printer size={16} /> {busy ? 'Menyiapkan PDF…' : `Unduh PDF${pages ? ` (${pages} hal)` : ''}`}
          </Button>
        </div>
        {!loading && count === 0 ? (
          <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-300">
            Belum ada siswa aktif{kelasId ? ' di kelas ini' : ''} — impor siswa dulu agar kartu bisa dicetak.
          </p>
        ) : null}
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
          <li>Password yang dicetak = password awal saat siswa dibuat/diimpor (berlaku sampai siswa mengganti password — bagikan kartu lewat jalur aman).</li>
          <li>Kolom <b>Ruang Ujian</b> diambil dari data <b>siswa</b> (atur di menu Siswa/Pengguna atau kolom Ruang saat impor Excel). Bisa beda ruang walau satu kelas.</li>
          <li>QR pada kartu mengarah ke alamat CBT sekolah (<code>WEB_URL</code>). Tanda tangan &amp; stempel diatur di <b>Konfigurasi</b>.</li>
        </ul>
      </Card>

      {info ? (
        <Card>
          <h2 className="mb-3 font-extrabold">Jumlah siswa per kelas</h2>
          <TableWrap>
            <thead>
              <tr><Th>Kelas</Th><Th>Ruang</Th><Th>Siswa</Th></tr>
            </thead>
            <tbody>
              {info.kelas.map((k) => (
                <tr key={k.id}><Td>{k.name}</Td><Td>{k.ruang ?? '—'}</Td><Td>{k.total}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Total siswa aktif: {info.total}</p>
        </Card>
      ) : null}
    </div>
  );
}
