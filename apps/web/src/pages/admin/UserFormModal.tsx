import type { FormEvent } from 'react';
import type { Role } from '@cbt/shared';
import { ROLES, ROLE_LABEL } from '@cbt/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { Button, TextInput } from '../../components/ui';
import { Modal, Select } from '../../components/admin';
import type { KelasOpt, UserForm } from './Users';

interface Props {
  modal: 'create' | 'edit' | 'reset' | null;
  form: UserForm;
  setForm: (f: UserForm) => void;
  editActive: boolean;
  setEditActive: (v: boolean) => void;
  newPw: string;
  setNewPw: (v: string) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  editId: string;
  kelasOpts: KelasOpt[];
  setError: (m: string) => void;
  close: () => void;
  reload: () => void;
}

export function UserFormModal(p: Props) {
  if (!p.modal) return null;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    p.setBusy(true);
    p.setError('');
    try {
      await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: p.form.username.trim(),
          password: p.form.password,
          name: p.form.name.trim(),
          role: p.form.role,
          nisn: p.form.nisn.trim() || null,
          kelasId: p.form.kelasId || null,
          ruang: p.form.ruang.trim() || null,
        }),
      });
      p.close();
      p.reload();
    } catch (err) {
      p.setError(err instanceof ApiError ? err.message : 'Gagal membuat pengguna');
    } finally {
      p.setBusy(false);
    }
  }

  async function onEdit(e: FormEvent) {
    e.preventDefault();
    p.setBusy(true);
    p.setError('');
    try {
      await apiFetch(`/users/${p.editId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: p.form.name.trim(),
          role: p.form.role,
          nisn: p.form.nisn.trim() || null,
          kelasId: p.form.kelasId || null,
          ruang: p.form.ruang.trim() || null,
          isActive: p.editActive,
        }),
      });
      p.close();
      p.reload();
    } catch (err) {
      p.setError(err instanceof ApiError ? err.message : 'Gagal menyimpan perubahan');
    } finally {
      p.setBusy(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    p.setBusy(true);
    p.setError('');
    try {
      await apiFetch(`/users/${p.editId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: p.newPw }),
      });
      p.close();
    } catch (err) {
      p.setError(err instanceof ApiError ? err.message : 'Gagal mereset password');
    } finally {
      p.setBusy(false);
    }
  }

  if (p.modal === 'reset') {
    return (
      <Modal title={`Reset password — ${p.form.username}`} onClose={p.close}>
        <form onSubmit={onReset} className="flex flex-col gap-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Password lama langsung diganti. Sampaikan password baru ke {p.form.name} lewat jalur aman.
          </p>
          <TextInput label="Password baru" type="password" value={p.newPw} onChange={(e) => p.setNewPw(e.target.value)} placeholder="Min. 6 karakter" />
          <Button type="submit" disabled={p.busy}>{p.busy ? 'Memproses…' : 'Reset password'}</Button>
        </form>
      </Modal>
    );
  }

  const isCreate = p.modal === 'create';
  return (
    <Modal title={isCreate ? 'Pengguna baru' : `Ubah — ${p.form.username}`} onClose={p.close}>
      <form onSubmit={isCreate ? onCreate : onEdit} className="flex flex-col gap-3">
        <Select label="Role" value={p.form.role} onChange={(e) => p.setForm({ ...p.form, role: e.target.value as Role, ...(isCreate ? { nisn: '', username: '' } : {}) })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </Select>
        {isCreate ? (
          p.form.role === 'SISWA' ? (
            // Siswa: username = NISN (10 digit). Satu isian mengisi keduanya.
            <TextInput
              label="NISN (jadi username)"
              value={p.form.nisn}
              onChange={(e) => p.setForm({ ...p.form, nisn: e.target.value, username: e.target.value })}
              placeholder="10 digit"
            />
          ) : (
            <TextInput label="Username" value={p.form.username} onChange={(e) => p.setForm({ ...p.form, username: e.target.value })} placeholder="cth. guru3" />
          )
        ) : (
          <TextInput label="NISN (kosongkan bila bukan siswa)" value={p.form.nisn} onChange={(e) => p.setForm({ ...p.form, nisn: e.target.value })} />
        )}
        <TextInput label="Nama lengkap" value={p.form.name} onChange={(e) => p.setForm({ ...p.form, name: e.target.value })} />
        {isCreate ? (
          <TextInput label="Password awal" type="password" value={p.form.password} onChange={(e) => p.setForm({ ...p.form, password: e.target.value })} placeholder="Min. 6 karakter" />
        ) : null}
        {p.form.role === 'SISWA' || !isCreate ? (
          <Select label="Kelas" value={p.form.kelasId} onChange={(e) => p.setForm({ ...p.form, kelasId: e.target.value })}>
            <option value="">— {isCreate ? 'Pilih kelas' : 'Tanpa kelas'} —</option>
            {p.kelasOpts.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </Select>
        ) : null}
        {p.form.role === 'SISWA' ? (
          <TextInput
            label="Ruang ujian (opsional)"
            value={p.form.ruang}
            onChange={(e) => p.setForm({ ...p.form, ruang: e.target.value })}
            placeholder="cth. Lab 1 atau 20"
          />
        ) : null}
        {!isCreate ? (
          <Select label="Status" value={p.editActive ? 'true' : 'false'} onChange={(e) => p.setEditActive(e.target.value === 'true')}>
            <option value="true">Aktif</option>
            <option value="false">Nonaktif</option>
          </Select>
        ) : null}
        <Button type="submit" disabled={p.busy}>{p.busy ? 'Menyimpan…' : 'Simpan'}</Button>
      </form>
    </Modal>
  );
}
