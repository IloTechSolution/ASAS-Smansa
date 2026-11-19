import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Search, UserPlus, X } from 'lucide-react';
import { apiFetch, ApiError, schoolSelector } from '../../lib/api';
import { Badge, Button, Card } from '../../components/ui';
import { ErrorBanner, TableWrap, Td, Th } from '../../components/admin';
import { useAuth } from '../../auth/AuthContext';

interface ExamRow {
  id: string;
  title: string;
  mapel?: { id: string; name: string } | null;
  _count?: { sessions: number };
}

interface CandidateRow {
  id: string;
  name: string;
  username: string;
  nisn: string | null;
  kelas: { name: string } | null;
  enrolled: boolean;
}

interface EnrolledUser {
  id: string;
  name: string;
  username: string;
  nisn: string | null;
  kelas: { name: string } | null;
  isActive: boolean;
}

/** Enrol Siswa — admin/proktor mencari siswa lalu mendaftarkan ke ujian yang sudah ada. */
export function EnrolSiswa() {
  const { user } = useAuth();
  const aggregate = user?.role === 'ADMIN' && !schoolSelector();

  const [examSearch, setExamSearch] = useState('');
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [selected, setSelected] = useState<ExamRow | null>(null);
  const [siswaSearch, setSiswaSearch] = useState('');
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [enrolled, setEnrolled] = useState<EnrolledUser[]>([]);
  const [loadingExams, setLoadingExams] = useState(true);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadExams = useCallback(() => {
    setLoadingExams(true);
    setError('');
    const params = new URLSearchParams({ limit: '50' });
    if (examSearch.trim()) params.set('search', examSearch.trim());
    apiFetch<{ data: ExamRow[] }>(`/exams?${params}`)
      .then((r) => setExams(r.data ?? []))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal memuat ujian'))
      .finally(() => setLoadingExams(false));
  }, [examSearch]);

  useEffect(() => {
    const t = window.setTimeout(loadExams, 250);
    return () => window.clearTimeout(t);
  }, [loadExams]);

  const loadDetail = useCallback((examId: string, search: string) => {
    setLoadingCandidates(true);
    setError('');
    const params = new URLSearchParams({ limit: '50' });
    if (search.trim()) params.set('search', search.trim());
    Promise.all([
      apiFetch<{ data: CandidateRow[] }>(`/exams/${examId}/candidates?${params}`),
      apiFetch<{ data: EnrolledUser[]; total: number }>(`/exams/${examId}/enrollments`),
    ])
      .then(([cand, list]) => {
        setCandidates(cand.data ?? []);
        setEnrolled(list.data ?? []);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal memuat peserta'))
      .finally(() => setLoadingCandidates(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    const t = window.setTimeout(() => loadDetail(selected.id, siswaSearch), 250);
    return () => window.clearTimeout(t);
  }, [siswaSearch, selected, loadDetail]);

  const enrolledIds = useMemo(() => new Set(enrolled.map((u) => u.id)), [enrolled]);

  const toggle = async (c: CandidateRow) => {
    if (!selected || aggregate) return;
    setBusyId(c.id);
    setError('');
    const next = new Set(enrolledIds);
    if (next.has(c.id)) next.delete(c.id);
    else next.add(c.id);
    try {
      await apiFetch(`/exams/${selected.id}/enrollments`, {
        method: 'PUT',
        body: JSON.stringify({ userIds: [...next] }),
      });
      loadDetail(selected.id, siswaSearch);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menyimpan enrol');
    } finally {
      setBusyId(null);
    }
  };

  const unenroll = async (u: EnrolledUser) => {
    if (!selected || aggregate) return;
    setBusyId(u.id);
    setError('');
    const next = enrolled.filter((x) => x.id !== u.id).map((x) => x.id);
    try {
      await apiFetch(`/exams/${selected.id}/enrollments`, {
        method: 'PUT',
        body: JSON.stringify({ userIds: next }),
      });
      loadDetail(selected.id, siswaSearch);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menghapus enrol');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-xl font-extrabold">
              <UserPlus size={20} /> Enrol Siswa
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              Cari siswa, lalu daftarkan ke ujian yang sudah ada. Bila sebuah ujian memiliki daftar
              enrol, <b>hanya siswa terdaftar</b> yang bisa mengikuti. Bila daftar kosong, semua siswa
              kelas peserta sesi bisa ikut (perilaku bawaan).
            </p>
          </div>
          {selected ? <Badge>{enrolled.length} terdaftar</Badge> : null}
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      {aggregate ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-300">
          Mode Semua Sekolah — pilih sekolah di kanan atas dulu untuk mengelola enrol peserta (dibatasi per sekolah).
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-5">
        {/* 1. Pilih ujian */}
        <Card className="xl:col-span-2">
          <h2 className="font-extrabold">1 · Pilih ujian</h2>
          <div className="mt-2 flex items-center gap-2">
            <Search size={16} className="shrink-0 text-slate-400" />
            <input
              className="input-base"
              placeholder="Cari judul ujian…"
              value={examSearch}
              onChange={(e) => setExamSearch(e.target.value)}
              aria-label="Cari ujian"
            />
          </div>
          <div className="mt-3 flex max-h-[520px] flex-col gap-1.5 overflow-y-auto pr-1">
            {loadingExams ? (
              <p className="py-6 text-center text-sm text-slate-500">Memuat ujian…</p>
            ) : exams.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-white/10">
                Tidak ada ujian cocok.
              </p>
            ) : (
              exams.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => setSelected(ex)}
                  className={[
                    'rounded-xl border px-3 py-2 text-left transition',
                    selected?.id === ex.id
                      ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500'
                      : 'border-slate-200 hover:border-brand-400 dark:border-white/10 dark:hover:border-brand-500/50',
                  ].join(' ')}
                >
                  <span className="block text-sm font-bold">{ex.title}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                    {ex.mapel?.name ?? 'Tanpa mapel'} · {ex._count?.sessions ?? 0} sesi
                  </span>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* 2. Cari siswa & kelola enrol */}
        <Card className="xl:col-span-3">
          {!selected ? (
            <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
              Pilih ujian di sebelah kiri dulu — lalu cari siswa untuk di-enrol.
            </p>
          ) : (
            <>
              <h2 className="font-extrabold">
                2 · Cari siswa untuk <span className="text-brand-600 dark:text-gold-300">{selected.title}</span>
              </h2>
              <div className="mt-2 flex items-center gap-2">
                <Search size={16} className="shrink-0 text-slate-400" />
                <input
                  className="input-base"
                  placeholder="Cari nama / NISN / username…"
                  value={siswaSearch}
                  onChange={(e) => setSiswaSearch(e.target.value)}
                  aria-label="Cari siswa"
                />
              </div>
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
                <TableWrap>
                  <thead>
                    <tr><Th>Nama</Th><Th>NISN</Th><Th>Kelas</Th><Th><span className="sr-only">Aksi</span></Th></tr>
                  </thead>
                  <tbody>
                    {loadingCandidates ? (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">Memuat…</td></tr>
                    ) : candidates.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">Tidak ada siswa cocok.</td></tr>
                    ) : (
                      candidates.map((c) => (
                        <tr key={c.id}>
                          <Td><p className="font-semibold">{c.name}</p></Td>
                          <Td>{c.nisn ?? c.username}</Td>
                          <Td>{c.kelas?.name ?? '—'}</Td>
                          <Td>
                            <Button
                              type="button"
                              variant={c.enrolled ? 'ghost' : 'gold'}
                              disabled={busyId === c.id || aggregate}
                              onClick={() => toggle(c)}
                            >
                              {c.enrolled ? (<><Check size={14} /> Terdaftar</>) : 'Enrol'}
                            </Button>
                          </Td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </TableWrap>
              </div>

              <div className="mt-4">
                <h3 className="text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Terdaftar ({enrolled.length})
                </h3>
                {enrolled.length === 0 ? (
                  <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-white/10">
                    Belum ada siswa terdaftar — semua siswa kelas peserta sesi bisa mengikuti ujian ini.
                  </p>
                ) : (
                  <ul className="mt-2 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                    {enrolled.map((u) => (
                      <li key={u.id} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-1.5 text-sm dark:border-white/10 dark:bg-white/5">
                        <span>
                          <b>{u.name}</b>
                          <span className="ml-1.5 text-[11px] text-slate-500">{u.nisn ?? u.username}{u.kelas ? ` · ${u.kelas.name}` : ''}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => unenroll(u)}
                          disabled={busyId === u.id || aggregate}
                          className="rounded-full p-1 text-slate-400 transition hover:bg-red-500/10 hover:text-red-500"
                          title="Keluarkan dari daftar"
                          aria-label={`Keluarkan ${u.name}`}
                        >
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
