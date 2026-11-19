import type { QuestionType } from '@cbt/shared';
import { QUESTION_TYPE_LABEL } from '@cbt/shared';
import { Badge, Card } from '../../components/ui';
import { Modal } from '../../components/admin';
import { UploadImg } from '../../components/UploadImg';
import type { Choice, PairSide, Statement } from './types';

export interface PreviewData {
  type: QuestionType;
  content: string;
  imageUrl: string | null;
  weight: number;
  maxScore?: number;
  usageCount?: number;
  choices: Choice[] | null;
  correctChoices: string[] | null;
  pairs: { left: PairSide[]; right: PairSide[]; mapping: Record<string, string> } | null;
  statements: Statement[] | null;
  acceptedAnswers: string[] | null;
  explanation: string | null;
}

export function QuestionPreview({ q, close }: { q: PreviewData; close: () => void }) {
  const rightById = new Map((q.pairs?.right ?? []).map((r) => [r.id, r.text]));
  return (
    <Modal title="Pratinjau soal" onClose={close} wide>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{QUESTION_TYPE_LABEL[q.type]}</Badge>
          <Badge>Bobot {q.weight}</Badge>
          {q.maxScore !== undefined ? <Badge>Skor maks {q.maxScore}</Badge> : null}
          {q.usageCount !== undefined ? <Badge>Dipakai {q.usageCount} ujian</Badge> : null}
        </div>
        <p className="whitespace-pre-wrap font-medium">{q.content}</p>
        {q.imageUrl ? <UploadImg src={q.imageUrl} alt="Gambar soal" className="max-h-64 rounded-xl border border-slate-200 dark:border-white/10" /> : null}

        {q.choices ? (
          <div className="flex flex-col gap-1.5">
            {q.choices.map((c, i) => (
              <div key={c.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{String.fromCharCode(65 + i)}.</span>
                  <span>{c.label}</span>
                  {q.correctChoices?.includes(c.id) ? <span className="ml-auto font-bold text-emerald-500">✓ kunci</span> : null}
                </div>
                {c.imageUrl ? (
                  <div className="mt-1.5">
                    <UploadImg src={c.imageUrl} alt={`Gambar opsi ${String.fromCharCode(65 + i)}`} className="max-h-32 rounded-lg border border-slate-200 dark:border-white/10" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {q.pairs ? (
          <div className="flex flex-col gap-1.5 text-sm">
            {q.pairs.left.map((l) => (
              <p key={l.id} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10">
                {l.text} <span className="font-bold">↔ {rightById.get(q.pairs?.mapping[l.id] ?? '') ?? '?'}</span>
              </p>
            ))}
          </div>
        ) : null}

        {q.statements ? (
          <div className="flex flex-col gap-1.5 text-sm">
            {q.statements.map((st) => (
              <p key={st.id} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10">
                {st.text} — <span className="font-bold text-emerald-500">{st.answer ? 'Benar' : 'Salah'}</span>
              </p>
            ))}
          </div>
        ) : null}

        {q.acceptedAnswers ? (
          <p className="text-sm">Kunci: <span className="font-bold text-emerald-500">{q.acceptedAnswers.join(' / ')}</span></p>
        ) : null}

        {q.explanation ? (
          <Card><p className="text-sm font-bold">Pembahasan</p><p className="mt-1 whitespace-pre-wrap text-sm">{q.explanation}</p></Card>
        ) : null}
      </div>
    </Modal>
  );
}
