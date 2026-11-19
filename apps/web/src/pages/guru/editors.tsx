import { useState } from 'react';
import { Button, TextInput } from '../../components/ui';
import { Select } from '../../components/admin';
import { newId } from './types';
import type { QuestionFormState } from './types';
import { UploadImg } from '../../components/UploadImg';
import { apiUpload, ApiError } from '../../lib/api';

type Set = (s: QuestionFormState) => void;

/** Editor opsi PG / PG Kompleks (teks dan/atau gambar). */
export function ChoicesEditor({ s, set, multi, onError }: { s: QuestionFormState; set: Set; multi: boolean; onError?: (msg: string) => void }) {
  const [busyId, setBusyId] = useState('');

  function toggle(id: string) {
    if (multi) {
      set({ ...s, correctChoices: s.correctChoices.includes(id) ? s.correctChoices.filter((x) => x !== id) : [...s.correctChoices, id] });
    } else {
      set({ ...s, correctChoices: [id] });
    }
  }

  function patchChoice(id: string, patch: Partial<QuestionFormState['choices'][number]>) {
    set({ ...s, choices: s.choices.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  }

  async function uploadImage(id: string, file: File) {
    setBusyId(id);
    onError?.('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await apiUpload<{ imageUrl: string }>('/questions/image', fd);
      patchChoice(id, { imageUrl: res.imageUrl });
    } catch (e) {
      onError?.(e instanceof ApiError ? e.message : 'Gagal mengunggah gambar opsi');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">Opsi jawaban {multi ? '(boleh lebih dari 1 benar)' : '(tepat 1 benar)'}</p>
      {s.choices.map((c, i) => (
        <div key={c.id} className="flex items-start gap-2">
          <input
            type={multi ? 'checkbox' : 'radio'}
            name="kunci-pg"
            checked={s.correctChoices.includes(c.id)}
            onChange={() => toggle(c.id)}
            title="Tandai sebagai kunci"
            className="mt-4 h-5 w-5 accent-emerald-500"
          />
          <div className="flex-1">
            <TextInput label={`Opsi ${i + 1}`} value={c.label} onChange={(e) => patchChoice(c.id, { label: e.target.value })} />
            {c.imageUrl ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <UploadImg src={c.imageUrl} alt={`Gambar opsi ${i + 1}`} className="max-h-28 rounded-lg border border-slate-200 dark:border-white/10" />
                <Button type="button" variant="ghost" className="text-xs" onClick={() => patchChoice(c.id, { imageUrl: null })}>
                  Hapus gambar
                </Button>
              </div>
            ) : (
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="file"
                  id={`choice-img-${c.id}`}
                  accept=".jpg,.jpeg,.png,.webp,.gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void uploadImage(c.id, file);
                  }}
                />
                <label
                  htmlFor={`choice-img-${c.id}`}
                  className="cursor-pointer rounded-xl border border-dashed border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-500 transition hover:border-brand-400 hover:text-brand-600 dark:border-white/15 dark:text-slate-400 dark:hover:border-brand-500/50 dark:hover:text-brand-300"
                >
                  {busyId === c.id ? 'Mengunggah…' : '+ Gambar (opsional)'}
                </label>
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            className="mt-2"
            disabled={s.choices.length <= 2}
            onClick={() => set({ ...s, choices: s.choices.filter((x) => x.id !== c.id), correctChoices: s.correctChoices.filter((x) => x !== c.id) })}
          >
            ×
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          disabled={s.choices.length >= 10}
          onClick={() => set({ ...s, choices: [...s.choices, { id: newId('c'), label: '' }] })}
        >
          + Opsi
        </Button>
      </div>
    </div>
  );
}

/** Editor Mencocokkan. */
export function MatchingEditor({ s, set }: { s: QuestionFormState; set: Set }) {
  function side(list: 'left' | 'right', id: string, text: string) {
    set({ ...s, [list]: s[list].map((x) => (x.id === id ? { ...x, text } : x)) });
  }

  function add(list: 'left' | 'right') {
    if (s[list].length >= 10) return;
    set({ ...s, [list]: [...s[list], { id: newId(list === 'left' ? 'l' : 'r'), text: '' }] });
  }

  function del(list: 'left' | 'right', id: string) {
    if (s[list].length <= 2) return;
    const mapping = { ...s.mapping };
    if (list === 'left') {
      delete mapping[id];
    } else {
      // Mapping berkunci id KIRI — hapus pasangan yang menunjuk item kanan ini.
      for (const leftId of Object.keys(mapping)) {
        if (mapping[leftId] === id) delete mapping[leftId];
      }
    }
    set({ ...s, [list]: s[list].filter((x) => x.id !== id), mapping });
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {(['left', 'right'] as const).map((list) => (
        <div key={list} className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{list === 'left' ? 'Kolom kiri' : 'Kolom kanan'}</p>
          {s[list].map((x, i) => (
            <div key={x.id} className="flex items-center gap-2">
              <div className="flex-1">
                <TextInput label={`Item ${i + 1}`} value={x.text} onChange={(e) => side(list, x.id, e.target.value)} />
              </div>
              <Button type="button" variant="ghost" disabled={s[list].length <= 2} onClick={() => del(list, x.id)}>×</Button>
            </div>
          ))}
          <div>
            <Button type="button" variant="ghost" disabled={s[list].length >= 10} onClick={() => add(list)}>+ Item</Button>
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-2 md:col-span-2">
        <p className="text-sm font-semibold">Pasangan benar</p>
        {s.left.map((l) => (
          <div key={l.id} className="grid grid-cols-2 items-center gap-2">
            <span className="truncate text-sm">{l.text || '(kiri kosong)'}</span>
            <Select label={`Pasangan ${l.text || l.id}`} value={s.mapping[l.id] ?? ''} onChange={(e) => set({ ...s, mapping: { ...s.mapping, [l.id]: e.target.value } })}>
              <option value="">— pilih —</option>
              {s.right.map((r) => (
                <option key={r.id} value={r.id}>{r.text || '(kanan kosong)'}</option>
              ))}
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}
