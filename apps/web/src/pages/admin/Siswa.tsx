import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiDownload, apiFetch, apiUpload, ApiError } from '../../lib/api';
import type { Paged } from '../../lib/api';
import { Button, Card, TextInput } from '../../components/ui';
import { ActiveBadge, ErrorBanner, Modal, Pagination, Select, TableWrap, Td, Th } from '../../components/admin';
import { useAuth } from '../../auth/AuthContext';

interface AdminUser {
  id: string;
  username: string;
  name: string;
  nisn: string | null;
  isActive: boolean;
  kelasId: string | null;
  kelas: { id: string; name: string } | null;
  ruang: string | null;
}

interface KelasOpt {
  id: string;
  name: string;
}

interface ImportResult {
  total: number;
  success: Array<{ row: number; username: string }>;
  failed: Array<{ row: number; username: string; error: string }>;
  ruangUpdates?: number;
  siswaRuangUpdates?: number;
}

/** Halaman khusus siswa: import Excel (auto-buat kelas) + CRUD siswa. */
export function AdminSiswa() {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [kelasF, setKelasF] = useState('');
  const [activeF, setActiveF] = useState('');
  const [kelasOpts, setKelasOpts] = useState<KelasOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [modal, setModal] = useState<'create' | 'edit' | 'reset' | 'import' | 'bulkDelete' | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ deleted: number; skipped: Array<{ username: string; reason: string }> } | null>(null);

  // form state
  const [nisn, setNisn] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [kelasId, setKelasId] = useState('');
  const [ruang, setRuang] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editId, setEditId] = useState('');
  const [editNisn, setEditNisn] = useState('');
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const limit = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), role: 'SISWA' });
      if (q.trim()) params.set('search', q.trim());
      if (kelasF) params.set('kelasId', kelasF);
      if (activeF) params.set('isActive', activeF);
      const res = await apiFetch<Paged<AdminUser>>(`/users?${params}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat siswa');
    } finally {
      setLoading(false);
    }
  }, [page, q, kelasF, activeF]);

  useEffect(() => {
    load();
  }, [load]);

  const loadKelas = useCallback(() => {
    apiFetch<KelasOpt[]>('/kelas')
      .then(setKelasOpts)
      .catch(() => setKelasOpts([]));
  }, []);

  useEffect(() => {
    loadKelas();
  }, [loadKelas]);

  function openCreate() {
    setNisn('');
    setName('');
    setPassword('');
    setKelasId('');
    setRuang('');
    setModal('create');
  }

  function openEdit(u: AdminUser) {
    setEditId(u.id);
    setEditNisn(u.nisn ?? u.username);
    setName(u.name);
    setKelasId(u.kelasId ?? '');
    setRuang(u.ruang ?? '');
    setEditActive(u.isActive);
    setModal('edit');
  }

  function openReset(u: AdminUser) {
    setEditId(u.id);
    setName(u.name);
    setNewPw('');
    setModal('reset');
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: nisn.trim(),
          password,
          name: name.trim(),
          role: 'SISWA',
          nisn: nisn.trim(),
          kelasId: kelasId || null,
          ruang: ruang.trim() || null,
        }),
      });
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat siswa');
    } finally {
      setBusy(false);
    }
  }

  async function onEdit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/users/${editId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          nisn: editNisn.trim() || null,
          kelasId: kelasId || null,
          ruang: ruang.trim() || null,
          isActive: editActive,
        }),
      });
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan perubahan');
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/users/${editId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: newPw }),
      });
      setModal(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mereset password');
    } finally {
      setBusy(false);
    }
  }

  async function onImport(e: FormEvent) {
    e.preventDefault();
    if (!importFile) {
      setError('Pilih file Excel dulu');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await apiUpload<ImportResult>('/users/import/siswa', formData);
      setImportResult(res);
      setImportFile(null);
      loadKelas();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import gagal');
    } finally {
      setImporting(false);
    }
  }

  function onDownloadTemplate() {
    apiDownload('/users/import/siswa/template', 'template-import-siswa.xlsx').catch((e: unknown) =>
      setError(e instanceof ApiError ? e.message : 'Unduhan gagal'),
    );
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

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await apiFetch(`/users/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      load();
      loadKelas();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus siswa');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function onBulkDelete() {
    setBulkBusy(true);
    setError('');
    setBulkResult(null);
    try {
      const res = await apiFetch<{ deleted: number; skipped: Array<{ username: string; reason: string }> }>(
        '/users/siswa/bulk',
        { method: 'DELETE', body: JSON.stringify({ confirm: 'HAPUS SEMUA SISWA' }) },
      );
      setBulkResult(res);
      setBulkConfirm('');
      load();
      loadKelas();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Hapus semua siswa gagal');
      setModal(null);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-extrabold">Siswa</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Kelola siswa: impor Excel (kelas dibuat otomatis) atau tambah manual. NISN = username. Kolom Ruang mengatur Ruang Ujian kelasnya.
            </p>
          </div>
          <Button type="button" variant="ghost" onClick={onDownloadTemplate}>
            Template Excel
          </Button>
          <Button
            type="button"
            variant="gold"
            onClick={() => {
              setImportResult(null);
              setImportFile(null);
              setModal('import');
            }}
          >
            Import Excel
          </Button>
          <Button type="button" onClick={openCreate}>
            + Siswa
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              setBulkResult(null);
              setBulkConfirm('');
              setModal('bulkDelete');
            }}
          >
            Hapus Semua Siswa
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
          <TextInput label="Cari" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nama / NISN" />
          <Select label="Kelas" value={kelasF} onChange={(e) => { setKelasF(e.target.value); setPage(1); }}>
            <option value="">Semua</option>
            {kelasOpts.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
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
          <p className="py-8 text-center text-sm text-slate-500">
            Belum ada siswa. Impor dari Excel (kolom: NISN | Nama | Password | Kelas | Ruang) — kelas dibuat otomatis, Ruang langsung diterapkan.
          </p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>NISN</Th>
                  <Th>Nama</Th>
                  <Th>Kelas</Th>
                  <Th>Ruang</Th>
                  <Th>Status</Th>
                  <Th>Aksi</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <Td><p className="font-bold">{u.username}</p></Td>
                    <Td>{u.name}</Td>
                    <Td>{u.kelas?.name ?? '—'}</Td>
                    <Td>{u.ruang ? <span className="font-semibold">{u.ruang}</span> : '—'}</Td>
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

      {/* Modal tambah/ubah */}
      {modal === 'create' || modal === 'edit' ? (
        <Modal title={modal === 'create' ? 'Siswa baru' : `Ubah — ${name}`} onClose={() => setModal(null)}>
          <form onSubmit={modal === 'create' ? onCreate : onEdit} className="flex flex-col gap-3">
            {modal === 'create' ? (
              <TextInput label="NISN (jadi username)" value={nisn} onChange={(e) => setNisn(e.target.value)} placeholder="10 digit" />
            ) : (
              <TextInput label="NISN" value={editNisn} onChange={(e) => setEditNisn(e.target.value)} />
            )}
            <TextInput label="Nama lengkap" value={name} onChange={(e) => setName(e.target.value)} />
            {modal === 'create' ? (
              <TextInput label="Password awal" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 karakter" />
            ) : null}
            <Select label="Kelas" value={kelasId} onChange={(e) => setKelasId(e.target.value)}>
              <option value="">— Pilih kelas —</option>
              {kelasOpts.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </Select>
            <TextInput label="Ruang ujian (opsional)" value={ruang} onChange={(e) => setRuang(e.target.value)} placeholder="cth. Lab 1 atau 20" />
            {modal === 'edit' ? (
              <Select label="Status" value={editActive ? 'true' : 'false'} onChange={(e) => setEditActive(e.target.value === 'true')}>
                <option value="true">Aktif</option>
                <option value="false">Nonaktif</option>
              </Select>
            ) : null}
            <Button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</Button>
          </form>
        </Modal>
      ) : null}

      {/* Modal reset password */}
      {modal === 'reset' ? (
        <Modal title={`Reset password — ${name}`} onClose={() => setModal(null)}>
          <form onSubmit={onReset} className="flex flex-col gap-3">
            <TextInput label="Password baru" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min. 6 karakter" />
            <Button type="submit" disabled={busy}>{busy ? 'Memproses…' : 'Reset password'}</Button>
          </form>
        </Modal>
      ) : null}

      {/* Modal import */}
      {modal === 'import' ? (
        <Modal title="Import siswa (Excel)" onClose={() => setModal(null)} wide>
          <form onSubmit={onImport} className="flex flex-col gap-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Kolom: <b>NISN | Nama | Password | Kelas | Ruang</b>. NISN = username. Kelas yang belum ada dibuat otomatis
              (tahun ajaran dari Konfigurasi). Kolom <b>Ruang</b> opsional — langsung mengatur/memperbarui Ruang Ujian
              kelas saat import (cocok untuk pembagian ruang massal; impor ulang file yang sama hanya untuk
              memperbarui ruang, baris duplikat tidak dibuat ulang). Baris dengan NISN sudah terpakai/duplikat
              dilaporkan gagal.
            </p>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="input-base"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
            <Button type="submit" disabled={importing || !importFile}>
              {importing ? 'Mengimpor…' : 'Impor'}
            </Button>
          </form>
          {importResult ? (
            <div className="mt-4 text-sm">
              <p className="font-bold">
                Hasil: {importResult.success.length} berhasil, {importResult.failed.length} gagal (dari {importResult.total})
                {importResult.siswaRuangUpdates ? ` · ${importResult.siswaRuangUpdates} ruang siswa diperbarui` : ''}
                {importResult.ruangUpdates ? ` · ${importResult.ruangUpdates} ruang kelas diperbarui` : ''}
              </p>
              {importResult.failed.length > 0 ? (
                <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {importResult.failed.map((f) => (
                    <li key={f.row} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-red-500">
                      Baris {f.row} ({f.username}): {f.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Modal>
      ) : null}

      {/* Modal hapus semua siswa */}
      {modal === 'bulkDelete' ? (
        <Modal title="Hapus SEMUA siswa" onClose={() => setModal(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Ini menghapus <b>semua akun siswa</b> di sekolah aktif — permanen, semua kelas menjadi kosong.
            Siswa yang punya rekaman ujian (attempt/absensi) <b>dilewati</b> dan dilaporkan, tidak ikut terhapus.
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Ketik <b>HAPUS SEMUA SISWA</b> untuk konfirmasi.
          </p>
          <input
            className="input-base mt-3"
            value={bulkConfirm}
            onChange={(e) => setBulkConfirm(e.target.value)}
            placeholder="HAPUS SEMUA SISWA"
            aria-label="Konfirmasi hapus semua siswa"
          />
          {bulkResult ? (
            <div className="mt-3 text-sm">
              <p className="font-bold text-emerald-600 dark:text-emerald-400">
                {bulkResult.deleted} siswa dihapus.
              </p>
              {bulkResult.skipped.length > 0 ? (
                <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {bulkResult.skipped.map((s) => (
                    <li key={s.username} className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-amber-700 dark:text-amber-300">
                      Dilewati {s.username}: {s.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setModal(null)}>Tutup</Button>
            <Button
              type="button"
              variant="danger"
              disabled={bulkBusy || bulkConfirm !== 'HAPUS SEMUA SISWA'}
              onClick={onBulkDelete}
            >
              {bulkBusy ? 'Menghapus…' : 'Hapus semua siswa'}
            </Button>
          </div>
        </Modal>
      ) : null}

      {/* Konfirmasi hapus */}
      {deleteTarget ? (
        <Modal title={`Hapus — ${deleteTarget.username}`} onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Hapus <b>permanen</b> akun <b>{deleteTarget.name}</b> (NISN {deleteTarget.username})?
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Akun yang sudah dipakai ujian tidak bisa dihapus — nonaktifkan saja.
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

    </div>
  );
}
