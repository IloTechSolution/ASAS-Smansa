import type { ReactNode } from 'react';
import { cn } from '../../components/ui';
import { UploadImg } from '../../components/UploadImg';

export interface Choice {
  id: string;
  label: string;
  imageUrl?: string | null;
}
export interface PairSide {
  id: string;
  text: string;
}
export interface Statement {
  id: string;
  text: string;
}

export interface ExamQuestion {
  id: string;
  type: 'PG' | 'PG_KOMPLEKS' | 'MATCHING' | 'BENAR_SALAH' | 'ISIAN_SINGKAT';
  content: string;
  imageUrl: string | null;
  weight: number;
  scoringMode: string;
  choices?: Choice[];
  pairs?: { left: PairSide[]; right: PairSide[] };
  statements?: Statement[];
}

function OptionRow({
  active,
  onClick,
  children,
  multiple,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  multiple?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition',
        active
          ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-200'
          : 'border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5',
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] font-bold',
          multiple ? 'rounded-md' : 'rounded-full',
          active ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-400 text-transparent',
        )}
      >
        ✓
      </span>
      <span className="flex-1">{children}</span>
    </button>
  );
}

export function QuestionEditor({
  question,
  value,
  onChange,
}: {
  question: ExamQuestion;
  value: unknown;
  onChange: (payload: unknown) => void;
}) {
  if (question.type === 'PG') {
    const selected = typeof value === 'string' ? value : '';
    return (
      <div className="flex flex-col gap-2">
        {(question.choices ?? []).map((c) => (
          <OptionRow key={c.id} active={selected === c.id} onClick={() => onChange(c.id)}>
            {c.imageUrl ? <UploadImg src={c.imageUrl} alt="" className="mb-1 max-h-40 rounded-lg" /> : null}
            {c.label}
          </OptionRow>
        ))}
      </div>
    );
  }

  if (question.type === 'PG_KOMPLEKS') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (id: string) =>
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">Pilih semua jawaban yang benar.</p>
        {(question.choices ?? []).map((c) => (
          <OptionRow key={c.id} multiple active={selected.includes(c.id)} onClick={() => toggle(c.id)}>
            {c.imageUrl ? <UploadImg src={c.imageUrl} alt="" className="mb-1 max-h-40 rounded-lg" /> : null}
            {c.label}
          </OptionRow>
        ))}
      </div>
    );
  }

  if (question.type === 'BENAR_SALAH') {
    const answers = (typeof value === 'object' && value !== null ? value : {}) as Record<string, boolean>;
    return (
      <div className="flex flex-col gap-3">
        {(question.statements ?? []).map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-white/10">
            <p className="flex-1 text-sm">{s.text}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...answers, [s.id]: true })}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-bold',
                  answers[s.id] === true ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-white/10',
                )}
              >
                Benar
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...answers, [s.id]: false })}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-bold',
                  answers[s.id] === false ? 'bg-red-500 text-white' : 'bg-slate-100 dark:bg-white/10',
                )}
              >
                Salah
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (question.type === 'MATCHING') {
    const mapping = (typeof value === 'object' && value !== null ? value : {}) as Record<string, string>;
    const right = question.pairs?.right ?? [];
    return (
      <div className="flex flex-col gap-3">
        {(question.pairs?.left ?? []).map((l) => (
          <div key={l.id} className="flex items-center gap-3">
            <p className="flex-1 text-sm font-medium">{l.text}</p>
            <select
              className="input-base max-w-[55%]"
              value={mapping[l.id] ?? ''}
              onChange={(e) => {
                const next = { ...mapping };
                if (e.target.value) next[l.id] = e.target.value;
                else delete next[l.id];
                onChange(next);
              }}
            >
              <option value="">— pilih pasangan —</option>
              {right.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.text}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    );
  }

  // ISIAN_SINGKAT
  const text = typeof value === 'string' ? value : '';
  return (
    <input
      className="input-base"
      placeholder="Ketik jawaban Anda…"
      value={text}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
    />
  );
}
