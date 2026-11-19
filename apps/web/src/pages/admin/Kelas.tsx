import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import { Button, Card, TextInput } from '../../components/ui';
import { ErrorBanner, Modal, Select, TableWrap, Td, Th } from '../../components/admin';

interface KelasRow {
  id: string;
  name: string;
  tingkat: string | null;
  tahunAjaran: string;
  ruang: string | null;
  _count: { users: number; sessionLinks: number };
}

export function AdminKelas() {
  const [rows, setRows] = useState<KelasRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editId, setEditId] = useState('');
  const [name, setName] = useState('');
  const [tingkat, setTingkat] = useState('');
  const [tahunAjaran, setTahunAjaran] = useState('');
  const [ruang, setRuang] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await apiFetch<KelasRow[]>('/kelas'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat kelas');
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
    setTingkat('X');
    setTahunAjaran('2026/2027');
    setRuang('');
    setModal('create');
  }

  function openEdit(k: KelasRow) {
    setEditId(k.id);
    setName(k.name);
    setTingkat(k.tingkat ?? '');
    setTahunAjaran(k.tahunAjaran);
    setRuang(k.ruang ?? '');
    setModal('edit');
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = JSON.stringify({
        name: name.trim(),
        tingkat: tingkat || null,
        tahunAjaran: tahunAjaran.trim(),
        ruang: ruang.trim() || null,
      });
      if (modal === 'create') {
        await apiFetch('/kelas', { method: 'POST', body });
      } else {
        await apiFetch(`/kelas/${editId}`, { method: 'PATCH', body });
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan kelas');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(k: KelasRow) {
    if (!window.confirm(`Hapus kelas "${k.name}"?\n\nSiswa di kelas ini menjadi tanpa kelas (akun & data ujian tetap ada) dan tautan kelas di sesi akan dihapus. Tindakan ini tidak bisa dibatalkan.`)) return;
    setError('');
    try {
      await apiFetch(`/kelas/${k.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus kelas');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-extrabold">Kelas</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Data kelas per sekolah. Kolom <b>Ruang</b> dicetak di Kartu Login.
            </p>
          </div>
          <Button type="button" onClick={openCreate}>+ Kelas</Button>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <Card>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Belum ada kelas.</p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Nama</Th>
                <Th>Tingkat</Th>
                <Th>Tahun Ajaran</Th>
                <Th>Ruang Ujian</Th>
                <Th>Siswa</Th>
                <Th>Sesi</Th>
                <Th>Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.id}>
                  <Td><p className="font-bold">{k.name}</p></Td>
                  <Td>{k.tingkat ?? '—'}</Td>
                  <Td>{k.tahunAjaran}</Td>
                  <Td>{k.ruang ?? '—'}</Td>
                  <Td>{k._count.users}</Td>
                  <Td>{k._count.sessionLinks}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" onClick={() => openEdit(k)}>Ubah</Button>
                      <Button type="button" variant="danger" onClick={() => onDelete(k)}>Hapus</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {modal ? (
        <Modal title={modal === 'create' ? 'Kelas baru' : 'Ubah kelas'} onClose={() => setModal(null)}>
          <form onSubmit={onSave} className="flex flex-col gap-3">
            <TextInput label="Nama kelas" value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. X-2" />
            <Select label="Tingkat" value={tingkat} onChange={(e) => setTingkat(e.target.value)}>
              <option value="X">X</option>
              <option value="XI">XI</option>
              <option value="XII">XII</option>
              <option value="">—</option>
            </Select>
            <TextInput label="Tahun ajaran" value={tahunAjaran} onChange={(e) => setTahunAjaran(e.target.value)} placeholder="cth. 2026/2027" />
            <TextInput label="Ruang ujian (opsional)" value={ruang} onChange={(e) => setRuang(e.target.value)} placeholder="cth. 20" />
            <Button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</Button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
