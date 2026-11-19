import type { QuestionType } from '@cbt/shared';

export interface Choice {
  id: string;
  label: string;
  /** Gambar opsi (opsional) — tersimpan sebagai URL /uploads/questions/<file>. */
  imageUrl?: string | null;
}

export interface PairSide {
  id: string;
  text: string;
}

export interface Statement {
  id: string;
  text: string;
  answer: boolean;
}

/** Bentuk form soal di client (sejalan Zod shared). */
export interface QuestionFormState {
  type: QuestionType;
  content: string;
  weight: number;
  scoringMode: 'ALL_OR_NOTHING' | 'PROPORSIONAL';
  explanation: string;
  choices: Choice[];
  correctChoices: string[];
  left: PairSide[];
  right: PairSide[];
  mapping: Record<string, string>;
  statements: Statement[];
  acceptedAnswers: string[];
}

export function newId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

export function blankForm(type: QuestionType): QuestionFormState {
  return {
    type,
    content: '',
    weight: 1,
    scoringMode: 'ALL_OR_NOTHING',
    explanation: '',
    choices: [
      { id: newId('c'), label: '' },
      { id: newId('c'), label: '' },
    ],
    correctChoices: [],
    left: [
      { id: newId('l'), text: '' },
      { id: newId('l'), text: '' },
    ],
    right: [
      { id: newId('r'), text: '' },
      { id: newId('r'), text: '' },
    ],
    mapping: {},
    statements: [
      { id: newId('s'), text: '', answer: true },
      { id: newId('s'), text: '', answer: false },
    ],
    acceptedAnswers: [''],
  };
}

/** Ubah entity API menjadi state form. */
export function fromEntity(q: {
  type: QuestionType;
  content: string;
  weight: number;
  scoringMode: 'ALL_OR_NOTHING' | 'PROPORSIONAL';
  explanation: string | null;
  choices: unknown;
  correctChoices: unknown;
  pairs: unknown;
  statements: unknown;
  acceptedAnswers: unknown;
}): QuestionFormState {
  const base = blankForm(q.type);
  base.content = q.content;
  base.weight = q.weight;
  base.scoringMode = q.scoringMode;
  base.explanation = q.explanation ?? '';
  if (Array.isArray(q.choices)) base.choices = q.choices as Choice[];
  if (Array.isArray(q.correctChoices)) base.correctChoices = q.correctChoices as string[];
  const pairs = q.pairs as { left?: PairSide[]; right?: PairSide[]; mapping?: Record<string, string> } | null;
  if (pairs) {
    if (Array.isArray(pairs.left)) base.left = pairs.left;
    if (Array.isArray(pairs.right)) base.right = pairs.right;
    if (pairs.mapping) base.mapping = pairs.mapping;
  }
  if (Array.isArray(q.statements)) base.statements = q.statements as Statement[];
  if (Array.isArray(q.acceptedAnswers)) base.acceptedAnswers = q.acceptedAnswers as string[];
  return base;
}

/** Ubah state form menjadi payload API (buang field tak relevan). */
export function toPayload(s: QuestionFormState): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: s.type,
    content: s.content.trim(),
    weight: s.weight,
    scoringMode: s.scoringMode,
    explanation: s.explanation.trim() || null,
  };
  switch (s.type) {
    case 'PG':
    case 'PG_KOMPLEKS':
      return { ...base, choices: s.choices, correctChoices: s.correctChoices };
    case 'MATCHING':
      return { ...base, pairs: { left: s.left, right: s.right, mapping: s.mapping } };
    case 'BENAR_SALAH':
      return { ...base, statements: s.statements };
    case 'ISIAN_SINGKAT':
      return { ...base, acceptedAnswers: s.acceptedAnswers.map((a) => a.trim()).filter(Boolean) };
  }
}
