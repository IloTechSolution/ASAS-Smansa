// Verifikasi hardening P1/P2/P4 — rotasi+revokasi refresh, rate-limit token,
// hardening upload gambar.
// Jalankan: node scripts/verify-hardening.mjs
const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';
const ORIGIN = process.env.CBT_ORIGIN ?? 'http://localhost:8080';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, info = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name}${info ? ` :: ${info}` : ''}`);
    console.log(`  FAIL  ${name}${info ? ` :: ${info}` : ''}`);
  }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

const login = async (role, username, password) => {
  const r = await call(`/auth/login/${role}`, { method: 'POST', body: { username, password } });
  if (r.status >= 300 || !r.json?.accessToken) throw new Error(`Login ${role}/${username} gagal: ${r.status}`);
  return r.json;
};
const asArr = (r) => (Array.isArray(r) ? r : r.data);
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+7E0WAAAAAElFTkSuQmCC';
let seq = 0;
const nisn = () => String(9100000000 + (Date.now() % 100000000) * 10 + (seq++ % 10)).slice(0, 10);

async function makeSiswa(admin, kelasId) {
  const n = nisn();
  const c = await call('/users', {
    method: 'POST', token: admin,
    body: { username: n, password: 'Siswa123!', name: `Hard ${n}`, role: 'SISWA', nisn: n, kelasId },
  });
  if (c.status >= 300) throw new Error(`buat siswa gagal: ${c.status} ${c.text.slice(0, 120)}`);
  return { id: c.json.id, nisn: n, creds: await login('siswa', n, 'Siswa123!') };
}

async function main() {
  console.log(`== CBT hardening verification @ ${BASE} ==\n`);

  console.log('[setup]');
  const admin = (await login('admin', 'admin', 'Admin123!')).accessToken;
  const guru = (await login('guru', 'guru', 'Guru123!')).accessToken;
  // Kelas seed dipilih dari NISN siswa seed, bukan indeks 0 — daftar kelas bisa
  // bertambah karena data uji lain sehingga urutannya bergeser.
  const seedRows = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: admin })).json);
  const kelasId = seedRows.find((u) => u.username === '0051234567')?.kelasId ?? asArr((await call('/kelas', { token: admin })).json)[0].id;
  const mapelId = asArr((await call('/mapel', { token: admin })).json)[0].id;
  check('setup ok', Boolean(kelasId && mapelId));

  console.log('\n[P1 — rate-limit login]');
  const lockedUser = `auditlogin${Date.now().toString().slice(-9)}`;
  let firstFiveFailed = true;
  for (let i = 0; i < 5; i++) {
    const r = await call('/auth/login/siswa', { method: 'POST', body: { username: lockedUser, password: 'Salah123!' } });
    if (r.status !== 401) firstFiveFailed = false;
  }
  check('5 percobaan gagal tetap 401 (belum diblokir)', firstFiveFailed);
  const sixth = await call('/auth/login/siswa', { method: 'POST', body: { username: lockedUser, password: 'Salah123!' } });
  check('percobaan ke-6 → 429', sixth.status === 429, `status=${sixth.status} ${sixth.text.slice(0, 100)}`);
  const otherUser = `auditlogin${Date.now().toString().slice(-9)}x`;
  const otherTry = await call('/auth/login/siswa', { method: 'POST', body: { username: otherUser, password: 'Salah123!' } });
  check('username lain tidak ikut terkunci', otherTry.status === 401, `status=${otherTry.status}`);

  const uReset = await makeSiswa(admin, kelasId);
  for (let i = 0; i < 4; i++) {
    await call('/auth/login/siswa', { method: 'POST', body: { username: uReset.nisn, password: 'Salah123!' } });
  }
  const goodLogin = await call('/auth/login/siswa', { method: 'POST', body: { username: uReset.nisn, password: 'Siswa123!' } });
  check('login benar setelah 4 gagal tetap diterima', goodLogin.status === 201, `status=${goodLogin.status}`);
  let afterResetOk = true;
  for (let i = 0; i < 4; i++) {
    const r = await call('/auth/login/siswa', { method: 'POST', body: { username: uReset.nisn, password: 'Salah123!' } });
    if (r.status !== 401) afterResetOk = false;
  }
  check('login sukses mereset counter', afterResetOk);

  console.log('\n[P1 — rotasi refresh token]');
  const u1 = await makeSiswa(admin, kelasId);
  const r1 = await call('/auth/refresh', { method: 'POST', body: { refreshToken: u1.creds.refreshToken } });
  check('refresh pertama sukses + dapat pasangan baru', r1.status < 300 && Boolean(r1.json?.accessToken && r1.json?.refreshToken), `status=${r1.status}`);
  const reuse = await call('/auth/refresh', { method: 'POST', body: { refreshToken: u1.creds.refreshToken } });
  check('refresh lama DITOLAK setelah rotasi (401)', reuse.status === 401, `status=${reuse.status}`);
  const r2 = await call('/auth/refresh', { method: 'POST', body: { refreshToken: r1.json.refreshToken } });
  check('refresh baru masih berlaku', r2.status < 300 && Boolean(r2.json?.accessToken), `status=${r2.status}`);
  const meNew = await call('/auth/me', { token: r2.json.accessToken });
  check('access hasil rotasi dipakai /auth/me', meNew.status === 200, `status=${meNew.status}`);

  console.log('\n[P1 — logout mencabut sesi]');
  const out = await call('/auth/logout', { method: 'POST', body: { refreshToken: r2.json.refreshToken } });
  check('logout ok', out.status < 300, `status=${out.status}`);
  const afterOut = await call('/auth/refresh', { method: 'POST', body: { refreshToken: r2.json.refreshToken } });
  check('refresh pasca-logout DITOLAK (401)', afterOut.status === 401, `status=${afterOut.status}`);

  console.log('\n[P1 — ganti password mencabut semua sesi]');
  const u2 = await makeSiswa(admin, kelasId);
  const ch = await call('/auth/change-password', { method: 'POST', token: u2.creds.accessToken, body: { currentPassword: 'Siswa123!', newPassword: 'Baru123!!' } });
  check('ganti password ok', ch.status < 300, `status=${ch.status} ${ch.text.slice(0, 100)}`);
  const afterCh = await call('/auth/refresh', { method: 'POST', body: { refreshToken: u2.creds.refreshToken } });
  check('refresh lama mati setelah ganti password (401)', afterCh.status === 401, `status=${afterCh.status}`);

  console.log('\n[P1 — reset admin mencabut sesi korban]');
  const u3 = await makeSiswa(admin, kelasId);
  const rst = await call(`/users/${u3.id}/reset-password`, { method: 'POST', token: admin, body: { newPassword: 'Reset123!!' } });
  check('reset password ok', rst.status < 300, `status=${rst.status} ${rst.text.slice(0, 100)}`);
  const afterRst = await call('/auth/refresh', { method: 'POST', body: { refreshToken: u3.creds.refreshToken } });
  check('refresh korban mati setelah reset (401)', afterRst.status === 401, `status=${afterRst.status}`);

  console.log('\n[P2 — rate-limit verify token]');
  const q = await call('/questions', {
    method: 'POST', token: guru,
    body: { type: 'PG', content: 'Soal throttle?', weight: 1, scoringMode: 'ALL_OR_NOTHING', choices: [{ id: 'a', label: 'x' }, { id: 'b', label: 'y' }], correctChoices: ['a'] },
  });
  const exam = await call('/exams', { method: 'POST', token: guru, body: { title: 'Ujian throttle', mapelId } });
  await call(`/exams/${exam.json.id}/questions`, { method: 'PUT', token: guru, body: { questionIds: [q.json.id] } });
  const now = Date.now();
  const sess = await call('/sessions', {
    method: 'POST', token: guru,
    body: { examId: exam.json.id, title: 'Sesi throttle', startsAt: new Date(now - 30_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(), durationMin: 30, tokenIntervalSec: 300, requireSeb: false, shuffleQuestions: false, shuffleOptions: false, kelasIds: [kelasId] },
  });
  await call(`/sessions/${sess.json.id}/status`, { method: 'PATCH', token: guru, body: { status: 'SCHEDULED' } });
  await call(`/sessions/${sess.json.id}/status`, { method: 'PATCH', token: guru, body: { status: 'ACTIVE' } });
  const sid = sess.json.id;
  const atk = await makeSiswa(admin, kelasId);
  let saw429 = false;
  let first10ok = true;
  for (let i = 0; i < 11; i++) {
    const v = await call(`/sessions/${sid}/token/verify`, { method: 'POST', token: atk.creds.accessToken, body: { token: '123456' } });
    // POST Nest → 201; {ok:false} berarti token salah tapi belum diblokir.
    if (i < 10 && !(v.status === 201 && v.json?.ok === false)) first10ok = false;
    if (i === 10 && v.status === 429) saw429 = true;
  }
  check('10x salah → 201 {ok:false} (belum diblokir)', first10ok);
  check('tebakan ke-11 → 429', saw429);
  const other = await makeSiswa(admin, kelasId);
  const vOther = await call(`/sessions/${sid}/token/verify`, { method: 'POST', token: other.creds.accessToken, body: { token: '123456' } });
  check('user lain tidak ikut terblokir (per-user)', vOther.status === 201, `status=${vOther.status}`);

  console.log('\n[P4 — upload: isi palsu ditolak, asli diterima]');
  const qUp = await call('/questions', {
    method: 'POST', token: guru,
    body: { type: 'PG', content: 'Soal gambar P4', weight: 1, scoringMode: 'ALL_OR_NOTHING', choices: [{ id: 'a', label: 'x' }, { id: 'b', label: 'y' }], correctChoices: ['a'] },
  });
  const fakeForm = new FormData();
  fakeForm.set('image', new Blob(['<script>bukan gambar</script>'], { type: 'image/png' }), 'palsu.png');
  const fakeRes = await fetch(`${BASE}/questions/${qUp.json.id}/image`, { method: 'POST', headers: { Authorization: `Bearer ${guru}` }, body: fakeForm });
  check('file teks berekstensi .png DITOLAK (400)', fakeRes.status === 400, `status=${fakeRes.status}`);
  const realForm = new FormData();
  realForm.set('image', new Blob([Buffer.from(PNG_1x1, 'base64')], { type: 'image/png' }), 'asli.png');
  const realRes = await fetch(`${BASE}/questions/${qUp.json.id}/image`, { method: 'POST', headers: { Authorization: `Bearer ${guru}` }, body: realForm });
  const realJson = await realRes.json().catch(() => null);
  check('PNG asli diterima', realRes.status < 300 && Boolean(realJson?.imageUrl), `${realRes.status}`);

  console.log('\n[P4 — file bersama duplikat tidak ikut terhapus]');
  const dup = await call(`/questions/${qUp.json.id}/duplicate`, { method: 'POST', token: guru });
  check('duplikat dibuat', dup.status < 300, `status=${dup.status}`);
  await call(`/questions/${qUp.json.id}`, { method: 'DELETE', token: guru });
  const dupDetail = await call(`/questions/${dup.json.id}`, { token: guru });
  check('duplikat tetap pegang imageUrl', dupDetail.json?.imageUrl === realJson?.imageUrl, JSON.stringify(dupDetail.json?.imageUrl));
  const signFor = async (p) => {
    const r = await call(`/uploads/sign?path=${encodeURIComponent(p)}`, { token: guru });
    return r.json?.url ? fetch(`${ORIGIN}${r.json.url}`) : null;
  };
  const imgStill = await signFor(realJson?.imageUrl);
  check('berkas masih tersaji (dipakai duplikat)', imgStill?.status === 200, `status=${imgStill?.status}`);
  await call(`/questions/${dup.json.id}`, { method: 'DELETE', token: guru });
  const imgGone = await signFor(realJson?.imageUrl);
  check('berkas dibersihkan setelah pemakai terakhir dihapus', imgGone?.status === 404, `status=${imgGone?.status}`);

  console.log('\n[login generik — POST /auth/login tanpa role]');
  const genGuru = await call('/auth/login', { method: 'POST', body: { username: 'guru', password: 'Guru123!' } });
  check('login generik guru → role GURU terdeteksi', genGuru.status < 300 && genGuru.json?.user?.role === 'GURU', `status=${genGuru.status}`);
  const genSiswa = await call('/auth/login', { method: 'POST', body: { username: '0051234567', password: 'Siswa123!' } });
  check('login generik siswa → role SISWA terdeteksi', genSiswa.status < 300 && genSiswa.json?.user?.role === 'SISWA' && Boolean(genSiswa.json?.accessToken), `status=${genSiswa.status}`);
  const genBad = await call('/auth/login', { method: 'POST', body: { username: 'guru', password: 'salah-banget' } });
  check('login generik password salah → 401', genBad.status === 401, `status=${genBad.status}`);

  console.log(`\n== HASIL: ${pass} PASS, ${fail} FAIL ==`);
  if (fail > 0) {
    console.log('Rincian gagal:');
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
