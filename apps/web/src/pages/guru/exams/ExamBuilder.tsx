import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { QuestionType } from '@cbt/shared';
import { QUESTION_TYPE_LABEL } from '@cbt/shared';
import { Eye } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Badge, Button, Card, TextInput } from '../../../components/ui';
import { ErrorBanner, Modal, TableWrap, Td, Th } from '../../../components/admin';
import { QuestionPicker } from './QuestionPicker';

type ExamTab = 'soal' | 'sesi';

interface SesiRow {
  id: string;
  title: string | null;
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'CLOSED';
  startsAt: string | null;
  endsAt: string | null;
  durationMin: number;
  kelasLinks: Array<{ kelas: { name: string } }>;
  _count: { attempts: number };
}

const SESI_STATUS: Record<string, string> = {
  DRAFT: 'Draf',
  SCHEDULED: 'Terjadwal',
  ACTIVE: 'Aktif',
  CLOSED: 'Ditutup',
};

interface ExamQ {
  order: number;
  id: string;
  type: QuestionType;
  content: string;
  weight: number;
}

interface ExamDetail {
  id: string;
  title: string;
  description: string | null;
  mapel: { name: string };
  questions: ExamQ[];
  totalWeight: number;
}

export function ExamBuilder() {
  const { id } = useParams();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [byId, setById] = useState<Record<string, ExamQ>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [tab, setTab] = useState<ExamTab>('soal');
  const [sesi, setSesi] = useState<SesiRow[]>([]);
  const [sesiLoading, setSesiLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importRows, setImportRows] = useState<Array<{ id: string; type: string; weight: string; content: string }>>([]);
  const [importError, setImportError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const d = await apiFetch<ExamDetail>(`/exams/${id}`);
      setExam(d);
      setIds(d.questions.map((x) => x.id));
      const map: Record<string, ExamQ> = {};
      for (const x of d.questions) map[x.id] = x;
      setById(map);
      setTitle(d.title);
      setDesc(d.description ?? '');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat ujian');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    setIds(next);
    setOk('');
  }

  async function onSaveOrder() {
    if (!id) return;
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await apiFetch<{ count: number; totalWeight: number }>(`/exams/${id}/questions`, {
        method: 'PUT',
        body: JSON.stringify({ questionIds: ids }),
      });
      setOk(`Tersimpan: ${res.count} soal, total bobot ${res.totalWeight}.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan susunan');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveMeta(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/exams/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim(), description: desc.trim() || null }),
      });
      setOk('Judul/deskripsi disimpan.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  }

  const loadSesi = useCallback(async () => {
    if (!id) return;
    setSesiLoading(true);
    try {
      const res = await apiFetch<{ data: SesiRow[] }>(`/sessions?examId=${id}&limit=100`);
      setSesi(res.data);
    } catch {
      setSesi([]);
    } finally {
      setSesiLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (tab === 'sesi') void loadSesi();
  }, [tab, loadSesi]);

  async function onDeleteSesi(row: SesiRow) {
    if (!window.confirm(`Hapus sesi "${row.title ?? exam?.title ?? 'tanpa judul'}"?`)) return;
    setError('');
    try {
      await apiFetch(`/sessions/${row.id}`, { method: 'DELETE' });
      setOk('Sesi dihapus.');
      loadSesi();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus sesi (sesi berisi data tidak bisa dihapus)');
    }
  }

  function parseCsv(text: string): Array<{ id: string; type: string; weight: string; content: string }> {
    const strip = text.replace(/^﻿/, '');
    const rows: string[][] = [];
    let row: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < strip.length; i++) {
      const ch = strip[i];
      if (inQ) {
        if (ch === '"') {
          if (strip[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && strip[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some((c) => c.trim() !== '')) rows.push(row);
        row = [];
      } else cur += ch;
    }
    if (cur.length || row.length) {
      row.push(cur);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
    }
    if (rows.length === 0) return [];
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (names: string[]) => {
      for (const n of names) {
        const k = header.indexOf(n);
        if (k >= 0) return k;
      }
      return -1;
    };
    const iId = idx(['id']);
    const iTipe = idx(['tipe', 'type']);
    const iBobot = idx(['bobot', 'weight']);
    const iKonten = idx(['konten', 'content', 'soal', 'pertanyaan']);
    const out: Array<{ id: string; type: string; weight: string; content: string }> = [];
    const seen = new Set<string>();
    for (const cols of rows.slice(1)) {
      const rec = {
        id: iId >= 0 ? (cols[iId] ?? '').trim() : '',
        type: iTipe >= 0 ? (cols[iTipe] ?? '').trim().toUpperCase() : '',
        weight: iBobot >= 0 ? (cols[iBobot] ?? '').trim() : '',
        content: iKonten >= 0 ? (cols[iKonten] ?? '').trim() : '',
      };
      if (!rec.id || seen.has(rec.id)) continue;
      seen.add(rec.id);
      out.push(rec);
    }
    return out;
  }

  async function onPickImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = (e.target as HTMLInputElement).files?.[0];
    setImportError('');
    setImportRows([]);
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      setImportError('CSV tidak valid atau kosong — pastikan kolom minimal id,tipe,bobot,konten');
      return;
    }
    setImportRows(parsed);
  }

  async function onSaveImport() {
    if (!id || importRows.length === 0) return;
    setImportBusy(true);
    setImportError('');
    setError('');
    setOk('');
    try {
      const merged = [...new Set([...ids, ...importRows.map((r) => r.id)])];
      const res = await apiFetch<{ count: number; totalWeight: number }>(`/exams/${id}/questions`, {
        method: 'PUT',
        body: JSON.stringify({ questionIds: merged }),
      });
      // byId diperbarui agar daftar langsung terlihat tanpa reload penuh
      const map: Record<string, ExamQ> = { ...byId };
      for (const r of importRows) {
        map[r.id] = map[r.id] ?? {
          order: 0,
          id: r.id,
          type: (QUESTION_TYPE_LABEL as Record<string, string>)[r.type] ? (r.type as QuestionType) : 'PG',
          content: r.content,
          weight: Number(r.weight) || 1,
        };
      }
      setIds(merged);
      setById(map);
      setImportOpen(false);
      setImportRows([]);
      setOk(`${importRows.length} soal diimpor. Total ${res.count} soal (bobot ${res.totalWeight}).`);
      load();
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Gagal menyimpan soal impor');
    } finally {
      setImportBusy(false);
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>;
  if (!exam) return <ErrorBanner message={error || 'Ujian tidak ditemukan'} />;

  const dirty = JSON.stringify(ids) !== JSON.stringify(exam.questions.map((x) => x.id));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-extrabold">{exam.title}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {exam.mapel.name} · {ids.length} soal · total bobot {exam.totalWeight}
            </p>
          </div>
          <Link to="/app/guru/ujian"><Button type="button" variant="ghost">Kembali</Button></Link>
          <Link to={`/app/guru/ujian/${exam.id}/pratinjau`}><Button type="button" variant="ghost"><Eye size={16} /> Pratinjau Ujian</Button></Link>
          <Link to={`/app/guru/sesi/baru?examId=${exam.id}`}><Button type="button" variant="gold">+ Sesi</Button></Link>
        </div>
        {/* Tab navigasi */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-white/10" role="tablist" aria-label="Kelola ujian">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'soal'}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === 'soal' ? 'bg-brand-500/15 text-brand-700 dark:text-brand-200' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
            onClick={() => setTab('soal')}
          >
            Susunan Soal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'sesi'}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === 'sesi' ? 'bg-brand-500/15 text-brand-700 dark:text-brand-200' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
            onClick={() => setTab('sesi')}
          >
            Sesi Ujian ({sesi.length})
          </button>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />
      {ok ? <p className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-300" role="status">{ok}</p> : null}

      {tab === 'soal' ? (
        <>
          <Card>
            <form onSubmit={onSaveMeta} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <TextInput label="Judul" value={title} onChange={(e) => setTitle(e.target.value)} />
              <TextInput label="Deskripsi" value={desc} onChange={(e) => setDesc(e.target.value)} />
              <div className="flex items-end">
                <Button type="submit" disabled={busy}>Simpan</Button>
              </div>
            </form>
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto font-extrabold">Susunan soal</h2>
              <Button type="button" variant="ghost" onClick={() => setImportOpen(true)}>Import CSV</Button>
              <Button type="button" variant="ghost" onClick={() => setPicker(true)}>+ Dari bank soal</Button>
              <Button type="button" disabled={busy || !dirty || ids.length === 0} onClick={onSaveOrder}>
                {busy ? 'Menyimpan…' : 'Simpan urutan'}
              </Button>
            </div>
            {ids.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Belum ada soal. Tambahkan dari bank soal atau impor CSV.</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {ids.map((qid, i) => {
                  const x = byId[qid];
                  if (!x) return null;
                  return (
                    <li key={qid} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-white/10">
                      <span className="w-8 font-extrabold">{i + 1}.</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{x.content}</span>
                        <span className="mt-0.5 flex gap-1"><Badge>{QUESTION_TYPE_LABEL[x.type]}</Badge><Badge>Bobot {x.weight}</Badge></span>
                      </span>
                      <Button type="button" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                      <Button type="button" variant="ghost" disabled={i === ids.length - 1} onClick={() => move(i, 1)}>↓</Button>
                      <Button type="button" variant="danger" onClick={() => { setIds(ids.filter((v) => v !== qid)); setOk(''); }}>×</Button>
                    </li>
                  );
                })}
              </ol>
            )}
            {dirty ? <p className="mt-2 text-xs font-bold text-gold-600 dark:text-gold-300">Urutan berubah — klik “Simpan urutan”.</p> : null}
          </Card>
        </>
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-extrabold">Sesi ujian untuk ujian ini</h2>
            <Link to={`/app/guru/sesi/baru?examId=${exam.id}`}><Button type="button" variant="gold">+ Tambah sesi</Button></Link>
          </div>
          {sesiLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">Memuat…</p>
          ) : sesi.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Belum ada sesi. Tambahkan sesi pertama untuk ujian ini.</p>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Judul / Jadwal</Th>
                  <Th>Kelas</Th>
                  <Th>Status</Th>
                  <Th>Peserta</Th>
                  <Th>Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {sesi.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <p className="font-semibold">{s.title ?? '(tanpa judul)'}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {s.startsAt ? new Date(s.startsAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Jadwal belum diisi'}
                        {s.endsAt ? ` – ${new Date(s.endsAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : ''}
                        {' · '}{s.durationMin} mnt
                      </p>
                    </Td>
                    <Td>{s.kelasLinks.map((k) => k.kelas.name).join(', ') || '—'}</Td>
                    <Td><Badge>{SESI_STATUS[s.status] ?? s.status}</Badge></Td>
                    <Td>{s._count.attempts}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Link to={`/app/proktor/sesi/${s.id}/pengaturan`}><Button type="button" variant="ghost">Pengaturan</Button></Link>
                        <Link to={`/app/guru/sesi/${s.id}/penilaian`}><Button type="button" variant="ghost">Nilai</Button></Link>
                        <Button type="button" variant="danger" onClick={() => onDeleteSesi(s)}>Hapus</Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {picker ? (
        <QuestionPicker
          exclude={new Set(ids)}
          onAdd={(added) => {
            setIds((prev) => [...prev, ...added.map((a) => a.id)]);
            setById((prev) => {
              const next = { ...prev };
              for (const a of added) next[a.id] = { order: 0, ...a };
              return next;
            });
            setOk('');
          }}
          close={() => setPicker(false)}
        />
      ) : null}

      {/* Modal import CSV */}
      {importOpen ? (
        <Modal title="Import soal dari CSV" onClose={() => setImportOpen(false)} wide>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Gunakan CSV hasil <b>Export CSV</b> dari Bank Soal (kolom: id,tipe,bobot,konten). Soal yang diimpor
            langsung tampil sebagai pratinjau; klik <b>Simpan soal</b> untuk memasukkannya ke ujian ini.
          </p>
          <div className="mt-3">
            <input
              type="file"
              accept=".csv,text/csv"
              className="input-base"
              onChange={onPickImportFile}
              aria-label="Pilih file CSV"
            />
          </div>
          {importError ? (
            <p className="mt-3 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-500" role="alert">
              {importError}
            </p>
          ) : null}
          {importRows.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-sm font-bold">Pratinjau — {importRows.length} soal valid (duplikat dilewati)</p>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10">
                <TableWrap>
                  <thead>
                    <tr>
                      <Th>#</Th>
                      <Th>Tipe</Th>
                      <Th>Pertanyaan</Th>
                      <Th>Bobot</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((r, i) => (
                      <tr key={`${r.id}-${i}`}>
                        <Td>{i + 1}</Td>
                        <Td><Badge>{(QUESTION_TYPE_LABEL as Record<string, string>)[r.type] ?? r.type}</Badge></Td>
                        <Td><span className="line-clamp-2">{r.content || '(teks kosong)'}</span></Td>
                        <Td>{r.weight || '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => { setImportRows([]); setImportOpen(false); }}>Batal</Button>
                <Button type="button" variant="gold" disabled={importBusy} onClick={onSaveImport}>
                  {importBusy ? 'Menyimpan…' : 'Simpan soal'}
                </Button>
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
