import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CONFIG_KEYS } from '@cbt/shared';
import type { ConfigKey } from '@cbt/shared';
import { apiBlob, apiFetch, apiUpload, ApiError, schoolSelector } from '../../lib/api';
import { Button, Card, TextInput } from '../../components/ui';
import { ErrorBanner } from '../../components/admin';
import { useAuth } from '../../auth/AuthContext';

const LABEL: Partial<Record<ConfigKey, { label: string; hint: string }>> = {
  TOKEN_DEFAULT_INTERVAL_SEC: { label: 'Interval token (detik)', hint: '30–600.' },
  MAX_VIOLATIONS_DEFAULT: { label: 'Batas pelanggaran', hint: '0–20 per sesi.' },
  REQUIRE_SEB_DEFAULT: { label: 'Wajib SEB', hint: '"true" / "false".' },
  KKM_DEFAULT: { label: 'KKM default', hint: '0–100.' },
  TAHUN_AJARAN: { label: 'Tahun ajaran aktif', hint: 'Format YYYY/YYYY.' },
};

type BrandingKind = 'logo' | 'ttd' | 'stamp';
const BRANDING_ROWS: Array<{ kind: BrandingKind; label: string; hint: string }> = [
  { kind: 'logo', label: 'Logo sekolah', hint: 'Tampil di Kartu Login & header (PNG/JPG, maks 2MB). Tanpa logo = tanda "1&8".' },
  { kind: 'ttd', label: 'Tanda tangan kepala sekolah', hint: 'Digambar di Kartu Login di atas nama kepala sekolah.' },
  { kind: 'stamp', label: 'Stempel sekolah', hint: 'Digambar di Kartu Login di belakang tanda tangan.' },
];

interface SchoolRow {
  id: string;
  slug: string;
  name: string;
  appName: string;
  headmasterName: string | null;
  headmasterNip: string | null;
  logoPath: string | null;
  ttdPath: string | null;
  stampPath: string | null;
}

export function AdminSettings() {
  const { user } = useAuth();
  const aggregate = user?.role === 'ADMIN' && !schoolSelector();

  const [values, setValues] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [school, setSchool] = useState<SchoolRow | null>(null);
  const [identity, setIdentity] = useState({ name: '', appName: '', headmasterName: '', headmasterNip: '' });
  const [previews, setPreviews] = useState<Partial<Record<BrandingKind, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState<ConfigKey | 'school' | null>(null);
  const [brandBusy, setBrandBusy] = useState<BrandingKind | null>(null);
  const [sebPin, setSebPin] = useState<{ configured: boolean; updatedAt: string | null }>({ configured: false, updatedAt: null });
  const [pinDraft, setPinDraft] = useState('');
  const [pinBusy, setPinBusy] = useState<'save' | 'clear' | null>(null);
  const fileRefs = useRef<Partial<Record<BrandingKind, HTMLInputElement | null>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ keys: ConfigKey[]; values: Record<string, string>; school: SchoolRow | null }>('/settings');
      setValues(res.values);
      setDrafts(res.values);
      setSchool(res.school ?? null);
      if (res.school) {
        setIdentity({
          name: res.school.name,
          appName: res.school.appName,
          headmasterName: res.school.headmasterName ?? '',
          headmasterNip: res.school.headmasterNip ?? '',
        });
      }
      try {
        setSebPin(await apiFetch<{ configured: boolean; updatedAt: string | null }>('/settings/seb-exit-pin'));
      } catch {
        setSebPin({ configured: false, updatedAt: null });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat konfigurasi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (aggregate) {
      setLoading(false);
      return;
    }
    load();
  }, [load, aggregate]);

  // Pratinjau gambar branding (blob terautentikasi).
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    const jobs = (['logo', 'ttd', 'stamp'] as BrandingKind[]).map(async (kind) => {
      const key = kind === 'logo' ? school?.logoPath : kind === 'ttd' ? school?.ttdPath : school?.stampPath;
      if (!key) return;
      try {
        const blob = await apiBlob(`/settings/branding/${kind}`);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        if (alive) setPreviews((p) => ({ ...p, [kind]: url }));
      } catch {
        // biarkan placeholder
      }
    });
    void Promise.all(jobs);
    return () => {
      alive = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [school]);

  async function onSaveSebPin(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(pinDraft)) {
      setError('PIN keluar harus 4–8 angka.');
      return;
    }
    setPinBusy('save');
    setError('');
    setOk('');
    try {
      await apiFetch('/settings/seb-exit-pin', { method: 'PUT', body: JSON.stringify({ pin: pinDraft }) });
      setSebPin({ configured: true, updatedAt: new Date().toISOString() });
      setPinDraft('');
      setOk('PIN keluar APK SEB disimpan.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan PIN keluar');
    } finally {
      setPinBusy(null);
    }
  }

  async function onClearSebPin() {
    setPinBusy('clear');
    setError('');
    setOk('');
    try {
      await apiFetch('/settings/seb-exit-pin', { method: 'DELETE' });
      setSebPin({ configured: false, updatedAt: null });
      setPinDraft('');
      setOk('PIN keluar APK SEB dihapus — tombol keluar di APK dinonaktifkan.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus PIN keluar');
    } finally {
      setPinBusy(null);
    }
  }

  async function onSaveSchool(e: FormEvent) {
    e.preventDefault();
    setSaving('school');
    setError('');
    setOk('');
    try {
      const updated = await apiFetch<SchoolRow>('/settings/school', {
        method: 'PATCH',
        body: JSON.stringify({
          name: identity.name.trim(),
          appName: identity.appName.trim(),
          headmasterName: identity.headmasterName.trim() || null,
          headmasterNip: identity.headmasterNip.trim() || null,
        }),
      });
      setSchool(updated);
      setOk('Identitas sekolah disimpan.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan identitas');
    } finally {
      setSaving(null);
    }
  }

  async function onSave(key: ConfigKey, e: FormEvent) {
    e.preventDefault();
    setSaving(key);
    setError('');
    setOk('');
    try {
      await apiFetch('/settings', {
        method: 'PUT',
        body: JSON.stringify({ key, value: drafts[key] ?? '' }),
      });
      setOk(`${LABEL[key]?.label ?? key} disimpan.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan');
    } finally {
      setSaving(null);
    }
  }

  async function onUpload(kind: BrandingKind, file: File | undefined) {
    if (!file) return;
    setBrandBusy(kind);
    setError('');
    setOk('');
    try {
      const form = new FormData();
      form.append('file', file);
      const updated = await apiUpload<SchoolRow>(`/settings/branding/${kind}`, form);
      setSchool(updated);
      setOk('Gambar branding disimpan.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengunggah gambar');
    } finally {
      setBrandBusy(null);
      const input = fileRefs.current[kind];
      if (input) input.value = '';
    }
  }

  async function onDeleteBranding(kind: BrandingKind) {
    setBrandBusy(kind);
    setError('');
    setOk('');
    try {
      const updated = await apiFetch<SchoolRow>(`/settings/branding/${kind}`, { method: 'DELETE' });
      setSchool(updated);
      setPreviews((p) => ({ ...p, [kind]: undefined }));
      setOk('Gambar dihapus.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menghapus gambar');
    } finally {
      setBrandBusy(null);
    }
  }

  if (aggregate) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <h1 className="text-xl font-extrabold">Konfigurasi Sekolah</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pengaturan terpisah per sekolah.</p>
        </Card>
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300">
          Mode Semua Sekolah — pilih sekolah di kanan atas untuk mengatur identitas &amp; konfigurasi sekolah itu.
        </p>
      </div>
    );
  }

  const configKeys = CONFIG_KEYS.filter((k) => LABEL[k]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-xl font-extrabold">Konfigurasi — {school?.name ?? '…'}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Berlaku untuk sekolah yang sedang dipilih (switcher di kanan atas). Perubahan dicatat di audit log.
        </p>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />
      {ok ? <p className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-300">{ok}</p> : null}

      <Card>
        <h2 className="font-extrabold">Identitas Sekolah</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Tampil di header, Kartu Login, dan kop dokumen sekolah.</p>
        <form onSubmit={onSaveSchool} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput label="Nama sekolah" value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} placeholder="cth. SMAN 1 Gorontalo" />
          <TextInput label="Nama aplikasi" value={identity.appName} onChange={(e) => setIdentity({ ...identity, appName: e.target.value })} placeholder="cth. CBT SMAN 1 Gorontalo" />
          <TextInput label="Nama kepala sekolah (Kartu Login)" value={identity.headmasterName} onChange={(e) => setIdentity({ ...identity, headmasterName: e.target.value })} placeholder="cth. Dra. Adianiwaty S. Polapa, M.Pd" />
          <TextInput label="NIP kepala sekolah" value={identity.headmasterNip} onChange={(e) => setIdentity({ ...identity, headmasterNip: e.target.value })} placeholder="cth. 196810131994122006" />
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving === 'school' || !identity.name.trim() || !identity.appName.trim()}>
              {saving === 'school' ? 'Menyimpan…' : 'Simpan Identitas'}
            </Button>
          </div>
        </form>

        <div className="mt-5 flex flex-col gap-3">
          {BRANDING_ROWS.map(({ kind, label, hint }) => (
            <div key={kind} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 p-3 dark:border-white/5">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-white/10 dark:bg-white/5">
                {previews[kind] ? (
                  <img src={previews[kind]} alt={label} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-[10px] font-semibold uppercase text-slate-400">belum ada</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    ref={(el) => { fileRefs.current[kind] = el; }}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    id={`branding-${kind}`}
                    onChange={(e) => onUpload(kind, e.target.files?.[0])}
                  />
                  <Button type="button" variant="ghost" disabled={brandBusy === kind} onClick={() => document.getElementById(`branding-${kind}`)?.click()}>
                    {brandBusy === kind ? '…' : 'Unggah'}
                  </Button>
                  {(kind === 'logo' ? school?.logoPath : kind === 'ttd' ? school?.ttdPath : school?.stampPath) ? (
                    <Button type="button" variant="danger" disabled={brandBusy === kind} onClick={() => onDeleteBranding(kind)}>
                      Hapus
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-extrabold">PIN Keluar APK SEB</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Diminta saat operator mengetuk <b>Keluar aplikasi</b> di APK kiosk SEB (apapun yang membuka APK harus
          memverifikasi PIN ini ke server). Berlaku untuk semua HP sekolah yang memakai server ini. PIN disimpan
          sebagai hash (SHA-256) — admin tidak bisa melihat PIN yang tersimpan, hanya mengganti atau menghapusnya.
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {sebPin.configured ? (
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 font-semibold text-emerald-600 dark:text-emerald-300">
              Sudah diatur{sebPin.updatedAt ? ` · ${new Date(sebPin.updatedAt).toLocaleString('id-ID')}` : ''}
            </span>
          ) : (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 font-semibold text-amber-600 dark:text-amber-300">
              Belum diatur — tombol keluar dinonaktifkan
            </span>
          )}
        </div>
        <form onSubmit={onSaveSebPin} className="mt-3 flex flex-wrap items-end gap-3">
          <TextInput
            label="PIN baru (4–8 angka)"
            type="password"
            autoComplete="new-password"
            inputMode="numeric"
            maxLength={8}
            value={pinDraft}
            onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="cth. 20261945"
          />
          <Button type="submit" disabled={pinBusy !== null || pinDraft.length < 4}>
            {pinBusy === 'save' ? 'Menyimpan…' : 'Simpan PIN'}
          </Button>
          {sebPin.configured ? (
            <Button type="button" variant="danger" disabled={pinBusy !== null} onClick={onClearSebPin}>
              {pinBusy === 'clear' ? 'Menghapus…' : 'Hapus PIN'}
            </Button>
          ) : null}
        </form>
      </Card>

      <Card>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        ) : (
          <div className="flex flex-col gap-4">
            {configKeys.map((key) => (
              <form key={key} onSubmit={(e) => onSave(key, e)} className="grid grid-cols-1 items-end gap-2 border-b border-slate-100 pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_auto] dark:border-white/5">
                <TextInput
                  label={LABEL[key]!.label}
                  value={drafts[key] ?? ''}
                  onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                  placeholder={values[key] ?? ''}
                />
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs text-slate-500 md:inline">{LABEL[key]!.hint}</span>
                  <Button type="submit" disabled={saving === key || (drafts[key] ?? '') === (values[key] ?? '') || !(drafts[key] ?? '').trim()}>
                    {saving === key ? '…' : 'Simpan'}
                  </Button>
                </div>
              </form>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
