// Audit menyeluruh CBT — matriks akses endpoint × role + uji fungsional fitur.
// Jalankan: node scripts/verify-roles.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';
const ORIGIN = process.env.CBT_ORIGIN ?? 'http://localhost:8080';

function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] === key) return m[2].trim();
    }
  } catch {
    // .env tidak ada (mis. CI) — tes SEB akan gagal bila API mewajibkannya.
  }
  return '';
}

const SEB_KEY = process.env.CBT_SEB_KEY ?? envValue('SEB_BROWSER_EXAM_KEY');
const sebHeaders = (path) =>
  SEB_KEY ? { 'X-SafeExamBrowser-RequestHash': createHash('sha256').update(`${BASE}${path}${SEB_KEY}`).digest('hex') } : {};

let pass = 0;
let fail = 0;
const failures = [];
let section = '';

function check(name, cond, info = '') {
  const label = section ? `[${section}] ${name}` : name;
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    failures.push(`${label}${info ? ` :: ${info}` : ''}`);
    console.log(`  FAIL  ${label}${info ? ` :: ${info}` : ''}`);
  }
}

const sectionOf = (s) => {
  section = s;
  console.log(`\n=== ${s} ===`);
};

async function call(path, { method = 'GET', body, token, raw = false, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  if (!raw) {
    try {
      json = buf.length ? JSON.parse(buf.toString('utf8')) : null;
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, text: buf.toString('utf8'), ct, len: buf.length, buf };
}

async function login(role, username, password) {
  const r = await call(`/auth/login/${role}`, { method: 'POST', body: { username, password } });
  if (r.status >= 300 || !r.json?.accessToken) throw new Error(`Login ${role}/${username} gagal: ${r.status} ${r.text.slice(0, 160)}`);
  return r.json;
}

const asArr = (r) => (Array.isArray(r) ? r : (r?.data ?? []));
let seq = 0;
const nisn = () => String(9200000000 + (Date.now() % 100000000) * 10 + (seq++ % 10)).slice(0, 10);

async function makeUser(adminT, { role, kelasId, password = 'Siswa123!' }) {
  if (role === 'SISWA') {
    const n = nisn();
    const c = await call('/users', { method: 'POST', token: adminT, body: { username: n, password, name: `Audit ${n}`, role, nisn: n, kelasId } });
    if (c.status >= 300) throw new Error(`buat siswa gagal: ${c.status} ${c.text.slice(0, 160)}`);
    return { id: c.json.id, username: n, creds: await login('siswa', n, password) };
  }
  const u = `audit${role.toLowerCase()}${Date.now().toString().slice(-6)}${seq++}`;
  const c = await call('/users', { method: 'POST', token: adminT, body: { username: u, password, name: `Audit ${role} ${seq}`, role } });
  if (c.status >= 300) throw new Error(`buat ${role} gagal: ${c.status} ${c.text.slice(0, 160)}`);
  return { id: c.json.id, username: u, creds: await login(role.toLowerCase(), u, password) };
}

const QUESTIONS = {
  PG: {
    type: 'PG',
    content: 'Berapa 2+2? (audit role)',
    weight: 1,
    scoringMode: 'ALL_OR_NOTHING',
    choices: [{ id: 'a', label: '3' }, { id: 'b', label: '4' }],
    correctChoices: ['b'],
  },
  PG_KOMPLEKS: {
    type: 'PG_KOMPLEKS',
    content: 'Pilih bilangan genap (audit role)',
    weight: 1,
    scoringMode: 'PROPORSIONAL',
    choices: [{ id: 'a', label: '2' }, { id: 'b', label: '3' }, { id: 'c', label: '4' }],
    correctChoices: ['a', 'c'],
  },
  MATCHING: {
    type: 'MATCHING',
    content: 'Jodohkan (audit role)',
    weight: 1,
    scoringMode: 'ALL_OR_NOTHING',
    pairs: {
      left: [{ id: 'l1', text: 'Satu' }, { id: 'l2', text: 'Dua' }],
      right: [{ id: 'r1', text: '1' }, { id: 'r2', text: '2' }],
      mapping: { l1: 'r1', l2: 'r2' },
    },
  },
  BENAR_SALAH: {
    type: 'BENAR_SALAH',
    content: 'Nilai pernyataan (audit role)',
    weight: 1,
    scoringMode: 'ALL_OR_NOTHING',
    statements: [{ id: 's1', text: 'Bumi bulat', answer: true }, { id: 's2', text: 'Matahari mengelilingi bumi', answer: false }],
  },
  ISIAN_SINGKAT: {
    type: 'ISIAN_SINGKAT',
    content: 'Ibu kota Indonesia adalah ... (audit role)',
    weight: 1,
    scoringMode: 'ALL_OR_NOTHING',
    acceptedAnswers: ['Jakarta', 'DKI Jakarta'],
  },
};

async function main() {
  console.log(`== CBT audit per-role @ ${BASE} ==`);

  /* ---------------------------------------------------------------- */
  sectionOf('setup');
  const adminCreds = await login('admin', 'admin', 'Admin123!');
  const guruCreds = await login('guru', 'guru', 'Guru123!');
  const proktorCreds = await login('proktor', 'proktor', 'Proktor123!');
  const adminT = adminCreds.accessToken;
  const guruT = guruCreds.accessToken;
  const proktorT = proktorCreds.accessToken;

  check('login ADMIN/GURU/PROKTOR', Boolean(adminT && guruT && proktorT));

  const kelasList = asArr((await call('/kelas', { token: adminT })).json);
  const mapelList = asArr((await call('/mapel', { token: adminT })).json);
  // Kelas seed = kelas siswa seed (bukan indeks 0) agar audit tetap stabil saat
  // DB sudah berisi kelas uji lain.
  const seedSiswa = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: adminT })).json).find((u) => u.username === '0051234567');
  const kelasId = seedSiswa?.kelasId ?? kelasList[0]?.id;
  const mapelId = mapelList[0]?.id;
  check('master data seed tersedia (kelas + mapel)', Boolean(kelasId && mapelId), `kelas=${kelasList.length} mapel=${mapelList.length}`);

  const guru2 = await makeUser(adminT, { role: 'GURU' });
  const siswaA = await makeUser(adminT, { role: 'SISWA', kelasId });
  const siswaB = await makeUser(adminT, { role: 'SISWA', kelasId });
  // Siswa di kelas lain — untuk menguji penolakan peserta di luar sesi.
  // Kelas uji ini dibersihkan lagi di akhir audit (siswa dipindah ke kelas seed).
  const fixture = await call('/kelas', {
    method: 'POST',
    token: adminT,
    body: { name: `AUDIT-FIXTURE ${Date.now().toString().slice(-6)}`, tingkat: 'X', tahunAjaran: '2026/2027' },
  });
  const fixtureKelasId = fixture.json?.id;
  const siswaC = await makeUser(adminT, { role: 'SISWA', kelasId: fixtureKelasId });
  check('kelas + siswa uji di luar sesi siap', Boolean(fixtureKelasId && siswaC.id), `kelas=${fixtureKelasId}`);

  /* ---------------------------------------------------------------- */
  sectionOf('auth');
  const badLogin = await call('/auth/login/siswa', { method: 'POST', body: { username: siswaA.username, password: 'salah-banget' } });
  check('password salah ditolak (401)', badLogin.status === 401, `status=${badLogin.status}`);
  const wrongRole = await call('/auth/login/guru', { method: 'POST', body: { username: siswaA.username, password: 'Siswa123!' } });
  check('login memakai role salah ditolak (401)', wrongRole.status === 401, `status=${wrongRole.status}`);
  const badRole = await call('/auth/login/wali', { method: 'POST', body: { username: 'x', password: 'x' } });
  check('role tak dikenal ditolak (400)', badRole.status === 400, `status=${badRole.status}`);
  const noAuth = await call('/auth/me');
  check('tanpa token → 401', noAuth.status === 401, `status=${noAuth.status}`);
  const meSiswa = await call('/auth/me', { token: siswaA.creds.accessToken });
  check('GET /auth/me siswa memuat kelasId', meSiswa.status === 200 && meSiswa.json?.kelasId === kelasId, JSON.stringify(meSiswa.json)?.slice(0, 140));

  /* ---------------------------------------------------------------- */
  sectionOf('master data GURU (regresi)');
  const guruKelas = await call('/kelas', { token: guruT });
  check('GURU boleh baca /kelas (form sesi)', guruKelas.status === 200, `status=${guruKelas.status}`);
  const guruMapel = await call('/mapel', { token: guruT });
  check('GURU boleh baca /mapel (builder ujian)', guruMapel.status === 200, `status=${guruMapel.status}`);
  check('GURU tetap tak boleh tulis /kelas (403)', (await call('/kelas', { method: 'POST', token: guruT, body: { name: 'X', tahunAjaran: '2026/2027' } })).status === 403);
  check('GURU tetap tak boleh tulis /mapel (403)', (await call('/mapel', { method: 'POST', token: guruT, body: { name: 'X' } })).status === 403);
  check('SISWA tak boleh baca /kelas (403)', (await call('/kelas', { token: siswaA.creds.accessToken })).status === 403);
  check('SISWA tak boleh baca /mapel (403)', (await call('/mapel', { token: siswaA.creds.accessToken })).status === 403);

  /* ---------------------------------------------------------------- */
  sectionOf('ADMIN — pengguna');
  const listUsers = await call('/users?limit=5', { token: adminT });
  check('GET /users (paged)', listUsers.status === 200 && Array.isArray(listUsers.json?.data), `status=${listUsers.status}`);
  const listUsersGuru = await call('/users', { token: guruT });
  check('GURU ditolak GET /users (403)', listUsersGuru.status === 403, `status=${listUsersGuru.status}`);
  const dupUser = await call('/users', { method: 'POST', token: adminT, body: { username: siswaA.username, password: 'Siswa123!', name: 'Dup', role: 'SISWA', nisn: siswaA.username, kelasId } });
  check('username duplikat ditolak (4xx)', dupUser.status >= 400 && dupUser.status < 500, `status=${dupUser.status}`);
  const badSiswa = await call('/users', { method: 'POST', token: adminT, body: { username: 'abc', password: 'Siswa123!', name: 'Tanpa NISN', role: 'SISWA' } });
  check('siswa tanpa NISN/kelas ditolak (400)', badSiswa.status === 400, `status=${badSiswa.status}`);
  const usernameMismatch = await call('/users', { method: 'POST', token: adminT, body: { username: '1234567890', password: 'Siswa123!', name: 'Beda', role: 'SISWA', nisn: '1234567891', kelasId } });
  check('username siswa ≠ NISN ditolak (400)', usernameMismatch.status === 400, `status=${usernameMismatch.status}`);
  const detail = await call(`/users/${siswaA.id}`, { token: adminT });
  check('GET /users/:id', detail.status === 200 && detail.json?.id === siswaA.id, `status=${detail.status}`);
  const patch = await call(`/users/${siswaB.id}`, { method: 'PATCH', token: adminT, body: { name: 'Nama Diubah' } });
  check('PATCH /users/:id mengganti nama', patch.status === 200 && patch.json?.name === 'Nama Diubah', `${patch.status} ${patch.text.slice(0, 120)}`);
  const resetPw = await call(`/users/${siswaB.id}/reset-password`, { method: 'POST', token: adminT, body: { newPassword: 'Reset123!!' } });
  check('POST /users/:id/reset-password', resetPw.status < 300, `status=${resetPw.status}`);
  check('login dengan password hasil reset', (await call('/auth/login/siswa', { method: 'POST', body: { username: siswaB.username, password: 'Reset123!!' } })).status < 300);
  const tmpl = await call('/users/import/template', { token: adminT, raw: true });
  check('GET /users/import/template = xlsx', tmpl.status === 200 && /spreadsheetml/.test(tmpl.ct) && tmpl.buf.subarray(0, 2).toString() === 'PK', `${tmpl.status} ${tmpl.ct} len=${tmpl.len}`);
  const importXlsx = await import('xlsx').catch(() => null);
  if (importXlsx) {
    const rows = [
      ['username', 'password', 'name', 'role', 'nisn', 'kelasName'],
      [nisn(), 'Siswa123!', 'Import Audit', 'SISWA', '', kelasList[0]?.name ?? ''],
    ];
    const ws = importXlsx.utils.aoa_to_sheet(rows);
    const wb = importXlsx.utils.book_new();
    importXlsx.utils.book_append_sheet(wb, ws, 'Pengguna');
    const buf = importXlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fd = new FormData();
    fd.set('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'import.xlsx');
    const res = await fetch(`${BASE}/users/import`, { method: 'POST', headers: { Authorization: `Bearer ${adminT}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' }, body: fd });
    const text = await res.text();
    check('POST /users/import membaca Excel', res.status < 300, `${res.status} ${text.slice(0, 160)}`);
  } else {
    console.log('  SKIP  import Excel (modul xlsx tak tersedia di root)');
  }

  /* ---------------------------------------------------------------- */
  sectionOf('ADMIN — kelas & mapel');
  const ta = (await call('/kelas/tahun-ajaran', { token: adminT })).json;
  check('GET /kelas/tahun-ajaran', Array.isArray(asArr(ta)), JSON.stringify(ta).slice(0, 120));
  const newKelas = await call('/kelas', { method: 'POST', token: adminT, body: { name: `Audit Kelas ${Date.now().toString().slice(-5)}`, tingkat: 'X', tahunAjaran: '2026/2027' } });
  check('POST /kelas', newKelas.status === 201 && Boolean(newKelas.json?.id), `${newKelas.status} ${newKelas.text.slice(0, 120)}`);
  check('PATCH /kelas/:id', (await call(`/kelas/${newKelas.json.id}`, { method: 'PATCH', token: adminT, body: { tingkat: 'XI' } })).status === 200);
  check('DELETE /kelas/:id', (await call(`/kelas/${newKelas.json.id}`, { method: 'DELETE', token: adminT })).status === 200);
  const badTa = await call('/kelas', { method: 'POST', token: adminT, body: { name: 'Bad TA', tahunAjaran: '2026-2027' } });
  check('tahun ajaran tak valid ditolak (400)', badTa.status === 400, `status=${badTa.status}`);
  // Sesuai perilaku baru (2ae, 15 Nov 2026): kelas terpakai BOLEH dihapus —
  // siswa dilepas (kelasId null) & SessionKelas dihapus. Uji di kelas sementara,
  // BUKAN kelas seed.
  const tempDel = await call('/kelas', { method: 'POST', token: adminT, body: { name: `Audit Del ${Date.now().toString().slice(-5)}`, tingkat: 'X', tahunAjaran: '2026/2027' } });
  const tempSiswaDel = await makeUser(adminT, { role: 'SISWA', kelasId: tempDel.json.id });
  const delKelasDipakai = await call(`/kelas/${tempDel.json.id}`, { method: 'DELETE', token: adminT });
  check('kelas terpakai boleh dihapus — siswa dilepas (2ae)', delKelasDipakai.status === 200 && (delKelasDipakai.json?.detachedUsers ?? 0) >= 1, `${delKelasDipakai.status} ${delKelasDipakai.text.slice(0, 200)}`);
  const meDetached = await call('/auth/me', { token: tempSiswaDel.creds.accessToken });
  check('siswa kelasnya dihapus → kelasId null', meDetached.json?.kelasId === null, JSON.stringify(meDetached.json)?.slice(0, 140));
  await call(`/users/${tempSiswaDel.id}`, { method: 'DELETE', token: adminT });
  const newMapel = await call('/mapel', { method: 'POST', token: adminT, body: { name: `Audit Mapel ${Date.now().toString().slice(-5)}`, code: 'AUD' } });
  check('POST /mapel', newMapel.status === 201 && Boolean(newMapel.json?.id), `${newMapel.status} ${newMapel.text.slice(0, 120)}`);
  check('PATCH /mapel/:id', (await call(`/mapel/${newMapel.json.id}`, { method: 'PATCH', token: adminT, body: { name: 'Audit Mapel 2' } })).status === 200);
  check('DELETE /mapel/:id', (await call(`/mapel/${newMapel.json.id}`, { method: 'DELETE', token: adminT })).status === 200);

  /* ---------------------------------------------------------------- */
  sectionOf('ADMIN — settings & audit');
  const settings = await call('/settings', { token: adminT });
  check('GET /settings', settings.status === 200 && Array.isArray(settings.json?.keys), `${settings.status} ${settings.text.slice(0, 120)}`);
  const setSetting = await call('/settings', { method: 'PUT', token: adminT, body: { key: 'KKM_DEFAULT', value: '75' } });
  check('PUT /settings (upsert)', setSetting.status === 200, `${setSetting.status} ${setSetting.text.slice(0, 120)}`);
  const badKey = await call('/settings', { method: 'PUT', token: adminT, body: { key: 'SEMBARANG', value: '1' } });
  check('key konfigurasi tak dikenal ditolak (400)', badKey.status === 400, `status=${badKey.status}`);
  const audit = await call('/audit-logs?limit=5', { token: adminT });
  check('GET /audit-logs (ADMIN)', audit.status === 200 && Array.isArray(audit.json?.data), `${audit.status}`);
  check('GURU ditolak /audit-logs (403)', (await call('/audit-logs', { token: guruT })).status === 403);
  check('PROKTOR ditolak /settings (403)', (await call('/settings', { token: proktorT })).status === 403);

  /* ---------------------------------------------------------------- */
  sectionOf('GURU — bank soal 5 tipe');
  const qIds = {};
  for (const [type, body] of Object.entries(QUESTIONS)) {
    const r = await call('/questions', { method: 'POST', token: guruT, body });
    qIds[type] = r.json?.id;
    check(`POST /questions ${type}`, r.status === 201 && Boolean(r.json?.id), `${r.status} ${r.text.slice(0, 140)}`);
  }
  const preview = await call(`/questions/${qIds.PG}/preview`, { token: guruT });
  check('GET /questions/:id/preview', preview.status === 200, `${preview.status}`);
  const dupQ = await call(`/questions/${qIds.PG}/duplicate`, { method: 'POST', token: guruT });
  check('POST /questions/:id/duplicate', dupQ.status === 201 && Boolean(dupQ.json?.id), `${dupQ.status}`);
  const updQ = await call(`/questions/${dupQ.json?.id}`, { method: 'PATCH', token: guruT, body: { ...QUESTIONS.ISIAN_SINGKAT, content: 'Soal diubah (audit)' } });
  check('PATCH /questions/:id ganti tipe', updQ.status === 200, `${updQ.status} ${updQ.text.slice(0, 120)}`);
  check('DELETE /questions/:id', (await call(`/questions/${dupQ.json?.id}`, { method: 'DELETE', token: guruT })).status === 200);
  const noKey = await call('/questions', { method: 'POST', token: guruT, body: { ...QUESTIONS.PG, correctChoices: ['zz'] } });
  check('kunci di luar opsi ditolak (400)', noKey.status === 400, `status=${noKey.status}`);
  const guru2Q = await call('/questions', { method: 'POST', token: guru2.creds.accessToken, body: QUESTIONS.PG });
  check('soal guru lain tak terlihat di detail guru (404)', (await call(`/questions/${guru2Q.json?.id}`, { token: guruT })).status === 404);
  check('SISWA ditolak /questions (403)', (await call('/questions', { token: siswaA.creds.accessToken })).status === 403);
  check('PROKTOR ditolak /questions (403)', (await call('/questions', { token: proktorT })).status === 403);

  /* ---------------------------------------------------------------- */
  sectionOf('GURU — ujian, sesi, token, ujian siswa');
  const exam = await call('/exams', { method: 'POST', token: guruT, body: { title: 'Audit Role Exam', mapelId } });
  const examId = exam.json?.id;
  check('POST /exams', exam.status === 201 && Boolean(examId), `${exam.status} ${exam.text.slice(0, 140)}`);
  const setQ = await call(`/exams/${examId}/questions`, { method: 'PUT', token: guruT, body: { questionIds: [qIds.PG, qIds.PG_KOMPLEKS, qIds.MATCHING, qIds.BENAR_SALAH, qIds.ISIAN_SINGKAT] } });
  check('PUT /exams/:id/questions (5 soal)', setQ.status === 200 && setQ.json?.count === 5, `${setQ.status} ${setQ.text.slice(0, 140)}`);
  check('GURU lain tak bisa lihat ujian (404)', (await call(`/exams/${examId}`, { token: guru2.creds.accessToken })).status === 404);
  check('analitik guru lain ditolak (403)', (await call(`/exams/${examId}/analytics`, { token: guru2.creds.accessToken })).status === 403);
  check('sertifikat → 404 (BA Digital dihapus)', (await call(`/exams/${examId}/certificate?userId=${siswaA.id}`, { token: guru2.creds.accessToken })).status === 404);
  check('GURU pemilik boleh baca analitik ujiannya (200)', (await call(`/exams/${examId}/analytics`, { token: guruT })).status === 200);
  check('PROKTOR ditolak analitik (403)', (await call(`/exams/${examId}/analytics`, { token: proktorT })).status === 403);

  const now = Date.now();
  const sess = await call('/sessions', {
    method: 'POST',
    token: guruT,
    body: {
      examId,
      title: 'Audit Role Session',
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 60 * 60_000).toISOString(),
      durationMin: 30,
      tokenIntervalSec: 120,
      maxViolations: 3,
      requireSeb: false,
      shuffleQuestions: true,
      shuffleOptions: true,
      kelasIds: [kelasId],
    },
  });
  const sessionId = sess.json?.id;
  check('POST /sessions', sess.status === 201 && Boolean(sessionId), `${sess.status} ${sess.text.slice(0, 160)}`);
  const sessList = await call('/sessions?limit=100', { token: proktorT });
  check('PROKTOR boleh baca daftar sesi', sessList.status === 200 && Array.isArray(sessList.json?.data), `${sessList.status}`);
  check('SISWA ditolak daftar sesi (403)', (await call('/sessions', { token: siswaA.creds.accessToken })).status === 403);
  check('PROKTOR tak boleh baca detail sesi guru? — memang boleh (200)', (await call(`/sessions/${sessionId}`, { token: proktorT })).status === 200);
  check('PROKTOR boleh ubah sesi (pengaturan pelaksanaan)', (await call(`/sessions/${sessionId}`, { method: 'PATCH', token: proktorT, body: { durationMin: 40 } })).status === 200);
  const noSchool = await call('/sessions', { method: 'POST', token: guru2.creds.accessToken, body: { examId, durationMin: 10 } });
  check('GURU lain tak bisa pakai ujian guru (404)', noSchool.status === 404, `status=${noSchool.status}`);
  const skipStatus = await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guruT, body: { status: 'ACTIVE' } });
  check('transisi DRAFT→ACTIVE (tampilkan ke siswa) — 200 sesuai Hari Ujian', skipStatus.status === 200, `status=${skipStatus.status}`);
  check('PATCH status → SCHEDULED', (await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guruT, body: { status: 'SCHEDULED' } })).status === 200);
  check('PATCH status → ACTIVE', (await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guruT, body: { status: 'ACTIVE' } })).status === 200);
  const activeState = await call(`/sessions/${sessionId}`, { token: guruT });
  check('sesi berstatus ACTIVE', activeState.json?.status === 'ACTIVE', `status=${activeState.json?.status}`);

  const curToken = await call(`/sessions/${sessionId}/token/current`, { token: proktorT });
  const token = curToken.json?.token;
  check('PROKTOR GET token/current (6 digit)', curToken.status === 200 && /^\d{6}$/.test(token ?? ''), `${curToken.status} ${curToken.text.slice(0, 120)}`);
  check('GURU ditolak token/current (403)', (await call(`/sessions/${sessionId}/token/current`, { token: guruT })).status === 403);
  check('GURU ditolak token/release (403)', (await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: guruT, body: {} })).status === 403);
  check('GURU lain ditolak token/current (403)', (await call(`/sessions/${sessionId}/token/current`, { token: guru2.creds.accessToken })).status === 403);
  check('SISWA ditolak token/current (403)', (await call(`/sessions/${sessionId}/token/current`, { token: siswaA.creds.accessToken })).status === 403);
  check('PROKTOR POST token/release', (await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktorT, body: { note: 'audit' } })).status === 201);

  /* ---------------------------------------------------------------- */
  sectionOf('GURU — aturan sesi: ganti kelas peserta & gerbang SEB');
  // Kelas sementara khusus uji setKelas; sesi draf + kelas ini dibersihkan lagi
  // di akhir blok supaya tidak meninggalkan data uji.
  const tmpKelas = await call('/kelas', {
    method: 'POST',
    token: adminT,
    body: { name: `AUDIT-TMP ${Date.now().toString().slice(-6)}`, tingkat: 'X', tahunAjaran: '2026/2027' },
  });
  const tmpKelasId = tmpKelas.json?.id;
  const sessTmp = await call('/sessions', {
    method: 'POST',
    token: guruT,
    body: { examId, title: 'Audit Ganti Kelas', durationMin: 10, kelasIds: [kelasId] },
  });
  const sessTmpId = sessTmp.json?.id;
  const setKelas = await call(`/sessions/${sessTmpId}/kelas`, { method: 'PUT', token: guruT, body: { kelasIds: [kelasId, tmpKelasId] } });
  check('PUT /sessions/:id/kelas menambah peserta', setKelas.status === 200 && setKelas.json?.kelasLinks?.length === 2, `${setKelas.status} n=${setKelas.json?.kelasLinks?.length}`);
  const setKelasDup = await call(`/sessions/${sessTmpId}/kelas`, { method: 'PUT', token: guruT, body: { kelasIds: [kelasId, kelasId] } });
  check('kelas duplikat diturunkan (bukan 500)', setKelasDup.status === 200 && setKelasDup.json?.kelasLinks?.length === 1, `${setKelasDup.status} n=${setKelasDup.json?.kelasLinks?.length}`);
  check('kelas tak dikenal ditolak (400)', (await call(`/sessions/${sessTmpId}/kelas`, { method: 'PUT', token: guruT, body: { kelasIds: ['tidak-ada-kelas'] } })).status === 400);
  check('PROKTOR boleh ganti kelas sesi (pengaturan pelaksanaan, 200)', (await call(`/sessions/${sessTmpId}/kelas`, { method: 'PUT', token: proktorT, body: { kelasIds: [kelasId] } })).status === 200);
  check('sesi draf tanpa data turunan bisa dihapus', (await call(`/sessions/${sessTmpId}`, { method: 'DELETE', token: guruT })).status === 200);
  check('kelas sementara ikut terbersihkan', (await call(`/kelas/${tmpKelasId}`, { method: 'DELETE', token: adminT })).status === 200);

  const sess2 = await call('/sessions', {
    method: 'POST',
    token: guruT,
    body: {
      examId,
      title: 'Audit SEB Session',
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 60 * 60_000).toISOString(),
      durationMin: 20,
      requireSeb: true,
      kelasIds: [kelasId],
    },
  });
  const sess2Id = sess2.json?.id;
  check('POST sesi dengan requireSeb', sess2.status === 201 && Boolean(sess2Id), `${sess2.status} ${sess2.text.slice(0, 140)}`);
  await call(`/sessions/${sess2Id}/status`, { method: 'PATCH', token: guruT, body: { status: 'SCHEDULED' } });
  await call(`/sessions/${sess2Id}/status`, { method: 'PATCH', token: guruT, body: { status: 'ACTIVE' } });
  const tok2 = (await call(`/sessions/${sess2Id}/token/current`, { token: proktorT })).json?.token;
  // Klaim klien `seb:true` TIDAK cukup: tanpa header request-hash SEB tetap 400.
  const sebNo = await call('/attempts/start', { method: 'POST', token: siswaA.creds.accessToken, body: { sessionId: sess2Id, token: tok2, seb: true } });
  check('sesi wajib SEB: klaim klien saja ditolak (400)', sebNo.status === 400, `status=${sebNo.status}`);
  const sebBad = await call('/attempts/start', {
    method: 'POST',
    token: siswaA.creds.accessToken,
    headers: { 'X-SafeExamBrowser-RequestHash': '0'.repeat(64) },
    body: { sessionId: sess2Id, token: tok2, seb: true },
  });
  check('sesi wajib SEB: request-hash salah ditolak (400)', sebBad.status === 400, `status=${sebBad.status}`);
  const sebYes = await call('/attempts/start', {
    method: 'POST',
    token: siswaA.creds.accessToken,
    headers: sebHeaders('/attempts/start'),
    body: { sessionId: sess2Id, token: tok2, seb: true },
  });
  check('sesi wajib SEB: request-hash valid diterima', sebYes.status === 201 && sebYes.json?.attempt?.sebVerified === true, `${sebYes.status} ${sebYes.text.slice(0, 140)}`);
  const sebAttemptId = sebYes.json?.attempt?.id;
  const sebStateNo = await call(`/attempts/${sebAttemptId}`, { token: siswaA.creds.accessToken });
  check('sesi wajib SEB: state tanpa header ditolak (400)', sebStateNo.status === 400, `status=${sebStateNo.status}`);
  const sebStateYes = await call(`/attempts/${sebAttemptId}`, {
    token: siswaA.creds.accessToken,
    headers: sebHeaders(`/attempts/${sebAttemptId}`),
  });
  check('sesi wajib SEB: state dengan header valid diterima', sebStateYes.status === 200, `status=${sebStateYes.status} ${sebStateYes.text.slice(0, 100)}`);
  const sebC = await call('/attempts/start', {
    method: 'POST',
    token: siswaC.creds.accessToken,
    headers: sebHeaders('/attempts/start'),
    body: { sessionId: sess2Id, token: tok2, seb: true },
  });
  check('siswa kelas lain ditolak ikut ujian (403)', sebC.status === 403, `${sebC.status}`);

  /* ---------------------------------------------------------------- */
  sectionOf('Fitur — attempt siswa semua tipe soal');
  const avail = await call('/attempts/available', { token: siswaA.creds.accessToken });
  check('GET /attempts/available memuat sesi ACTIVE', avail.status === 200 && asArr(avail.json).some((s) => s.id === sessionId), `${avail.status}`);
  const availOut = await call('/attempts/available', { token: siswaC.creds.accessToken });
  check(
    'siswa luar kelas peserta TIDAK melihat sesi',
    availOut.status === 200 && !asArr(availOut.json).some((s) => s.id === sessionId),
    `${availOut.status} n=${asArr(availOut.json).length}`,
  );
  const startOut = await call('/attempts/start', { method: 'POST', token: siswaC.creds.accessToken, body: { sessionId, token, seb: false } });
  check('siswa luar kelas peserta tak bisa start (403/404)', [403, 404].includes(startOut.status), `status=${startOut.status}`);

  const startA = await call('/attempts/start', { method: 'POST', token: siswaA.creds.accessToken, body: { sessionId, token, seb: false } });
  const attemptA = startA.json?.attempt?.id;
  check('POST /attempts/start siswa A', startA.status === 201 && Boolean(attemptA), `${startA.status} ${startA.text.slice(0, 160)}`);
  check('soal tersanitasi tanpa kunci jawaban', Array.isArray(startA.json?.questions) && startA.json.questions.every((q) => !('correctChoices' in q) && !('acceptedAnswers' in q) && !('statements' in q && q.statements?.some((s) => 'answer' in s)) && !('pairs' in q && q.pairs?.mapping)), JSON.stringify(startA.json?.questions?.[0] ?? {}).slice(0, 200));

  const answersA = [
    { q: qIds.PG, payload: 'b' },
    { q: qIds.PG_KOMPLEKS, payload: ['a', 'c'] },
    { q: qIds.MATCHING, payload: { l1: 'r1', l2: 'r2' } },
    { q: qIds.BENAR_SALAH, payload: { s1: true, s2: false } },
    // Jawaban isian sengaja tidak cocok kunci mana pun agar masuk antrean
    // review manual guru (jalur penilaian manual Fase 7).
    { q: qIds.ISIAN_SINGKAT, payload: 'bandung' },
  ];
  for (const a of answersA) {
    const r = await call(`/attempts/${attemptA}/answers`, { method: 'PUT', token: siswaA.creds.accessToken, body: { questionId: a.q, payload: a.payload } });
    check(`autosave ${JSON.stringify(a.payload).slice(0, 24)}`, r.status === 200, `${r.status} ${r.text.slice(0, 120)}`);
  }
  const stateA = await call(`/attempts/${attemptA}`, { token: siswaA.creds.accessToken });
  check('GET state attempt memuat 5 jawaban', Array.isArray(stateA.json?.answers) && stateA.json.answers.length === 5, `n=${stateA.json?.answers?.length}`);

  check('SISWA lain tak bisa baca attempt A (404/403)', [403, 404].includes((await call(`/attempts/${attemptA}`, { token: siswaB.creds.accessToken })).status));
  check('SISWA lain tak bisa simpan jawaban attempt A', [403, 404].includes((await call(`/attempts/${attemptA}/answers`, { method: 'PUT', token: siswaB.creds.accessToken, body: { questionId: qIds.PG, payload: 'a' } })).status));
  check('GURU tak bisa baca attempt siswa (403)', (await call(`/attempts/${attemptA}`, { token: guruT })).status === 403);

  const integ = await call(`/attempts/${attemptA}/integrity`, { method: 'POST', token: siswaA.creds.accessToken, body: { type: 'TAB_SWITCH', detail: { n: 1 } } });
  check('POST integrity (catat pelanggaran)', integ.status === 201 && integ.json?.violationCount === 1, `${integ.status} ${integ.text.slice(0, 140)}`);
  const badInteg = await call(`/attempts/${attemptA}/integrity`, { method: 'POST', token: siswaA.creds.accessToken, body: { type: 'NGACO' } });
  check('tipe integritas tak dikenal ditolak (400)', badInteg.status === 400, `status=${badInteg.status}`);

  /* ---------------------------------------------------------------- */
  sectionOf('PROKTOR — monitoring & kendali');
  const board = await call(`/sessions/${sessionId}/monitoring`, { token: proktorT });
  check('GET monitoring board', board.status === 200 && board.json?.summary?.inProgress >= 1, `${board.status} ${JSON.stringify(board.json?.summary)}`);
  check('GURU pemilik boleh monitoring (200)', (await call(`/sessions/${sessionId}/monitoring`, { token: guruT })).status === 200);
  check('GURU lain ditolak monitoring (403)', (await call(`/sessions/${sessionId}/monitoring`, { token: guru2.creds.accessToken })).status === 403);
  check('SISWA ditolak monitoring (403)', (await call(`/sessions/${sessionId}/monitoring`, { token: siswaA.creds.accessToken })).status === 403);
  check('POST monitoring/refresh', (await call(`/sessions/${sessionId}/monitoring/refresh`, { method: 'POST', token: proktorT })).status === 201);

  const warn = await call(`/attempts/${attemptA}/warn`, { method: 'POST', token: proktorT, body: { message: 'Fokus ke layar' } });
  check('POST warn ke peserta', warn.status === 201 && warn.json?.ok === true, `${warn.status} ${warn.text.slice(0, 120)}`);
  check('SISWA ditolak warn (403)', (await call(`/attempts/${attemptA}/warn`, { method: 'POST', token: siswaA.creds.accessToken, body: { message: 'x' } })).status === 403);
  const extend = await call(`/attempts/${attemptA}/extend`, { method: 'POST', token: proktorT, body: { minutes: 5, note: 'audit' } });
  check('POST extend perpanjang waktu', extend.status === 201 && extend.json?.ok === true, `${extend.status} ${extend.text.slice(0, 120)}`);
  const extendOver = await call(`/attempts/${attemptA}/extend`, { method: 'POST', token: proktorT, body: { minutes: 999 } });
  check('extend melebihi batas ditolak (400)', extendOver.status === 400, `status=${extendOver.status}`);

  const integrity = await call(`/sessions/${sessionId}/integrity`, { token: proktorT });
  check('GET integrity sesi memuat log', integrity.status === 200 && integrity.json?.count >= 2, `${integrity.status} count=${integrity.json?.count}`);
  check('GURU pemilik boleh integrity (200)', (await call(`/sessions/${sessionId}/integrity`, { token: guruT })).status === 200);
  check('GURU lain ditolak integrity (403)', (await call(`/sessions/${sessionId}/integrity`, { token: guru2.creds.accessToken })).status === 403);

  const attList = await call(`/sessions/${sessionId}/attendance`, { token: proktorT });
  check('GET attendance', attList.status === 200 && Array.isArray(attList.json?.data), `${attList.status}`);
  const attSet = await call(`/sessions/${sessionId}/attendance`, { method: 'PUT', token: proktorT, body: { items: [{ userId: siswaA.id, status: 'HADIR' }, { userId: siswaB.id, status: 'SAKIT', note: 'surat' }] } });
  check('PUT attendance massal', attSet.status === 200 && attSet.json?.summary?.recorded === 2, `${attSet.status} ${JSON.stringify(attSet.json?.summary)}`);
  const attBad = await call(`/sessions/${sessionId}/attendance`, { method: 'PUT', token: proktorT, body: { items: [{ userId: guru2.id, status: 'HADIR' }] } });
  check('absensi non-peserta ditolak (400)', attBad.status === 400, `status=${attBad.status}`);
  check('GURU pemilik boleh attendance (200)', (await call(`/sessions/${sessionId}/attendance`, { token: guruT })).status === 200);
  check('GURU lain ditolak attendance (403)', (await call(`/sessions/${sessionId}/attendance`, { token: guru2.creds.accessToken })).status === 403);

  const integGlobal = await call('/integrity', { token: proktorT });
  check('GET /integrity (proktor) → 200', integGlobal.status === 200 && typeof integGlobal.json?.count === 'number', `status=${integGlobal.status}`);
  check('GURU ditolak /integrity (403)', (await call('/integrity', { token: guruT })).status === 403);
  check('SISWA ditolak /integrity (403)', (await call('/integrity', { token: siswaA.creds.accessToken })).status === 403);


  /* ---------------------------------------------------------------- */
  sectionOf('PROKTOR — kartu peserta UNIVERSAL');
  const kartuCount = await call('/kartu/count', { token: proktorT });
  check('GET /kartu/count (proktor) → 200 + total angka', kartuCount.status === 200 && typeof kartuCount.json?.total === 'number', `status=${kartuCount.status}`);
  const pdf = await call('/kartu/pdf', { token: proktorT, raw: true });
  check('GET /kartu/pdf = PDF asli', pdf.status === 200 && pdf.ct.includes('application/pdf') && pdf.buf.subarray(0, 4).toString() === '%PDF', `status=${pdf.status} ${pdf.ct} len=${pdf.len}`);
  check('GURU ditolak /kartu/pdf (403)', (await call('/kartu/pdf', { token: guruT })).status === 403);
  check('SISWA ditolak /kartu/pdf (403)', (await call('/kartu/pdf', { token: siswaA.creds.accessToken })).status === 403);

  /* ---------------------------------------------------------------- */
  sectionOf('PROKTOR — export Excel');
  for (const kind of ['absensi', 'ringkasan']) {
    const r = await call(`/sessions/${sessionId}/export/${kind}`, { token: proktorT, raw: true });
    check(`GET export/${kind} = xlsx`, r.status === 200 && r.buf.subarray(0, 2).toString() === 'PK' && /spreadsheetml/.test(r.ct), `${r.status} ${r.ct} len=${r.len}`);
  }
  check('GURU pemilik boleh export absensi (200)', (await call(`/sessions/${sessionId}/export/absensi`, { token: guruT, raw: true })).status === 200);
  check('GURU lain ditolak export absensi (403)', (await call(`/sessions/${sessionId}/export/absensi`, { token: guru2.creds.accessToken })).status === 403);
  check('SISWA ditolak export (403)', (await call(`/sessions/${sessionId}/export/absensi`, { token: siswaA.creds.accessToken })).status === 403);

  /* ---------------------------------------------------------------- */
  sectionOf('BA Digital dihapus — endpoint sertifikat hilang');
  const certEarly = await call(`/exams/${examId}/certificate?userId=${siswaA.id}`, { token: proktorT, raw: true });
  check('sertifikat → 404 (fitur dihapus)', certEarly.status === 404, `status=${certEarly.status}`);
  check('route hilang meski guru pemilik → 404', (await call(`/exams/${examId}/certificate?userId=${siswaA.id}`, { token: guruT })).status === 404);
  check('route hilang meski admin → 404', (await call(`/exams/${examId}/certificate?userId=${siswaA.id}`, { token: adminT })).status === 404);

  /* ---------------------------------------------------------------- */
  sectionOf('SISWA — submit & kendali proktor');
  const forceTarget = await call('/attempts/start', { method: 'POST', token: siswaB.creds.accessToken, body: { sessionId, token, seb: false } });
  const attemptB = forceTarget.json?.attempt?.id;
  check('POST /attempts/start siswa B', forceTarget.status === 201 && Boolean(attemptB), `${forceTarget.status}`);
  const force = await call(`/attempts/${attemptB}/force-submit`, { method: 'POST', token: proktorT });
  check('POST force-submit proktor', force.status === 201 && force.json?.status === 'FORCE_SUBMITTED', `${force.status} ${force.text.slice(0, 140)}`);
  check('siswa B tak bisa simpan jawaban setelah force-submit (409)', (await call(`/attempts/${attemptB}/answers`, { method: 'PUT', token: siswaB.creds.accessToken, body: { questionId: qIds.PG, payload: 'b' } })).status === 409);

  const submit = await call(`/attempts/${attemptA}/submit`, { method: 'POST', token: siswaA.creds.accessToken, body: { reason: 'MANUAL' } });
  check('POST submit siswa A → SUBMITTED', submit.status === 201 && submit.json?.attempt?.status === 'SUBMITTED', `${submit.status} ${JSON.stringify(submit.json?.attempt)}`);
  const doubleSubmit = await call(`/attempts/${attemptA}/submit`, { method: 'POST', token: siswaA.creds.accessToken, body: { reason: 'MANUAL' } });
  check(
    'submit kedua idempoten (tetap SUBMITTED, tidak kembali IN_PROGRESS)',
    doubleSubmit.status < 300 && doubleSubmit.json?.attempt?.status === 'SUBMITTED',
    `${doubleSubmit.status} ${doubleSubmit.json?.attempt?.status}`,
  );
  const submitOther = await call(`/attempts/${attemptB}/submit`, { method: 'POST', token: siswaA.creds.accessToken, body: { reason: 'MANUAL' } });
  check('siswa A tak bisa submit attempt siswa B', [403, 404, 409].includes(submitOther.status), `status=${submitOther.status}`);

  /* ---------------------------------------------------------------- */
  sectionOf('GURU — penilaian, review, publish, analisis');
  const gradingSummary = await call(`/sessions/${sessionId}/grading`, { token: guruT });
  check('GET grading summary', gradingSummary.status === 200, `${gradingSummary.status} ${gradingSummary.text.slice(0, 140)}`);
  check('PROKTOR ditolak grading (403)', (await call(`/sessions/${sessionId}/grading`, { token: proktorT })).status === 403);
  const grade = await call(`/sessions/${sessionId}/grade`, { method: 'POST', token: guruT });
  check('POST grade (nilai ulang)', grade.status === 201 && typeof grade.json?.graded === 'number', `${grade.status} ${grade.text.slice(0, 140)}`);
  check('PROKTOR ditolak grade (403)', (await call(`/sessions/${sessionId}/grade`, { method: 'POST', token: proktorT })).status === 403);
  const results = await call(`/sessions/${sessionId}/results`, { token: guruT });
  check('GET results', results.status === 200 && Array.isArray(results.json?.data ?? results.json), `${results.status}`);
  check('PROKTOR ditolak results (403)', (await call(`/sessions/${sessionId}/results`, { token: proktorT })).status === 403);
  const reviews = await call(`/sessions/${sessionId}/reviews`, { token: guruT });
  check('GET reviews (isian manual)', reviews.status === 200 && Array.isArray(reviews.json?.data ?? reviews.json), `${reviews.status}`);
  const reviewRows = asArr(reviews.json?.data ?? reviews.json);
  check('butir isian tak cocok kunci masuk antrean review', reviewRows.length >= 1, `n=${reviewRows.length}`);
  const itemAnalysis = await call(`/sessions/${sessionId}/item-analysis`, { token: guruT });
  check('GET item-analysis', itemAnalysis.status === 200, `${itemAnalysis.status} ${itemAnalysis.text.slice(0, 120)}`);
  check('PROKTOR ditolak item-analysis (403)', (await call(`/sessions/${sessionId}/item-analysis`, { token: proktorT })).status === 403);

  const reviewRow = reviewRows[0];
  const resultBefore = await call(`/attempts/${attemptA}/result`, { token: siswaA.creds.accessToken });
  check('endpoint hasil siswa DIHAPUS (404)', resultBefore.status === 404, `status=${resultBefore.status}`);
  const publishEarly = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guruT, body: { published: true } });
  check('publish saat sesi belum CLOSED ditolak (409)', publishEarly.status === 409, `status=${publishEarly.status}`);
  const publishOther = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru2.creds.accessToken, body: { published: true } });
  check('GURU lain ditolak publish (403/404)', [403, 404].includes(publishOther.status), `status=${publishOther.status}`);
  check('PROKTOR ditolak publish (403)', (await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: proktorT, body: { published: true } })).status === 403);

  const close = await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guruT, body: { status: 'CLOSED' } });
  check('PATCH status → CLOSED', close.status === 200, `${close.status} ${close.text.slice(0, 120)}`);
  const publishPending = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guruT, body: { published: true } });
  check('publish tertahan selama masih ada review manual (409)', publishPending.status === 409, `status=${publishPending.status}`);

  if (reviewRow) {
    const rv = await call(`/attempts/${reviewRow.attemptId}/review`, { method: 'POST', token: guruT, body: { questionId: reviewRow.questionId, score: 1, note: 'audit' } });
    check('POST review manual isian', rv.status === 201, `${rv.status} ${rv.text.slice(0, 140)}`);
    const rvTooBig = await call(`/attempts/${reviewRow.attemptId}/review`, { method: 'POST', token: guruT, body: { questionId: reviewRow.questionId, score: 999 } });
    check('skor melebihi bobot ditolak (400)', rvTooBig.status === 400, `status=${rvTooBig.status}`);
    check('PROKTOR ditolak review manual (403)', (await call(`/attempts/${reviewRow.attemptId}/review`, { method: 'POST', token: proktorT, body: { questionId: reviewRow.questionId, score: 1 } })).status === 403);
    const afterReview = await call(`/sessions/${sessionId}/reviews`, { token: guruT });
    check('antrean review kosong setelah diputuskan', asArr(afterReview.json?.data ?? afterReview.json).length === 0, `n=${asArr(afterReview.json?.data ?? afterReview.json).length}`);
  } else {
    console.log('  SKIP  review manual (tidak ada butir menunggu)');
  }

  const publish = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guruT, body: { published: true } });
  check('POST publish hasil', publish.status === 201, `${publish.status} ${publish.text.slice(0, 140)}`);
  const resultAfter = await call(`/attempts/${attemptA}/result`, { token: siswaA.creds.accessToken });
  check('endpoint hasil siswa tetap 404 setelah publish', resultAfter.status === 404, `${resultAfter.status}`);
  check('siswa tak bisa lihat hasil siswa lain', [403, 404].includes((await call(`/attempts/${attemptB}/result`, { token: siswaA.creds.accessToken })).status));

  sectionOf('kebersihan & batas umum');
  check('SISWA ditolak /exams (403)', (await call('/exams', { token: siswaA.creds.accessToken })).status === 403);
  check('PROKTOR ditolak /exams (403)', (await call('/exams', { token: proktorT })).status === 403);
  check('endpoint tak dikenal → 404', (await call('/tidak-ada-endpoint', { token: adminT })).status === 404);
  check('health publik', (await call('/health')).status === 200);
  const delSession = await call(`/sessions/${sessionId}`, { method: 'DELETE', token: guruT });
  check('sesi berdata tidak bisa dihapus oleh guru pemilik (409)', delSession.status === 409, `status=${delSession.status}`);
  const delAdmin = await call(`/sessions/${sessionId}`, { method: 'DELETE', token: adminT });
  check('admin boleh menghapus sesi berdata (200)', delAdmin.status === 200 && delAdmin.json?.ok === true, `${delAdmin.status} ${delAdmin.text.slice(0, 200)}`);
  const afterDel = await call(`/sessions/${sessionId}`, { token: adminT });
  check('sesi benar-benar terhapus (404)', afterDel.status === 404, `status=${afterDel.status}`);
  // Bersihkan artefak audit: siswa uji dipindah ke kelas seed, lalu kelas uji dihapus.
  check('siswa uji dipindah kembali ke kelas seed', (await call(`/users/${siswaC.id}`, { method: 'PATCH', token: adminT, body: { kelasId } })).status === 200);
  const delFixture = await call(`/kelas/${fixtureKelasId}`, { method: 'DELETE', token: adminT });
  check('kelas uji audit dibersihkan', delFixture.status === 200, `${delFixture.status} ${delFixture.text.slice(0, 120)}`);

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
