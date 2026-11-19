import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EyeOff, Save } from 'lucide-react';
import { Badge, Button, Card } from '../../components/ui';
import { ApiError, apiFetch } from '../../lib/api';

interface TokenSnapshot {
  token?: string;
  status?: string;
  intervalSec?: number;
  expiresInSec?: number;
  serverTime?: string;
}

interface SessionMeta {
  title: string | null;
  tokenIntervalSec: number;
  visibleToSiswa: boolean;
  exam?: { title?: string };
}

export default function TokenPanel({ sessionId: sessionIdProp }: { sessionId?: string }) {
  const { sessionId: sessionIdParam } = useParams();
  const sessionId = sessionIdProp || sessionIdParam || '';
  const [snap, setSnap] = useState<TokenSnapshot | null>(null);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [intervalSec, setIntervalSec] = useState(120);
  const [left, setLeft] = useState(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [released, setReleased] = useState('');
  const [savingInterval, setSavingInterval] = useState(false);
  const nav = useNavigate();

  // apiFetch otomatis refresh access token 15-menit — panel tetap hidup
  // selama ujian berjam-jam (fetch mentah mati diam-diam saat 401).
  const load = useCallback(() => {
    if (!sessionId) return;
    setError('');
    apiFetch<TokenSnapshot>(`/sessions/${sessionId}/token/current`)
      .then((d) => {
        setSnap(d);
        if (typeof d.expiresInSec === 'number') setLeft(d.expiresInSec);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal memuat token'));
    apiFetch<SessionMeta>(`/sessions/${sessionId}`)
      .then((d) => {
        setMeta(d);
        setIntervalSec(d.tokenIntervalSec);
      })
      .catch(() => undefined);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // Token bergilir tiap interval — hitung mundur & muat ulang otomatis saat habis.
  useEffect(() => {
    const id = setInterval(() => setLeft((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    // Setelah hitung mundur mencapai 0, ambil snapshot baru dari server.
    if (left === 0 && snap) load();
  }, [left, snap, load]);

  const visible = meta?.visibleToSiswa ?? false;
  const title = meta?.title ?? meta?.exam?.title ?? '';

  const release = () => {
    setError('');
    setReleased('');
    apiFetch<TokenSnapshot>(`/sessions/${sessionId}/token/release`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    })
      .then((d) => {
        setSnap(d);
        if (typeof d.expiresInSec === 'number') setLeft(d.expiresInSec);
        setReleased('Token dirilis & tercatat di audit.');
        setNote('');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal merilis token'));
  };

  const saveInterval = async () => {
    setSavingInterval(true);
    setError('');
    try {
      const updated = await apiFetch<{ tokenIntervalSec: number }>(`/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ tokenIntervalSec: intervalSec }),
      });
      setMeta((m) => (m ? { ...m, tokenIntervalSec: updated.tokenIntervalSec ?? intervalSec } : m));
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menyimpan interval');
    } finally {
      setSavingInterval(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <h2 className="text-xl font-extrabold">Panel Token Proktor</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          {title ? <span className="font-semibold">{title}</span> : null}
          {title ? ' · ' : null}
          {visible ? (
            <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">Tampil ke siswa</Badge>
          ) : (
            <Badge className="border-amber-500/40 text-amber-600 dark:text-amber-300">Tersembunyi</Badge>
          )}
        </p>

        {!visible ? (
          <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300">
            <EyeOff size={16} className="mr-1 inline" />
            Ujian ini belum tampil ke siswa. Token hanya bisa dirilis setelah ujian <b>ditampilkan ke siswa</b> (tombol di paling atas panel pelaksanaan).
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p> : null}
        {released ? <p className="mt-3 text-sm font-medium text-emerald-600 dark:text-emerald-400">{released}</p> : null}

        <div className="mt-4 rounded-xl border-2 border-brand-500/30 bg-brand-500/5 p-4 text-center">
          <div className="text-xs font-bold uppercase tracking-wider text-brand-600 dark:text-brand-300">Token Saat Ini</div>
          <div className="mt-1 font-mono text-4xl font-bold tracking-[0.2em] text-brand-700 dark:text-brand-200">
            {visible ? snap?.token ?? '——————' : '••••••'}
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Bergilir otomatis tiap <b>{meta?.tokenIntervalSec ?? intervalSec} dtk</b> · tersisa <b className="tabular-nums">{left} dtk</b>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0">
            <label htmlFor="token-interval" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Interval token (detik)
            </label>
            <input
              id="token-interval"
              type="number"
              min={30}
              max={600}
              value={intervalSec}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
              className="input-base w-36"
            />
          </div>
          <Button type="button" variant="ghost" onClick={saveInterval} disabled={savingInterval || intervalSec < 30}>
            <Save size={16} /> {savingInterval ? 'Menyimpan…' : 'Simpan interval'}
          </Button>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan rilis (opsional)"
            className="flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-white/10"
            disabled={!visible}
          />
          <Button onClick={release} disabled={!visible}>Rilis Token</Button>
        </div>
        <button type="button" onClick={() => nav('/app/proktor/sesi')} className="mt-3 text-sm font-medium text-brand-600 underline dark:text-brand-300">
          Kembali ke daftar sesi
        </button>
      </Card>
    </div>
  );
}
