import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import { Button, Card, TextInput } from '../../components/ui';
import { ErrorBanner, Modal, TableWrap, Td, Th } from '../../components/admin';
import { KkmField } from '../../components/KkmField';

interface MapelRow {
  id: string;
  name: string;
  code: string | null;
  kkm: number;
  _count: { exams: number };
}

export function AdminMapel() {
  const [rows, setRows] = useState<MapelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editId, setEditId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await apiFetch<MapelRow[]>('/mapel'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat mapel');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditId('');
    setName('');
    setCode('');
    setModal('create');
  }

  function openEdit(m: MapelRow) {
    setEditId(m.id);
    setName(m.name);
    setCode(m.code ?? '');
    setModal('edit');
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = JSON.stringify({ name: name.trim(), code: code.trim() || null });
      if (modal === 'create') {
        await apiFetch('/mapel', { method: 'POST', body });
      } else {
        await apiFetch(`/mapel/${editId}`, { method: 'PATCH', body });
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan mapel');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(m: MapelRow) {
    if (!window.confirm(`Hapus mapel "${m.name}"?`)) return;
    setError('');
    try {
      await apiFetch(`/mapel/${m.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus mapel');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-extrabold">Mata Pelajaran</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Dipakai guru saat membuat ujian.</p>
          </div>
          <Button type="button" onClick={openCreate}>+ Mapel</Button>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <Card>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Belum ada mapel.</p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Nama</Th>
                <Th>Kode</Th>
                <Th>KKM</Th>
                <Th>Ujian</Th>
                <Th>Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <Td><p className="font-bold">{m.name}</p></Td>
                  <Td>{m.code ?? '—'}</Td>
                  <Td><KkmField mapelId={m.id} kkm={m.kkm} onSaved={load} /></Td>
                  <Td>{m._count.exams}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" onClick={() => openEdit(m)}>Ubah</Button>
                      <Button type="button" variant="danger" onClick={() => onDelete(m)}>Hapus</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {modal ? (
        <Modal title={modal === 'create' ? 'Mapel baru' : 'Ubah mapel'} onClose={() => setModal(null)}>
          <form onSubmit={onSave} className="flex flex-col gap-3">
            <TextInput label="Nama mapel" value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Fisika" />
            <TextInput label="Kode (opsional)" value={code} onChange={(e) => setCode(e.target.value)} placeholder="cth. FIS" />
            <Button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</Button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
