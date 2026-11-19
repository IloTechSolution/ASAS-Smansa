import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { QuestionType } from '@cbt/shared';
import { QUESTION_TYPES, QUESTION_TYPE_LABEL, SCORING_MODES, SCORING_MODE_LABEL } from '@cbt/shared';
import { apiFetch, apiUpload, ApiError } from '../../lib/api';
import { Button, Card, TextInput } from '../../components/ui';
import { UploadImg } from '../../components/UploadImg';
import { ErrorBanner, Select } from '../../components/admin';
import { blankForm, fromEntity, toPayload } from './types';
import type { QuestionFormState } from './types';
import { ChoicesEditor, MatchingEditor } from './editors';
import { IsianEditor, StatementsEditor } from './editors2';

export function QuestionForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [s, setS] = useState<QuestionFormState>(() => blankForm('PG'));
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!imgFile) {
      setPendingPreview(null);
      return;
    }
    const url = URL.createObjectURL(imgFile);
    setPendingPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imgFile]);

  useEffect(() => {
    if (!id) return;
    apiFetch<{
      type: QuestionType; content: string; weight: number;
      scoringMode: 'ALL_OR_NOTHING' | 'PROPORSIONAL'; explanation: string | null;
      imageUrl: string | null; choices: unknown; correctChoices: unknown;
      pairs: unknown; statements: unknown; acceptedAnswers: unknown;
    }>(`/questions/${id}`)
      .then((q) => {
        setS(fromEntity(q));
        setImageUrl(q.imageUrl);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Gagal memuat soal'))
      .finally(() => setLoading(false));
  }, [id]);

  function changeType(t: QuestionType) {
    setS((prev) => ({ ...blankForm(t), content: prev.content, weight: prev.weight, explanation: prev.explanation }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isEdit) {
        await apiFetch(`/questions/${id}`, { method: 'PATCH', body: JSON.stringify(toPayload(s)) });
        navigate('/app/guru/soal', { replace: true, state: { saved: 'diubah' } });
      } else {
        const created = await apiFetch<{ id: string }>('/questions', { method: 'POST', body: JSON.stringify(toPayload(s)) });
        if (imgFile) {
          try {
            const fd = new FormData();
            fd.append('image', imgFile);
            await apiUpload<{ imageUrl: string }>(`/questions/${created.id}/image`, fd);
            navigate('/app/guru/soal', { replace: true, state: { saved: 'dibuat' } });
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Soal tersimpan, tapi upload gambar gagal — unggah ulang di halaman ubah.');
            navigate(`/app/guru/soal/${created.id}/ubah`, { replace: true });
            return;
          }
        } else {
          navigate('/app/guru/soal', { replace: true, state: { saved: 'dibuat' } });
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan soal');
    } finally {
      setBusy(false);
    }
  }

  async function onUploadImage() {
    if (!imgFile || !id) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', imgFile);
      const res = await apiUpload<{ imageUrl: string }>(`/questions/${id}/image`, fd);
      setImageUrl(res.imageUrl);
      setImgFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload gambar gagal');
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-xl font-extrabold">{isEdit ? 'Ubah Soal' : 'Soal Baru'}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Kunci tersimpan sebagai pembahasan internal — tidak pernah tampil di aplikasi siswa.</p>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <form onSubmit={onSave} className="flex flex-col gap-4">
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_200px]">
            <Select label="Jenis soal" value={s.type} onChange={(e) => changeType(e.target.value as QuestionType)}>
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>
              ))}
            </Select>
            <TextInput label="Bobot" type="number" min={0.5} max={100} step={0.5} value={s.weight} onChange={(e) => setS({ ...s, weight: Number(e.target.value) })} />
            {(s.type === 'PG_KOMPLEKS' || s.type === 'MATCHING' || s.type === 'BENAR_SALAH') ? (
              <Select label="Mode skor" value={s.scoringMode} onChange={(e) => setS({ ...s, scoringMode: e.target.value as 'ALL_OR_NOTHING' | 'PROPORSIONAL' })}>
                {SCORING_MODES.map((m) => (
                  <option key={m} value={m}>{SCORING_MODE_LABEL[m]}</option>
                ))}
              </Select>
            ) : null}
          </div>
          <div className="mt-3">
            <label htmlFor="q-content" className="mb-1.5 block text-sm font-semibold">Teks soal</label>
            <textarea id="q-content" className="input-base min-h-24" value={s.content} onChange={(e) => setS({ ...s, content: e.target.value })} placeholder="Tulis soal…" />
          </div>
          <div className="mt-3">
            <label htmlFor="q-explain" className="mb-1.5 block text-sm font-semibold">Pembahasan (opsional)</label>
            <textarea id="q-explain" className="input-base" value={s.explanation} onChange={(e) => setS({ ...s, explanation: e.target.value })} placeholder="Tampil setelah publish…" />
          </div>
        </Card>

        <Card>
          {s.type === 'PG' ? <ChoicesEditor s={s} set={setS} multi={false} onError={setError} /> : null}
          {s.type === 'PG_KOMPLEKS' ? <ChoicesEditor s={s} set={setS} multi onError={setError} /> : null}
          {s.type === 'MATCHING' ? <MatchingEditor s={s} set={setS} /> : null}
          {s.type === 'BENAR_SALAH' ? <StatementsEditor s={s} set={setS} /> : null}
          {s.type === 'ISIAN_SINGKAT' ? <IsianEditor s={s} set={setS} /> : null}
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : isEdit ? 'Simpan perubahan' : 'Buat soal'}</Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/app/guru/soal')}>Kembali</Button>
        </div>
      </form>

      <Card>
        <h2 className="mb-2 font-extrabold">Gambar soal (opsional)</h2>
        {isEdit ? (
          imageUrl ? (
            <UploadImg src={imageUrl} alt="Gambar soal" className="mb-3 max-h-64 rounded-xl border border-slate-200 dark:border-white/10" />
          ) : (
            <p className="mb-3 text-sm text-slate-500">Belum ada gambar.</p>
          )
        ) : pendingPreview ? (
          <img src={pendingPreview} alt="Pratinjau gambar soal" className="mb-3 max-h-64 rounded-xl border border-slate-200 object-contain dark:border-white/10" />
        ) : (
          <p className="mb-3 text-sm text-slate-500">Belum ada gambar. Gambar akan diunggah saat soal disimpan.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif" data-testid="q-image-input" className="input-base max-w-xs" onChange={(e) => setImgFile(e.target.files?.[0] ?? null)} />
          {isEdit ? (
            <Button type="button" disabled={busy || !imgFile} onClick={onUploadImage}>Unggah</Button>
          ) : imgFile ? (
            <Button type="button" variant="ghost" onClick={() => setImgFile(null)}>Batalkan gambar</Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
