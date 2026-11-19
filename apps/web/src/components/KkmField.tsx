import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { Button } from './ui';

/**
 * Editor KKM satu mata pelajaran — guru mapel & admin boleh mengubah.
 * KKM dipakai untuk ketuntasan di papan penilaian & ekspor Excel nilai.
 */
export function KkmField({ mapelId, kkm, onSaved }: { mapelId: string; kkm: number; onSaved?: () => void }) {
  const [value, setValue] = useState(String(kkm));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<'ok' | 'err-validate' | 'err-network' | ''>('');

  useEffect(() => {
    setValue(String(kkm));
  }, [kkm]);

  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setMsg('err-validate');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      await apiFetch(`/mapel/${mapelId}/kkm`, { method: 'PATCH', body: JSON.stringify({ kkm: n }) });
      setMsg('ok');
      onSaved?.();
    } catch {
      setMsg('err-network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        max={100}
        step="0.5"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setMsg('');
        }}
        className="input-base w-20"
        aria-label="KKM"
      />
      <Button type="button" variant="ghost" disabled={busy || value.trim() === String(kkm)} onClick={save}>
        {busy ? '…' : 'Simpan'}
      </Button>
      {msg === 'ok' ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Tersimpan</span> : null}
      {msg === 'err-validate' ? <span className="text-xs font-semibold text-red-500">KKM harus 0–100</span> : null}
      {msg === 'err-network' ? <span className="text-xs font-semibold text-red-500">Gagal menyimpan — periksa koneksi</span> : null}
    </div>
  );
}
