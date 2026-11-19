import { expect, request, test } from '@playwright/test';
import { Document, Packer, Paragraph } from 'docx';

/**
 * Smoke test — memastikan aplikasi benar-benar render (bukan layar putih)
 * dan alur baca utama berfungsi di browser sungguhan.
 * TIDAK menulis data apa pun (dev DB tetap bersih).
 */

test('halaman awal langsung login: headline + form', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /UJIAN YANG JUJUR/i })).toBeVisible();
  // tidak ada pemilih peran — login generik
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByLabel('Nama pengguna / NISN')).toBeVisible();
  await page.getByPlaceholder('••••••••').fill('rahasia123');
  await page.getByRole('button', { name: 'Tampilkan password' }).click();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Sembunyikan password' }).click();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
});

test('login membuka audio context', async ({ page }) => {
  await page.addInitScript(() => {
    const proto = (window as unknown as { AudioContext?: { prototype: Record<string, unknown> } }).AudioContext?.prototype;
    if (!proto) return;
    const original = proto.createBufferSource as (...args: unknown[]) => unknown;
    proto.createBufferSource = function (this: { state?: string }, ...args: unknown[]) {
      (window as unknown as { __audioUnlocked?: boolean }).__audioUnlocked = true;
      (window as unknown as { __audioState?: string }).__audioState = this.state;
      return original.apply(this, args);
    };
  });
  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByLabel('Password', { exact: true }).fill('Guru123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/guru/);
  const flags = await page.evaluate(() => ({
    unlocked: (window as unknown as { __audioUnlocked?: boolean }).__audioUnlocked === true,
    state: (window as unknown as { __audioState?: string }).__audioState,
  }));
  expect(flags.unlocked).toBe(true);
  expect(flags.state).toBe('running');
});

test('halaman /login/guru membuka form login yang sama (kompat tautan lama)', async ({ page }) => {
  await page.goto('/login/guru');
  await expect(page.getByRole('heading', { name: /UJIAN YANG JUJUR/i })).toBeVisible();
  await expect(page.getByLabel('Nama pengguna / NISN')).toBeVisible();
});

test('login guru → dashboard guru render', async ({ page }) => {
  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByLabel('Password', { exact: true }).fill('Guru123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/guru/);
  await expect(page.getByRole('heading', { name: /Halo,/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Bank Soal/i }).first()).toBeVisible();
});

test('login siswa seed → halaman ujian saya render', async ({ page }) => {
  await page.goto('/login/siswa');
  await page.getByLabel('Nama pengguna / NISN').fill('0051234567');
  await page.getByPlaceholder('••••••••').fill('Siswa123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/siswa/);
  await expect(page.getByRole('heading', { name: 'Ujian Saya' })).toBeVisible();
});

test('route /verify lama sudah dihapus (404)', async ({ page }) => {
  await page.goto('/verify/token-sampah-tidak-valid');
  await expect(page.getByText('Halaman tidak ditemukan.')).toBeVisible();
});

test('password salah → pesan error eksplisit (bukan layar putih)', async ({ page }) => {
  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByPlaceholder('••••••••').fill('salah-banget');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByText(/salah|gagal|invalid|tidak/i).first()).toBeVisible();
});

test('proktor login → Panel Monitoring Pelanggaran render', async ({ page }) => {
  await page.goto('/login/proktor');
  await page.getByLabel('Nama pengguna / NISN').fill('proktor');
  await page.getByPlaceholder('••••••••').fill('Proktor123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/proktor/);
  const link = page.getByRole('link', { name: /Monitoring Pelanggaran/i });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/app\/pelanggaran/);
  await expect(page.getByRole('heading', { name: /Monitoring Pelanggaran/i })).toBeVisible();
});

test('guru login → menu KKM Mapel render', async ({ page }) => {
  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByLabel('Password', { exact: true }).fill('Guru123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.getByRole('link', { name: 'KKM Mapel' }).click();
  await expect(page).toHaveURL(/\/app\/guru\/mapel/);
  await expect(page.getByRole('heading', { name: /KKM Mata Pelajaran/i })).toBeVisible();
});

test('guru buat soal dengan gambar → langsung ke bank soal + banner tersimpan', async ({ page }) => {
  const suffix = String(Date.now());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByLabel('Password', { exact: true }).fill('Guru123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/guru/);

  await page.goto('/app/guru/soal/baru');
  await page.getByLabel('Teks soal').fill(`Soal E2E ${suffix} — 1+1?`);
  await page.getByLabel('Opsi 1').fill('2');
  await page.getByLabel('Opsi 2').fill('3');
  await page.locator('input[name="kunci-pg"]').first().check();
  // unggah gambar soal (opsional) — harus tampil pratinjau sebelum simpan
  await page.getByTestId('q-image-input').setInputFiles({ name: 'e2e.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('Pratinjau gambar soal')).toBeVisible();
  // tandai opsi 1 dengan gambar juga
  await page.locator('input[id^="choice-img-"]').first().setInputFiles({ name: 'opsi.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('img[alt="Gambar opsi 1"]')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Buat soal' }).click();
  await expect(page).toHaveURL(/\/app\/guru\/soal$/);
  await expect(page.getByRole('status')).toContainText('Soal berhasil dibuat');

  // bersihkan soal hasil E2E agar dev DB tetap bersih
  const deleted = await page.evaluate(async (q) => {
    const t = localStorage.getItem('cbt_token');
    const res = await fetch(`/api/questions?search=${encodeURIComponent('Soal E2E ' + q)}`, { headers: { Authorization: `Bearer ${t}` } });
    const body = await res.json();
    const rows = Array.isArray(body) ? body : body.data ?? [];
    const row = rows.find((r) => typeof r?.content === 'string' && r.content.includes('Soal E2E ' + q));
    if (!row) return false;
    const d = await fetch(`/api/questions/${row.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
    return d.ok;
  }, suffix);
  expect(deleted).toBe(true);
});

test('BA Digital tidak ada di menu manapun; Integritas & Monitoring jadi tab pelaksanaan', async ({ page }) => {
  await page.goto('/login/proktor');
  await page.getByLabel('Nama pengguna / NISN').fill('proktor');
  await page.getByPlaceholder('••••••••').fill('Proktor123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/proktor/);
  // BA Digital tidak boleh ada di sidebar
  await expect(page.getByRole('link', { name: 'BA Digital' })).toHaveCount(0);

  // Ambil id sesi pertama (UTS seed) lewat API
  const sessionId = await page.evaluate(async () => {
    const t = localStorage.getItem('cbt_token');
    const r = await fetch('/api/sessions?limit=1', { headers: { Authorization: `Bearer ${t}` } });
    const b = await r.json();
    const arr = Array.isArray(b) ? b : b.data ?? [];
    return arr[0]?.id ?? null;
  });
  test.skip(!sessionId, 'tidak ada sesi di dev DB');
  await page.goto(`/app/proktor/sesi/${sessionId}/integritas`);
  await expect(page.getByRole('heading', { name: /Anti-Cheat/i })).toBeVisible();
  await page.goto(`/app/proktor/sesi/${sessionId}/monitoring`);
  await expect(page.getByRole('heading', { name: /Monitoring Realtime/i })).toBeVisible();
});

test('BA Digital tidak ada di menu admin', async ({ page }) => {
  await page.goto('/login/admin');
  await page.getByLabel('Nama pengguna / NISN').fill('admin');
  await page.getByPlaceholder('••••••••').fill('Admin123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/admin/);
  await expect(page.getByRole('link', { name: 'BA Digital' })).toHaveCount(0);
});

test('guru tidak melihat panel Pelaksanaan di nav, tapi rute langsung masih hidup (sembunyi saja)', async ({ page }) => {
  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByLabel('Password', { exact: true }).fill('Guru123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/guru/);
  // link tidak tampil di nav
  await expect(page.getByRole('link', { name: 'Pelaksanaan', exact: true })).toHaveCount(0);
  // tapi rute langsung tetap terbuka (hidden, bukan dihapus)
  await page.goto('/app/proktor/sesi');
  await expect(page.getByRole('heading', { name: 'Sesi Ujian' })).toBeVisible();
});

test('admin: nav Kelas ada, Kelas & TA lama dihapus dari nav', async ({ page }) => {
  await page.goto('/login/admin');
  await page.getByLabel('Nama pengguna / NISN').fill('admin');
  await page.getByPlaceholder('••••••••').fill('Admin123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/admin/);
  await expect(page.getByRole('link', { name: 'Kelas & TA' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Kelas', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Siswa', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/admin\/siswa/);
  await expect(page.getByRole('heading', { name: 'Siswa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import Excel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Template Excel' })).toBeVisible();
});

test('guru: halaman ujian menampilkan tabel Hari Ujian', async ({ page }) => {
  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByLabel('Password', { exact: true }).fill('Guru123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/guru/);
  await page.goto('/app/guru/ujian');
  await expect(page.getByRole('heading', { name: 'Hari Ujian' })).toBeVisible();
});

test('guru: import CSV di susunan soal + tombol Simpan soal bekerja', async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);

  // setup via API langsung (request fixture) — tidak bergantung state UI
  const api = await request.newContext({ baseURL: 'http://localhost:8080' });
  const loginRes = await api.post('/api/auth/login/guru', { data: { username: 'guru', password: 'Guru123!' } });
  const { accessToken } = (await loginRes.json()) as { accessToken: string };
  const H = { Authorization: `Bearer ${accessToken}` };
  const mapelsRes = await api.get('/api/mapel', { headers: H });
  const mapelRows = (await mapelsRes.json()) as Array<{ id: string }>;
  const examRes = await api.post('/api/exams', { headers: H, data: { title: `E2E CSV ${suffix}`, mapelId: mapelRows[0]?.id } });
  const exam = (await examRes.json()) as { id: string };
  const soalRes = await api.post('/api/questions', {
    headers: H,
    data: {
      type: 'PG', content: `E2E CSV ${suffix}: 1+1?`, weight: 2, scoringMode: 'ALL_OR_NOTHING',
      choices: [{ id: 'a', label: '2' }, { id: 'b', label: '3' }], correctChoices: ['a'],
    },
  });
  const soal = (await soalRes.json()) as { id: string };

  // login UI untuk menguji halaman & interaksi sebenarnya
  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByLabel('Password', { exact: true }).fill('Guru123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/guru/);

  await page.goto(`/app/guru/ujian/${exam.id}`);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByRole('heading', { name: 'Import soal dari CSV' })).toBeVisible();
  const csv = `id,tipe,bobot,konten
${soal.id},PG,2,E2E CSV ${suffix}: 1+1?
`;
  await page.locator('input[type=file]').setInputFiles({ name: 'soal.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(`E2E CSV ${suffix}: 1+1?`).first()).toBeVisible();
  await page.getByRole('button', { name: 'Simpan soal' }).click();
  await expect(page.getByRole('status')).toContainText('1 soal diimpor');
  await page.getByRole('tab', { name: /Sesi Ujian/ }).click();
  await expect(page.getByText('Belum ada sesi')).toBeVisible();

  // cleanup lewat API
  await api.delete(`/api/exams/${exam.id}`, { headers: H });
  await api.delete(`/api/questions/${soal.id}`, { headers: H });
  await api.dispose();
});

test('proktor melihat menu Kartu Login', async ({ page }) => {
  await page.goto('/login/proktor');
  await page.getByLabel('Nama pengguna / NISN').fill('proktor');
  await page.getByPlaceholder('••••••••').fill('Proktor123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/proktor/);
  await expect(page.getByRole('link', { name: 'Kartu Login' })).toBeVisible();
  await page.getByRole('link', { name: 'Kartu Login' }).click();
  await expect(page.getByRole('heading', { name: /Kartu Login/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Unduh PDF/ })).toBeVisible();
});

test('admin melihat menu Kartu Login', async ({ page }) => {
  await page.goto('/login/admin');
  await page.getByLabel('Nama pengguna / NISN').fill('admin');
  await page.getByPlaceholder('••••••••').fill('Admin123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/admin/);
  await expect(page.getByRole('link', { name: 'Kartu Login' })).toBeVisible();
  await page.getByRole('link', { name: 'Kartu Login' }).click();
  await expect(page.getByRole('heading', { name: /Kartu Login/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Unduh PDF/ })).toBeVisible();
});

test('guru tidak melihat menu Kartu Login / Pelaksanaan', async ({ page }) => {
  // guru TIDAK melihat menu Kartu Login / Pelaksanaan
  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByLabel('Password', { exact: true }).fill('Guru123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/guru/);
  await expect(page.getByRole('link', { name: 'Kartu Login' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Pelaksanaan', exact: true })).toHaveCount(0);
});
test('guru: pratinjau ujian menampilkan kunci, toggle tampilan siswa, bisa difilter', async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);

  // setup via API langsung — guru membuat ujian & soalnya sendiri
  const api = await request.newContext({ baseURL: 'http://localhost:8080' });
  const loginRes = await api.post('/api/auth/login/guru', { data: { username: 'guru', password: 'Guru123!' } });
  const { accessToken } = (await loginRes.json()) as { accessToken: string };
  const H = { Authorization: `Bearer ${accessToken}` };
  const mapelsRes = await api.get('/api/mapel', { headers: H });
  const mapelRows = (await mapelsRes.json()) as Array<{ id: string }>;
  const examRes = await api.post('/api/exams', { headers: H, data: { title: `E2E Pratinjau ${suffix}`, mapelId: mapelRows[0]?.id } });
  const exam = (await examRes.json()) as { id: string };
  const soalRes = await api.post('/api/questions', {
    headers: H,
    data: {
      type: 'PG', content: `E2E Pratinjau ${suffix}: 1+1?`, weight: 2, scoringMode: 'ALL_OR_NOTHING',
      explanation: 'Satu tambah satu sama dengan dua.',
      choices: [{ id: 'a', label: '2' }, { id: 'b', label: '3' }], correctChoices: ['a'],
    },
  });
  const soal = (await soalRes.json()) as { id: string };
  await api.put(`/api/exams/${exam.id}/questions`, { headers: H, data: { questionIds: [soal.id] } });

  // login UI & buka halaman pratinjau lewat tombol di builder
  await page.goto('/login/guru');
  await page.getByLabel('Nama pengguna / NISN').fill('guru');
  await page.getByLabel('Password', { exact: true }).fill('Guru123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/guru/);

  await page.goto(`/app/guru/ujian/${exam.id}`);
  await page.getByRole('link', { name: /Pratinjau Ujian/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/guru/ujian/${exam.id}/pratinjau`));
  await expect(page.getByRole('heading', { name: `E2E Pratinjau ${suffix}` })).toBeVisible();
  await expect(page.getByText(`E2E Pratinjau ${suffix}: 1+1?`)).toBeVisible();

  // mode guru: kunci & pembahasan tampil
  await expect(page.getByRole('button', { name: /Tampilan Guru/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Kunci', { exact: true })).toBeVisible();
  await expect(page.getByText('Pembahasan')).toBeVisible();

  // filter "Belum ada data": soal tampil (belum ada attempt)
  await page.getByRole('button', { name: /Belum ada data/ }).click();
  await expect(page.getByText(`E2E Pratinjau ${suffix}: 1+1?`)).toBeVisible();
  await page.getByRole('button', { name: /^Semua/ }).click();

  // mode siswa: kunci & pembahasan hilang
  await page.getByRole('button', { name: /Tampilan Siswa/ }).click();
  await expect(page.getByRole('button', { name: /Tampilan Siswa/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Kunci', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Pembahasan')).toHaveCount(0);

  // cleanup lewat API
  await api.delete(`/api/exams/${exam.id}`, { headers: H });
  await api.delete(`/api/questions/${soal.id}`, { headers: H });
  await api.dispose();
});

test('admin: switcher sekolah memfilter data (SMAN 8) lalu kembali Semua Sekolah', async ({ page }) => {
  await page.goto('/login/admin');
  await page.getByLabel('Nama pengguna / NISN').fill('admin');
  await page.getByPlaceholder('••••••••').fill('Admin123!');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/app\/admin/);

  const switcher = page.getByTitle('Konteks sekolah admin');
  await expect(switcher).toBeVisible();
  await expect(switcher).toHaveValue('');
  await expect(switcher.getByRole('option', { name: 'SMAN 8 Gorontalo' })).toHaveCount(1);
  await expect(page.getByText('Mode Semua Sekolah')).toBeVisible();

  // Pilih SMAN 8 → reload → data terkunci sekolah itu
  await switcher.selectOption('sman8');
  await page.waitForLoadState('load');
  const switcher8 = page.getByTitle('Konteks sekolah admin');
  await expect(switcher8).toHaveValue('sman8');
  await expect(page.getByText('Mode Semua Sekolah')).toHaveCount(0);
  await expect(page.getByText('CBT SMAN 8 Gorontalo').first()).toBeVisible();

  await page.goto('/app/admin/pengaturan');
  await expect(page.getByText('CBT SMAN 8 Gorontalo')).toBeVisible();

  // Kembali ke mode agregat (reload mengarah ke halaman yang sama)
  await switcher8.selectOption('');
  await page.waitForLoadState('load');
  await expect(page.getByText('Mode Semua Sekolah').first()).toBeVisible();
});

test('template DOCX tabel bisa diimpor ulang jadi 5 soal', async () => {
  const api = await request.newContext({ baseURL: 'http://localhost:8080' });
  const created: string[] = [];
  const login = await api.post('/api/auth/login/guru', { data: { username: 'guru', password: 'Guru123!' } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  try {
    const template = await api.get('/api/questions/import/template-docx', { headers });
    expect(template.ok()).toBeTruthy();
    const buffer = await template.body();

    const imported = await api.post('/api/questions/import', {
      headers,
      multipart: {
        file: {
          name: 'template.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer,
        },
      },
    });
    expect(imported.ok()).toBeTruthy();
    const res = (await imported.json()) as {
      total: number;
      success: Array<{ id: string }>;
      failed: Array<{ error: string }>;
    };
    created.push(...res.success.map((s) => s.id));
    expect(res.total).toBe(5);
    expect(res.success.length).toBe(5);
    expect(res.failed).toEqual([]);

    const detail = await api.get(`/api/questions/${created[0]}`, { headers });
    expect(detail.ok()).toBeTruthy();
    const question = (await detail.json()) as { weight: number; content: string };
    expect(question.weight).toBe(1);
    expect(question.content).toContain('Ibu kota Indonesia');
  } finally {
    for (const id of created) {
      const del = await api.delete(`/api/questions/${id}`, { headers });
      expect(del.ok()).toBeTruthy();
    }
    await api.dispose();
  }
});

test('DOCX format lama SOAL n tetap diimpor (fallback)', async () => {
  const api = await request.newContext({ baseURL: 'http://localhost:8080' });
  const login = await api.post('/api/auth/login/guru', { data: { username: 'guru', password: 'Guru123!' } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const created: string[] = [];
  try {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'SOAL 1' }),
            new Paragraph({ text: 'Tipe: PG' }),
            new Paragraph({ text: 'Konten: Soal lama fallback' }),
            new Paragraph({ text: 'Bobot: 2' }),
            new Paragraph({ text: 'Opsi: A|Satu;B|Dua' }),
            new Paragraph({ text: 'Kunci: A' }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    const imported = await api.post('/api/questions/import', {
      headers,
      multipart: {
        file: {
          name: 'lama.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer,
        },
      },
    });
    expect(imported.ok()).toBeTruthy();
    const res = (await imported.json()) as { total: number; success: Array<{ id: string }> };
    created.push(...res.success.map((s) => s.id));
    expect(res.total).toBe(1);
    expect(res.success.length).toBe(1);

    const detail = await api.get(`/api/questions/${created[0]}`, { headers });
    const question = (await detail.json()) as { weight: number; content: string };
    expect(question.content).toBe('Soal lama fallback');
    expect(question.weight).toBe(2);
  } finally {
    for (const id of created) {
      const del = await api.delete(`/api/questions/${id}`, { headers });
      expect(del.ok()).toBeTruthy();
    }
    await api.dispose();
  }
});
