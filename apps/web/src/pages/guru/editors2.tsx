import { Button, TextInput } from '../../components/ui';
import { Select } from '../../components/admin';
import { newId } from './types';
import type { QuestionFormState } from './types';

type Set = (s: QuestionFormState) => void;

/** Editor Benar–Salah. */
export function StatementsEditor({ s, set }: { s: QuestionFormState; set: Set }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">Pernyataan + kunci</p>
      {s.statements.map((st, i) => (
        <div key={st.id} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_160px_48px]">
          <TextInput label={`Pernyataan ${i + 1}`} value={st.text} onChange={(e) => set({ ...s, statements: s.statements.map((x) => (x.id === st.id ? { ...x, text: e.target.value } : x)) })} />
          <Select label="Kunci" value={st.answer ? 'true' : 'false'} onChange={(e) => set({ ...s, statements: s.statements.map((x) => (x.id === st.id ? { ...x, answer: e.target.value === 'true' } : x)) })}>
            <option value="true">Benar</option>
            <option value="false">Salah</option>
          </Select>
          <Button
            type="button"
            variant="ghost"
            disabled={s.statements.length <= 1}
            onClick={() => set({ ...s, statements: s.statements.filter((x) => x.id !== st.id) })}
          >
            ×
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          disabled={s.statements.length >= 10}
          onClick={() => set({ ...s, statements: [...s.statements, { id: newId('s'), text: '', answer: true }] })}
        >
          + Pernyataan
        </Button>
      </div>
    </div>
  );
}

/** Editor Isian Singkat (multi-kunci, case-insensitive). */
export function IsianEditor({ s, set }: { s: QuestionFormState; set: Set }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">Kunci jawaban (huruf besar/kecil diabaikan)</p>
      {s.acceptedAnswers.map((a, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1">
            <TextInput label={`Kunci ${i + 1}`} value={a} onChange={(e) => set({ ...s, acceptedAnswers: s.acceptedAnswers.map((x, j) => (j === i ? e.target.value : x)) })} />
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={s.acceptedAnswers.length <= 1}
            onClick={() => set({ ...s, acceptedAnswers: s.acceptedAnswers.filter((_, j) => j !== i) })}
          >
            ×
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          disabled={s.acceptedAnswers.length >= 10}
          onClick={() => set({ ...s, acceptedAnswers: [...s.acceptedAnswers, ''] })}
        >
          + Kunci
        </Button>
      </div>
    </div>
  );
}
