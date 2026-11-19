import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@cbt/shared';
import { ROLES, ROLE_LABEL } from '@cbt/shared';
import { apiDownload, apiFetch } from '../../lib/api';
import type { Paged } from '../../lib/api';
import { ApiError } from '../../lib/api';
import { Badge, Button, Card, TextInput } from '../../components/ui';
import { ActiveBadge, ErrorBanner, Modal, Pagination, Select, TableWrap, Td, Th } from '../../components/admin';
import { useAuth } from '../../auth/AuthContext';
import { UserFormModal } from './UserFormModal';
import { UserImportModal } from './UserImportModal';
import type { ImportResult } from './UserImportModal';

export interface AdminUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  nisn: string | null;
  isActive: boolean;
  schoolId?: string | null;
  school?: { id: string; slug: string; name: string } | null;
  kelasId: string | null;
  kelas: { id: string; name: string } | null;
  /** Ruang ujian milik siswa (bukan kelas). */
  ruang: string | null;
}

export interface KelasOpt {
  id: string;
  name: string;
}

export const EMPTY_FORM = { username: '', password: '', name: '', role: 'SISWA' as Role, nisn: '', kelasId: '', ruang: '' };
export type UserForm = typeof EMPTY_FORM;

export function AdminUsers() {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [roleF, setRoleF] = useState('');
  const [activeF, setActiveF] = useState('');
  const [kelasOpts, setKelasOpts] = useState<KelasOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'create' | 'edit' | 'reset' | 'import' | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [editId, setEditId] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const limit = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (q.trim()) params.set('search', q.trim());
      if (roleF) params.set('role', roleF);
      if (activeF) params.set('isActive', activeF);
      const res = await apiFetch<Paged<AdminUser>>(`/users?${params}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat pengguna');
    } finally {
      setLoading(false);
    }
  }, [page, q, roleF, activeF]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<KelasOpt[]>('/kelas')
      .then((k) => setKelasOpts(k.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => undefined);
  }, []);
  function openCreate() {
    setForm(EMPTY_FORM);
    setModal('create');
  }

  function openEdit(u: AdminUser) {
    setEditId(u.id);
    setForm({ username: u.username, password: '', name: u.name, role: u.role, nisn: u.nisn ?? '', kelasId: u.kelasId ?? '', ruang: u.ruang ?? '' });
    setEditActive(u.isActive);
    setModal('edit');
  }

  function openReset(u: AdminUser) {
    setEditId(u.id);
    setForm({ ...EMPTY_FORM, username: u.username, name: u.name });
    setNewPw('');
    setModal('reset');
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await apiFetch(`/users/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus pengguna');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function toggleActive(u: AdminUser) {
    setError('');
    try {
      await apiFetch(`/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengubah status');
    }
  }

  function onDownloadTemplate() {
    apiDownload('/users/import/template', 'template-import-pengguna.xlsx').catch((e: unknown) =>
      setError(e instanceof ApiError ? e.message : 'Unduhan gagal'),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-extrabold">Pengguna</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Kelola akun admin, guru, siswa (NISN), dan proktor.
            </p>
          </div>
          <Button type="button" variant="ghost" onClick={onDownloadTemplate}>
            Template Excel
          </Button>
          <Button type="button" variant="gold" onClick={() => { setImportResult(null); setModal('import'); }}>
            Import Excel
          </Button>
          <Button type="button" onClick={openCreate}>
            + Pengguna
          </Button>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      <Card>
        <form
          className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(search);
          }}
        >
          <TextInput label="Cari" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nama / username / NISN" />
          <Select label="Role" value={roleF} onChange={(e) => { setRoleF(e.target.value); setPage(1); }}>
            <option value="">Semua</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </Select>
          <Select label="Status" value={activeF} onChange={(e) => { setActiveF(e.target.value); setPage(1); }}>
            <option value="">Semua</option>
            <option value="true">Aktif</option>
            <option value="false">Nonaktif</option>
          </Select>
          <div className="flex items-end">
            <Button type="submit" className="w-full">Cari</Button>
          </div>
        </form>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Tidak ada pengguna yang cocok.</p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Username / NISN</Th>
                  <Th>Nama</Th>
                  <Th>Role</Th>
                  <Th>Kelas</Th>
                  <Th>Ruang</Th>
                  {me?.role === 'ADMIN' ? <Th>Sekolah</Th> : null}
                  <Th>Status</Th>
                  <Th>Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <p className="font-bold">{u.username}</p>
                      {u.nisn && u.nisn !== u.username ? <p className="text-xs text-slate-500">{u.nisn}</p> : null}
                    </Td>
                    <Td>{u.name}</Td>
                    <Td><Badge>{ROLE_LABEL[u.role]}</Badge></Td>
                    <Td>{u.kelas?.name ?? '—'}</Td>
                    <Td>{u.ruang ? <span className="font-semibold">{u.ruang}</span> : '—'}</Td>
                    {me?.role === 'ADMIN' ? <Td><span className="text-xs font-semibold text-brand-700 dark:text-brand-300">{u.school?.name ?? '—'}</span></Td> : null}
                    <Td><ActiveBadge active={u.isActive} /></Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" variant="ghost" onClick={() => openEdit(u)}>Ubah</Button>
                        <Button type="button" variant="ghost" onClick={() => openReset(u)}>Reset PW</Button>
                        <Button type="button" variant={u.isActive ? 'danger' : 'gold'} onClick={() => toggleActive(u)}>
                          {u.isActive ? 'Nonaktif' : 'Aktifkan'}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          disabled={u.id === me?.id}
                          title={u.id === me?.id ? 'Akun sendiri tidak bisa dihapus' : 'Hapus akun permanen'}
                          onClick={() => setDeleteTarget(u)}
                        >
                          Hapus
                        </Button>
                      </div>
                    </Td>
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

      <UserFormModal
        modal={modal === 'import' ? null : modal}
        form={form}
        setForm={setForm}
        editActive={editActive}
        setEditActive={setEditActive}
        newPw={newPw}
        setNewPw={setNewPw}
        busy={busy}
        setBusy={setBusy}
        editId={editId}
        kelasOpts={kelasOpts}
        setError={setError}
        close={() => setModal(null)}
        reload={load}
      />
      {deleteTarget ? (
        <Modal title={`Hapus — ${deleteTarget.username}`} onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Hapus <b>permanen</b> akun <b>{deleteTarget.name}</b> ({ROLE_LABEL[deleteTarget.role]} · {deleteTarget.username})?
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Akun yang sudah dipakai ujian (punya attempt, absensi, kartu, soal, ujian, atau rilis token) tidak bisa
            dihapus — nonaktifkan saja. Tindakan ini tidak bisa dibatalkan.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Batal
            </Button>
            <Button type="button" variant="danger" onClick={onDelete} disabled={deleting}>
              {deleting ? 'Menghapus…' : 'Hapus permanen'}
            </Button>
          </div>
        </Modal>
      ) : null}
      {modal === 'import' ? (
        <UserImportModal
          close={() => setModal(null)}
          result={importResult}
          setResult={setImportResult}
          setError={setError}
          reload={load}
        />
      ) : null}
    </div>
  );
}
