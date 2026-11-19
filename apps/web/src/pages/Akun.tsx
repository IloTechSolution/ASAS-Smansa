import { useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { Button, Card, TextInput } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { ApiError, apiFetch } from '../lib/api';

export function Akun() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOk('');
    if (next.length < 6) {
      setError('Password baru minimal 6 karakter');
      return;
    }
    if (next !== confirm) {
      setError('Konfirmasi password tidak sama');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setOk('Password berhasil diganti.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mengganti password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-brand-500/30">
        <h1 className="text-xl font-extrabold">Akun & Password</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {user?.name} · {user?.username}
        </p>
      </Card>
      <Card className="max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextInput
            label="Password saat ini"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
          <TextInput
            label="Password baru"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
          <TextInput
            label="Ulangi password baru"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
          {error ? <p className="text-sm font-medium text-red-500">{error}</p> : null}
          {ok ? <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{ok}</p> : null}
          <Button type="submit" disabled={busy} className="self-start">
            <KeyRound size={16} /> {busy ? 'Menyimpan…' : 'Ganti password'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
