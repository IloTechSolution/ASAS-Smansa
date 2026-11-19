import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import type { Paged } from '../../lib/api';
import { Badge, Button, Card, TextInput } from '../../components/ui';
import { ErrorBanner, Pagination, TableWrap, Td, Th } from '../../components/admin';

interface AuditRow {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  meta: unknown;
  createdAt: string;
  actor: { id: string; username: string; name: string; role: string } | null;
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function AdminAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [qAction, setQAction] = useState('');
  const [entity, setEntity] = useState('');
  const [qEntity, setQEntity] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (qAction.trim()) params.set('action', qAction.trim());
      if (qEntity.trim()) params.set('entity', qEntity.trim());
      const res = await apiFetch<Paged<AuditRow>>(`/audit-logs?${params}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat audit log');
    } finally {
      setLoading(false);
    }
  }, [page, qAction, qEntity]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-xl font-extrabold">Audit Log</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Jejak aksi penting: pengguna, kelas, mapel, konfigurasi.</p>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <Card>
        <form
          className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQAction(action);
            setQEntity(entity);
          }}
        >
          <TextInput label="Aksi" value={action} onChange={(e) => setAction(e.target.value)} placeholder="cth. USER_CREATE" />
          <TextInput label="Entitas" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="cth. User" />
          <div className="flex items-end">
            <Button type="submit" className="w-full">Filter</Button>
          </div>
        </form>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Tidak ada catatan.</p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Waktu</Th>
                  <Th>Aktor</Th>
                  <Th>Aksi</Th>
                  <Th>Entitas</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap">{fmtTime(r.createdAt)}</Td>
                    <Td>{r.actor ? `${r.actor.name} (${r.actor.username})` : '—'}</Td>
                    <Td><Badge>{r.action}</Badge></Td>
                    <Td>{r.entity ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="mt-3">
              <Pagination page={page} limit={limit} total={total} onPage={setPage} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
