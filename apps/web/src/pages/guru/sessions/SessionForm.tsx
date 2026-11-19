import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../../lib/api';
import { Button, Card, TextInput } from '../../../components/ui';
import { ErrorBanner, Select } from '../../../components/admin';

type DayName = 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT';

interface ExamOpt {
  id: string;
  title: string;
}

interface KelasOpt {
  id: string;
  name: string;
}

const DAY_OPTIONS: Array<{ value: DayName; label: string }> = [
  { value: 'SENIN', label: 'Hari 1 · Senin' },
  { value: 'SELASA', label: 'Hari 2 · Selasa' },
  { value: 'RABU', label: 'Hari 3 · Rabu' },
  { value: 'KAMIS', label: 'Hari 4 · Kamis' },
  { value: 'JUMAT', label: 'Hari 5 · Jumat' },
];

export function SessionForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [exams, setExams] = useState<ExamOpt[]>([]);
  const [kelas, setKelas] = useState<KelasOpt[]>([]);
  const [examId, setExamId] = useState(() => searchParams.get('examId') ?? '');
  const [title, setTitle] = useState('');
  const [day, setDay] = useState<DayName>('SENIN');
  const [duration, setDuration] = useState(90);
  const [maxViol, setMaxViol] = useState(3);
  const [requireSeb, setRequireSeb] = useState(false);
  const [shQ, setShQ] = useState(true);
  const [shO, setShO] = useState(true);
  const [kelasIds, setKelasIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ data: ExamOpt[] }>('/exams?limit=100').then((r) => setExams(r.data)).catch(() => undefined);
    apiFetch<KelasOpt[]>('/kelas').then(setKelas).catch(() => undefined);
    // Default aturan sesi mengikuti konfigurasi sekolah (Pengaturan admin).
    apiFetch<Record<string, string>>('/settings/public')
      .then((cfg) => {
        const maxV = Number(cfg.MAX_VIOLATIONS_DEFAULT);
        if (Number.isFinite(maxV) && maxV >= 0) setMaxViol(maxV);
        setRequireSeb((cfg.REQUIRE_SEB_DEFAULT ?? '').toLowerCase() === 'true');
      })
      .catch(() => undefined);
  }, []);

  function toggleKelas(id: string) {
    setKelasIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await apiFetch<{ id: string }>('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          examId,
          title: title.trim() || null,
          hariPelaksanaan: day,
          durationMin: duration,
          maxViolations: maxViol,
          requireSeb,
          shuffleQuestions: shQ,
          shuffleOptions: shO,
          kelasIds,
        }),
      });
      navigate(`/app/proktor/sesi/${created.id}/pengaturan`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat sesi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-xl font-extrabold">Sesi Baru</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Token sesi dibuat otomatis oleh server. Sesi baru langsung tersimpan &mdash; ujian belum tampil ke siswa sampai Anda menekan <b>Tampilkan ke siswa</b> di panel pelaksanaan.
        </p>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <form onSubmit={onSave} className="flex flex-col gap-4">
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Ujian" value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">— Pilih ujian —</option>
              {exams.map((x) => (
                <option key={x.id} value={x.id}>{x.title}</option>
              ))}
            </Select>
            <TextInput label="Judul sesi (opsional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="cth. UTS — XII IPA 1" />
            <Select label="Hari pelaksanaan" value={day} onChange={(e) => setDay(e.target.value as DayName)}>
              {DAY_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </Select>
            <TextInput label="Durasi (menit)" type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            <TextInput label="Batas pelanggaran" type="number" min={0} max={20} value={maxViol} onChange={(e) => setMaxViol(Number(e.target.value))} />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
            <label className="flex items-center gap-2"><input type="checkbox" checked={shQ} onChange={(e) => setShQ(e.target.checked)} className="h-4 w-4 accent-brand-500" /> Acak urutan soal</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={shO} onChange={(e) => setShO(e.target.checked)} className="h-4 w-4 accent-brand-500" /> Acak opsi</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={requireSeb} onChange={(e) => setRequireSeb(e.target.checked)} className="h-4 w-4 accent-brand-500" /> Wajib SEB</label>
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 font-extrabold">Kelas peserta</h2>
          {kelas.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada kelas.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {kelas.map((k) => (
                <label key={k.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-white/10">
                  <input type="checkbox" checked={kelasIds.includes(k.id)} onChange={() => toggleKelas(k.id)} className="h-4 w-4 accent-brand-500" />
                  {k.name}
                </label>
              ))}
            </div>
          )}
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !examId}>{busy ? 'Menyimpan…' : 'Buat sesi'}</Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/app/guru/sesi')}>Batal</Button>
        </div>
      </form>
    </div>
  );
}
