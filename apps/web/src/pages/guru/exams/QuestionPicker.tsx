import { useCallback, useEffect, useState } from 'react';
import type { QuestionType } from '@cbt/shared';
import { QUESTION_TYPE_LABEL } from '@cbt/shared';
import { ApiError, apiFetch } from '../../../lib/api';
import type { Paged } from '../../../lib/api';
import { Badge, Button, TextInput } from '../../../components/ui';
import { Modal } from '../../../components/admin';

interface BankRow {
  id: string;
  type: QuestionType;
  content: string;
  weight: number;
}

export type { BankRow };

export function QuestionPicker({ exclude, onAdd, close }: { exclude: Set<string>; onAdd: (rows: BankRow[]) => void; close: () => void }) {
  const [rows, setRows] = useState<BankRow[]>([]);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ page: '1', limit: '20' });
      if (q.trim()) params.set('search', q.trim());
      const res = await apiFetch<Paged<BankRow>>(`/questions?${params}`);
      setRows(res.data.filter((r) => !exclude.has(r.id)));
    } catch (e) {
      // Jangan samarkan kegagalan request sebagai "bank soal kosong".
      setRows([]);
      setLoadError(e instanceof ApiError ? e.message : 'Gagal memuat bank soal');
    } finally {
      setLoading(false);
    }
  }, [q, exclude]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  return (
    <Modal title="Tambah soal dari bank" onClose={close} wide>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search);
        }}
      >
        <div className="flex-1">
          <TextInput label="Cari soal" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Teks soal…" />
        </div>
        <div className="flex items-end">
          <Button type="submit">Cari</Button>
        </div>
      </form>
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-500">Memuat…</p>
      ) : loadError ? (
        <p className="py-6 text-center text-sm font-medium text-red-600 dark:text-red-400">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Tidak ada soal tersedia.</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-white/10">
                <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} className="mt-1 h-4 w-4 accent-brand-500" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.content}</span>
                  <span className="mt-1 flex gap-1"><Badge>{QUESTION_TYPE_LABEL[r.type]}</Badge><Badge>Bobot {r.weight}</Badge></span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <Button type="button" disabled={picked.length === 0} onClick={() => { onAdd(rows.filter((r) => picked.includes(r.id))); close(); }}>
          Tambah {picked.length > 0 ? `(${picked.length})` : ''}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>Batal</Button>
      </div>
    </Modal>
  );
}
