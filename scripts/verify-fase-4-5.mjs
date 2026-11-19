// Verifikasi eksekusi Fase 4 (Proktor) + Fase 5 (Ruang ujian siswa).
// Jalankan: node scripts/verify-fase-4-5.mjs
const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';

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

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') ?? '' };
}

async function login(role, username, password) {
  const r = await api(`/auth/login/${role}`, { method: 'POST', body: { username, password } });
  if (r.status >= 300 || !r.json?.accessToken) {
    throw new Error(`Login ${role} gagal: ${r.status} ${r.text}`);
  }
  return r.json.accessToken;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`== CBT Fase 4-5 verification @ ${BASE} ==\n`);

  // ---- Auth ----
  console.log('[auth]');
  const admin = await login('admin', 'admin', 'Admin123!');
  const guru = await login('guru', 'guru', 'Guru123!');
  const proktor = await login('proktor', 'proktor', 'Proktor123!');
  const siswa = await login('siswa', '0051234567', 'Siswa123!');
  check('login 4 role', Boolean(admin && guru && proktor && siswa));

  // ---- Master data ----
  console.log('\n[master]');
  const kelasRes = await api('/kelas', { token: admin });
  // Kelas seed dipilih dari NISN siswa seed, bukan indeks 0 — daftar kelas bisa
  // bertambah karena data uji lain sehingga urutannya bergeser.
  const seedRows = ((x) => (Array.isArray(x) ? x : (x?.data ?? [])))(
    (await api('/users?role=SISWA&search=0051234567&limit=5', { token: admin })).json,
  );
  const kelasId = seedRows.find((u) => u.username === '0051234567')?.kelasId ?? kelasRes.json?.data?.[0]?.id ?? kelasRes.json?.[0]?.id;
  check('GET /kelas mengembalikan kelas', Boolean(kelasId), JSON.stringify(kelasRes.json).slice(0, 120));
  const mapelRes = await api('/mapel', { token: admin });
  const mapelId = mapelRes.json?.data?.[0]?.id ?? mapelRes.json?.[0]?.id;
  check('GET /mapel mengembalikan mapel', Boolean(mapelId));
  const me = await api('/auth/me', { token: siswa });
  check('siswa punya kelas (seed)', me.json?.kelasId === kelasId, `kelasId=${me.json?.kelasId}`);

  // ---- Fase 2: bank soal (PG) ----
  console.log('\n[Fase 2 — soal]');
  const qRes = await api('/questions', {
    method: 'POST',
    token: guru,
    body: {
      type: 'PG',
      content: 'Berapa hasil 2 + 2? (uji Fase 5)',
      weight: 1,
      scoringMode: 'ALL_OR_NOTHING',
      choices: [
        { id: 'a', label: '3' },
        { id: 'b', label: '4' },
        { id: 'c', label: '5' },
      ],
      correctChoices: ['b'],
    },
  });
  const questionId = qRes.json?.id;
  check('POST /questions (PG) membuat soal', qRes.status === 201 && Boolean(questionId), `${qRes.status} ${qRes.text.slice(0, 120)}`);

  // ---- Fase 3: ujian + sesi ----
  console.log('\n[Fase 3 — ujian & sesi]');
  const exRes = await api('/exams', { method: 'POST', token: guru, body: { title: 'Uji Fase 5', description: 'verifikasi', mapelId } });
  const examId = exRes.json?.id;
  check('POST /exams', exRes.status === 201 && Boolean(examId), `${exRes.status}`);
  const setQ = await api(`/exams/${examId}/questions`, { method: 'PUT', token: guru, body: { questionIds: [questionId] } });
  check('PUT /exams/:id/questions', setQ.status === 200, `${setQ.status} ${setQ.text.slice(0, 120)}`);

  const now = Date.now();
  const sRes = await api('/sessions', {
    method: 'POST',
    token: guru,
    body: {
      examId,
      title: 'Sesi Uji Fase 5',
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 30 * 60_000).toISOString(),
      durationMin: 20,
      tokenIntervalSec: 120,
      maxViolations: 3,
      requireSeb: false,
      shuffleQuestions: true,
      shuffleOptions: true,
      kelasIds: [kelasId],
    },
  });
  const sessionId = sRes.json?.id;
  check('POST /sessions', sRes.status === 201 && Boolean(sessionId), `${sRes.status} ${sRes.text.slice(0, 160)}`);
  const st1 = await api(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'SCHEDULED' } });
  check('PATCH status → SCHEDULED', st1.status === 200, `${st1.status} ${st1.text.slice(0, 120)}`);

  // Siswa belum bisa start saat SCHEDULED
  const early = await api('/attempts/start', { method: 'POST', token: siswa, body: { sessionId, token: '123456' } });
  check('start ditolak saat sesi belum ACTIVE', early.status === 409, `status=${early.status}`);

  const st2 = await api(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'ACTIVE' } });
  check('PATCH status → ACTIVE', st2.status === 200, `${st2.status} ${st2.text.slice(0, 120)}`);

  // ---- Fase 4: Proktor ----
  console.log('\n[Fase 4 — proktor]');
  const rel = await api(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktor, body: { note: 'uji otomatis' } });
  const token = rel.json?.token;
  check('POST token/release menghasilkan token 6 digit', rel.status === 201 && /^\d{6}$/.test(token ?? ''), `${rel.status} ${rel.text.slice(0, 120)}`);
  const cur = await api(`/sessions/${sessionId}/token/current`, { token: proktor });
  check('GET token/current', cur.status === 200 && /^\d{6}$/.test(cur.json?.token ?? ''), `${cur.status}`);
  const forbidden = await api(`/sessions/${sessionId}/token/current`, { token: siswa });
  check('siswa ditolak token/current (403)', forbidden.status === 403, `status=${forbidden.status}`);

  const att = await api(`/sessions/${sessionId}/attendance`, { token: proktor });
  check('GET attendance', att.status === 200 && Array.isArray(att.json?.data), `${att.status}`);
  const attSet = await api(`/sessions/${sessionId}/attendance`, {
    method: 'PUT',
    token: proktor,
    body: { items: [{ userId: me.json.id, status: 'HADIR' }] },
  });
  check('PUT attendance (tandai HADIR)', attSet.status === 200, `${attSet.status} ${attSet.text.slice(0, 120)}`);

  const kartuRes = await fetch(`${BASE}/kartu/pdf`, { headers: { Authorization: `Bearer ${proktor}` } });
  const kartuBuf = Buffer.from(await kartuRes.arrayBuffer());
  check('GET /kartu/pdf (universal) = PDF asli', kartuRes.status === 200 && kartuBuf.subarray(0, 4).toString() === '%PDF' && /application\/pdf/.test(kartuRes.headers.get('content-type') ?? ''), `status=${kartuRes.status} type=${kartuRes.headers.get('content-type')}`);

  const exp = await api(`/sessions/${sessionId}/export/absensi`, { token: proktor });
  check('GET export/absensi', exp.status === 200, `${exp.status} ${exp.text.slice(0, 80)}`);

  // ---- Fase 5: Ruang ujian siswa ----
  console.log('\n[Fase 5 — ruang ujian siswa]');
  const avail = await api('/attempts/available', { token: siswa });
  const avEntry = avail.json?.data?.find((s) => s.id === sessionId);
  check('GET /attempts/available memuat sesi aktif', avail.status === 200 && Boolean(avEntry) && avEntry.status === 'ACTIVE', `${avail.status}`);

  const wrong = await api('/attempts/start', { method: 'POST', token: siswa, body: { sessionId, token: token === '000000' ? '111111' : '000000' } });
  check('start ditolak dengan token salah', wrong.status === 400, `status=${wrong.status}`);

  const start = await api('/attempts/start', { method: 'POST', token: siswa, body: { sessionId, token, seb: false } });
  const attemptId = start.json?.attempt?.id;
  check('POST /attempts/start (token benar)', start.status === 201 && Boolean(attemptId), `${start.status} ${start.text.slice(0, 160)}`);
  check('state berisi soal tersanitasi (tanpa kunci)', Array.isArray(start.json?.questions) && start.json.questions.length === 1 && !('correctChoices' in (start.json.questions[0] ?? {})), JSON.stringify(start.json?.questions?.[0] ?? {}).slice(0, 160));
  check('state menyertakan timer server-side', typeof start.json?.remainingSec === 'number' && start.json.remainingSec > 0, `remainingSec=${start.json?.remainingSec}`);

  const resume = await api('/attempts/start', { method: 'POST', token: siswa, body: { sessionId, token, seb: false } });
  check('start kedua = resume attempt yang sama', resume.json?.attempt?.id === attemptId, `id2=${resume.json?.attempt?.id}`);

  const save = await api(`/attempts/${attemptId}/answers`, { method: 'PUT', token: siswa, body: { questionId, payload: 'b', isFlagged: false } });
  check('PUT answers (autosave)', save.status === 200, `${save.status} ${save.text.slice(0, 120)}`);
  const badSave = await api(`/attempts/${attemptId}/answers`, { method: 'PUT', token: siswa, body: { questionId, payload: 'zzz' } });
  check('autosave menolak jawaban tak valid (400)', badSave.status === 400, `status=${badSave.status}`);

  const state = await api(`/attempts/${attemptId}`, { token: siswa });
  const saved = state.json?.answers?.find((a) => a.questionId === questionId);
  check('jawaban tersimpan & terbaca kembali', saved?.payload === 'b', JSON.stringify(saved));

  const integ = await api(`/attempts/${attemptId}/integrity`, { method: 'POST', token: siswa, body: { type: 'TAB_SWITCH', detail: { at: Date.now() } } });
  check('POST integrity mencatat pelanggaran', integ.status === 201 && integ.json?.violationCount === 1, `${integ.status} ${integ.text.slice(0, 120)}`);

  const submit = await api(`/attempts/${attemptId}/submit`, { method: 'POST', token: siswa, body: { reason: 'MANUAL' } });
  check('POST submit (status SUBMITTED)', submit.status === 201 && submit.json?.attempt?.status === 'SUBMITTED', `${submit.status} ${JSON.stringify(submit.json?.attempt)}`);

  const saveAfter = await api(`/attempts/${attemptId}/answers`, { method: 'PUT', token: siswa, body: { questionId, payload: 'a' } });
  check('autosave ditolak setelah submit (409)', saveAfter.status === 409, `status=${saveAfter.status}`);

  // ---- Ganti password ----
  console.log('\n[Fase 5 — ganti password]');
  const wrongPw = await api('/auth/change-password', { method: 'POST', token: siswa, body: { currentPassword: 'salah', newPassword: 'Baru123!' } });
  check('change-password menolak password lama salah (400)', wrongPw.status === 400, `status=${wrongPw.status}`);
  const okPw = await api('/auth/change-password', { method: 'POST', token: siswa, body: { currentPassword: 'Siswa123!', newPassword: 'Siswa123!X' } });
  check('change-password berhasil', okPw.status === 201 && okPw.json?.ok === true, `${okPw.status}`);
  const reLogin = await api('/auth/login/siswa', { method: 'POST', body: { username: '0051234567', password: 'Siswa123!X' } });
  check('login dengan password baru berhasil', reLogin.status < 300, `status=${reLogin.status}`);
  // kembalikan ke password seed
  await api('/auth/change-password', { method: 'POST', token: siswa, body: { currentPassword: 'Siswa123!X', newPassword: 'Siswa123!' } });

  // ---- Refresh token (ujian panjang > masa hidup token) ----
  console.log('\n[refresh token]');
  const fresh = await api('/auth/login/siswa', {
    method: 'POST',
    body: { username: '0051234567', password: 'Siswa123!' },
  });
  const refreshTok = fresh.json?.refreshToken;
  check('login mengeluarkan refreshToken', typeof refreshTok === 'string' && refreshTok.length > 20, `${typeof refreshTok}`);
  const refreshed = await api('/auth/refresh', { method: 'POST', body: { refreshToken: refreshTok } });
  check('POST /auth/refresh menghasilkan access token baru', refreshed.status < 300 && Boolean(refreshed.json?.accessToken), `${refreshed.status}`);
  const meNew = await api('/auth/me', { token: refreshed.json?.accessToken });
  check('access token baru dipakai untuk /auth/me', meNew.status === 200, `status=${meNew.status}`);
  const asBearer = await api('/auth/me', { token: refreshTok });
  check('refresh token DITOLAK sebagai token akses (401)', asBearer.status === 401, `status=${asBearer.status}`);
  const badRefresh = await api('/auth/refresh', { method: 'POST', body: { refreshToken: 'bukan-jwt' } });
  check('refresh dengan token sampah (401)', badRefresh.status === 401, `status=${badRefresh.status}`);
  const noRefresh = await api('/auth/refresh', { method: 'POST', body: {} });
  check('refresh tanpa body (400)', noRefresh.status === 400, `status=${noRefresh.status}`);

  // ---- Ringkasan ----
  console.log(`\n== HASIL: ${pass} PASS, ${fail} FAIL ==`);
  if (failures.length) {
    console.log('Gagal:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(2);
});
