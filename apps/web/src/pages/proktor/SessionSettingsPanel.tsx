import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { SlidersHorizontal, AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, TextInput } from '../../components/ui';
import { ErrorBanner, Select } from '../../components/admin';
import { ApiError, apiFetch } from '../../lib/api';

type DayName = 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT';

interface KelasOpt {
  id: string;
  name: string;
}

interface SessionDetail {
  id: string;
  title: string | null;
  status: string;
  hariPelaksanaan: DayName | null;
  visibleToSiswa: boolean;
  durationMin: number;
  tokenIntervalSec: number;
  maxViolations: number;
  requireSeb: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  exam: { id: string; title: string };
  kelasLinks: Array<{ kelas: { id: string; name: string } }>;
  questionCount: number;
  _count?: { attempts: number };
}

const DAY_OPTIONS: Array<{ value: DayName; label: string }> = [
  { value: 'SENIN', label: 'Hari 1 · Senin' },
  { value: 'SELASA', label: 'Hari 2 · Selasa' },
  { value: 'RABU', label: 'Hari 3 · Rabu' },
  { value: 'KAMIS', label: 'Hari 4 · Kamis' },
  { value: 'JUMAT', label: 'Hari 5 · Jumat' },
];

/**
 * Pengaturan pelaksanaan ujian — dipakai panel proktor (ADMIN juga boleh).
 * Hari pelaksanaan, durasi, aturan ujian, kelas peserta, dan aksi darurat
 * "Tutup & kumpul paksa". Tampilkan/sembunyikan ke siswa ada di header panel.
 */
export default function SessionSettingsPanel({ sessionId }: { sessionId: string }) {
  const [s, setS] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const [day, setDay] = useState<DayName>('SENIN');
  const [duration, setDuration] = useState(90);
  const [maxViol, setMaxViol] = useState(3);
  const [requireSeb, setRequireSeb] = useState(false);
  const [shQ, setShQ] = useState(true);
  const [shO, setShO] = useState(true);
  const [kelas, setKelas] = useState<KelasOpt[]>([]);
  const [kelasIds, setKelasIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const d = await apiFetch<SessionDetail>(`/sessions/${sessionId}`);
      setS(d);
      setDay(d.hariPelaksanaan ?? 'SENIN');
      setDuration(d.durationMin);
      setMaxViol(d.maxViolations);
      setRequireSeb(d.requireSeb);
      setShQ(d.shuffleQuestions);
      setShO(d.shuffleOptions);
      setKelasIds(d.kelasLinks.map((k) => k.kelas.id));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat sesi');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    apiFetch<KelasOpt[]>('/kelas').then(setKelas).catch(() => setKelas([]));
  }, [load]);

  const locked = Boolean(s?.visibleToSiswa || s?.status === 'CLOSED');
  const attemptCount = s?._count?.attempts ?? 0;

  const saveRules = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      await apiFetch(`/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          hariPelaksanaan: day,
          durationMin: duration,
          maxViolations: maxViol,
          requireSeb,
          shuffleQuestions: shQ,
          shuffleOptions: shO,
        }),
      });
      await apiFetch(`/sessions/${sessionId}/kelas`, {
        method: 'PUT',
        body: JSON.stringify({ kelasIds }),
      });
      setOk('Pengaturan pelaksanaan tersimpan.');
      await load();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Gagal menyimpan pengaturan');
    } finally {
      setBusy(false);
    }
  };

  const closeNow = () => {
    const msg = `Tutup & kumpul paksa sesi ini?\n\nSemua peserta yang masih mengerjakan langsung dikumpulkan dan dinilai otomatis. Tindakan ini tidak bisa dibatalkan.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setError('');
    setOk('');
    apiFetch<{ forceClosed?: number }>(`/sessions/${sessionId}/close`, { method: 'POST' })
      .then((r) => {
        setOk(`Sesi ditutup — ${r?.forceClosed ?? 0} peserta dikumpulkan paksa.`);
        return load();
      })
      .catch((e2) => setError(e2 instanceof ApiError ? e2.message : 'Gagal menutup sesi'))
      .finally(() => setBusy(false));
  };

  if (loading) return <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Memuat…</p>;
  if (!s) return <ErrorBanner message={error || 'Sesi tidak ditemukan'} />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="flex items-center gap-2 font-extrabold">
              <SlidersHorizontal size={18} /> Pengaturan Pelaksanaan
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {s.exam.title} · {s.questionCount} soal ·{' '}
              {s.visibleToSiswa ? (
                <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">Tampil ke siswa</Badge>
              ) : (
                <Badge>Tersembunyi dari siswa</Badge>
              )}
              {locked && s.visibleToSiswa ? <span className="ml-2 text-xs">(terkunci saat tampil)</span> : null}
            </p>
          </div>
          {attemptCount > 0 ? (
            <Button type="button" variant="danger" onClick={closeNow} disabled={busy}>
              <AlertTriangle size={16} /> Tutup & Kumpul Paksa
            </Button>
          ) : null}
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />
      {ok ? (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-300">
          {ok}
        </p>
      ) : null}

      <form onSubmit={saveRules}>
        <Card>
          <h3 className="mb-2 font-extrabold">Hari & aturan</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Hari pelaksanaan" value={day} onChange={(e) => setDay(e.target.value as DayName)} disabled={locked}>
              {DAY_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </Select>
            <TextInput label="Durasi (menit)" type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} disabled={locked} />
            <TextInput label="Batas pelanggaran" type="number" min={0} max={20} value={maxViol} onChange={(e) => setMaxViol(Number(e.target.value))} disabled={locked} />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
            <label className="flex items-center gap-2"><input type="checkbox" checked={shQ} onChange={(e) => setShQ(e.target.checked)} disabled={locked} className="h-4 w-4 accent-brand-500" /> Acak urutan soal</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={shO} onChange={(e) => setShO(e.target.checked)} disabled={locked} className="h-4 w-4 accent-brand-500" /> Acak opsi</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={requireSeb} onChange={(e) => setRequireSeb(e.target.checked)} disabled={locked} className="h-4 w-4 accent-brand-500" /> Wajib SEB</label>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Interval perilisan token: atur di tab <b>Token</b> di panel ini.
          </p>
        </Card>

        <Card className="mt-4">
          <h3 className="mb-2 font-extrabold">Kelas peserta</h3>
          {kelas.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Belum ada kelas.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {kelas.map((k) => (
                <label key={k.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-white/10">
                  <input
                    type="checkbox"
                    checked={kelasIds.includes(k.id)}
                    onChange={() =>
                      setKelasIds((prev) => (prev.includes(k.id) ? prev.filter((x) => x !== k.id) : [...prev, k.id]))
                    }
                    disabled={locked}
                    className="h-4 w-4 accent-brand-500"
                  />
                  {k.name}
                </label>
              ))}
            </div>
          )}
          {!locked ? (
            <div className="mt-3">
              <Button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan pengaturan'}</Button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Sesi sedang tampil ke siswa — sembunyikan dulu di header panel pelaksanaan untuk mengedit pengaturan.
            </p>
          )}
        </Card>
      </form>

      <Card>
        <h3 className="mb-1 font-extrabold">Tentang tampilan ke siswa</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tombol <b>Tampilkan ke siswa</b> ada di paling atas panel pelaksanaan (tepat di bawah judul sesi). Selama masih tampil, peserta langsung melihat ujian di "Ujian Saya" dan bisa mulai setelah token dirilis di tab <b>Token</b>. Sembunyikan lagi kapan pun — peserta yang sedang mengerjakan tidak terputus, hanya saja ujian tidak bisa dimulai lagi sampai ditampilkan kembali.
        </p>
      </Card>
    </div>
  );
}
