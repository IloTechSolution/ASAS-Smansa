// Verifikasi fitur baru (7 Nov 2026): KKM per mapel, config global dipakai,
// tutup sesi force-submit, /uploads signed URL, ekspor nilai, enrol.
// (Blok BA Digital/QR sertifikat DIHAPUS 11 Nov 2026 — fitur dihilangkan.)
// Jalankan: node scripts/verify-upgrade.mjs
import 'dotenv/config';

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

async function call(path, { method = 'GET', body, token, raw, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

const login = async (role, username, password) => {
  const r = await call(`/auth/login/${role}`, { method: 'POST', body: { username, password } });
  if (r.status >= 300 || !r.json?.accessToken) throw new Error(`Login ${role}/${username} gagal: ${r.status}`);
  return r.json;
};
const asArr = (r) => (Array.isArray(r) ? r : r.data);
const stamp = Date.now().toString(36);

async function ensureSiswa(admin, kelasId, name) {
  const digits = String(Date.now() % 10000000000).padStart(10, '0');
  const created = await call('/users', {
    method: 'POST',
    token: admin,
    body: { username: digits, password: 'Siswa123!', name, role: 'SISWA', nisn: digits, kelasId },
  });
  if (created.status >= 300) throw new Error(`ensure siswa gagal: ${created.status} ${created.text.slice(0, 160)}`);
  return { creds: await login('siswa', digits, 'Siswa123!'), id: created.json.id, username: digits };
}

async function makeExamFlow(guru, mapelId, suffix, opts = {}) {
  const q = await call('/questions', {
    method: 'POST',
    token: guru,
    body: {
      type: 'PG', content: `Soal ${suffix} — 2+2?`, weight: 10, scoringMode: 'ALL_OR_NOTHING',
      choices: [{ id: 'a', label: '4' }, { id: 'b', label: '5' }], correctChoices: ['a'],
    },
  });
  const exam = await call('/exams', { method: 'POST', token: guru, body: { title: `Ujian ${suffix}`, mapelId } });
  await call(`/exams/${exam.json.id}/questions`, { method: 'PUT', token: guru, body: { questionIds: [q.json.id] } });
  return { qid: q.json.id, examId: exam.json.id };
}

/** Sesi ACTIVE langsung (mulai 30 dtk lalu). */
async function makeActiveSession(guru, examId, kelasId, suffix, opts = {}) {
  const now = Date.now();
  const body = {
    examId, title: `Sesi ${suffix} ${stamp}`,
    startsAt: new Date(now - 30_000).toISOString(),
    endsAt: new Date(now + 3_600_000).toISOString(),
    durationMin: 30, kelasIds: [kelasId],
    shuffleQuestions: false, shuffleOptions: false,
    ...opts,
  };
  const s = await call('/sessions', { method: 'POST', token: guru, body });
  if (s.status >= 300) throw new Error(`buat sesi gagal: ${s.status} ${s.text.slice(0, 200)}`);
  await call(`/sessions/${s.json.id}/status`, { method: 'PATCH', token: guru, body: { status: 'SCHEDULED' } });
  await call(`/sessions/${s.json.id}/status`, { method: 'PATCH', token: guru, body: { status: 'ACTIVE' } });
  return s.json;
}

const setConfig = (admin, key, value) => call('/settings', { method: 'PUT', token: admin, body: { key, value } });

async function main() {
  console.log(`== CBT upgrade verification @ ${BASE} ==\n`);

  const adminT = (await login('admin', 'admin', 'Admin123!')).accessToken;
  const guruT = (await login('guru', 'guru', 'Guru123!')).accessToken;
  const proktorT = (await login('proktor', 'proktor', 'Proktor123!')).accessToken;
  const seedRows = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: adminT })).json);
  const kelasId = seedRows.find((u) => u.username === '0051234567')?.kelasId ?? asArr((await call('/kelas', { token: adminT })).json)[0].id;
  const mapels = asArr((await call('/mapel', { token: adminT })).json);
  const mtk = mapels.find((m) => m.name === 'Matematika') ?? mapels[0];
  const mapelId = mtk.id;
  const siswaA = await ensureSiswa(adminT, kelasId, `Upgrade A ${stamp}`);
  const siswaB = await ensureSiswa(adminT, kelasId, `Upgrade B ${stamp}`);
  console.log(`[setup] mapel=${mtk.name} siswaA=${siswaA.username}\n`);

  /* ---------------- KKM per mapel ---------------- */
  console.log('[1 — KKM per mapel: akses & validasi]');
  const kkmSiswa = await call(`/mapel/${mapelId}/kkm`, { method: 'PATCH', token: siswaA.creds.accessToken, body: { kkm: 80 } });
  check('siswa ditolak set KKM (403)', kkmSiswa.status === 403, `status=${kkmSiswa.status}`);
  const kkmProktor = await call(`/mapel/${mapelId}/kkm`, { method: 'PATCH', token: proktorT, body: { kkm: 80 } });
  check('proktor ditolak set KKM (403)', kkmProktor.status === 403, `status=${kkmProktor.status}`);
  const kkmGuru = await call(`/mapel/${mapelId}/kkm`, { method: 'PATCH', token: guruT, body: { kkm: 80 } });
  check('guru boleh set KKM (200)', kkmGuru.status < 300 && kkmGuru.json?.kkm === 80, `status=${kkmGuru.status} ${kkmGuru.text.slice(0, 120)}`);
  const kkmBad = await call(`/mapel/${mapelId}/kkm`, { method: 'PATCH', token: guruT, body: { kkm: 101 } });
  check('KKM > 100 ditolak (400)', kkmBad.status === 400, `status=${kkmBad.status}`);
  await call(`/mapel/${mapelId}/kkm`, { method: 'PATCH', token: adminT, body: { kkm: 75 } });
  const kkmBack = await call(`/mapel/${mapelId}`, { method: 'GET', token: adminT }).catch(() => null);
  void kkmBack;

  /* ---------------- Konfigurasi global dipakai ---------------- */
  console.log('\n[2 — konfigurasi global dipakai sebagai default sesi]');
  try {
    await setConfig(adminT, 'MAX_VIOLATIONS_DEFAULT', '7');
    await setConfig(adminT, 'TOKEN_DEFAULT_INTERVAL_SEC', '333');
    await setConfig(adminT, 'REQUIRE_SEB_DEFAULT', 'true');
    const { examId } = await makeExamFlow(guruT, mapelId, `cfg-${stamp}`);
    const now = Date.now();
    const sCfg = await call('/sessions', {
      method: 'POST',
      token: guruT,
      body: { examId, title: `Sesi cfg ${stamp}`, startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(), durationMin: 30, kelasIds: [kelasId] },
    });
    check('default tokenIntervalSec dari config (333)', sCfg.json?.tokenIntervalSec === 333, `got=${sCfg.json?.tokenIntervalSec}`);
    check('default maxViolations dari config (7)', sCfg.json?.maxViolations === 7, `got=${sCfg.json?.maxViolations}`);
    check('default requireSeb dari config (true)', sCfg.json?.requireSeb === true, `got=${sCfg.json?.requireSeb}`);
    const sExp = await call('/sessions', {
      method: 'POST',
      token: guruT,
      body: { examId, title: `Sesi cfg2 ${stamp}`, startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(), durationMin: 30, maxViolations: 9, kelasIds: [kelasId] },
    });
    check('nilai eksplisit mengalahkan config (9)', sExp.json?.maxViolations === 9, `got=${sExp.json?.maxViolations}`);
    const detail = await call(`/sessions/${sCfg.json.id}`, { token: guruT });
    check('tokenSecret tidak bocor di detail sesi', detail.json?.tokenSecret === undefined, JSON.stringify(Object.keys(detail.json ?? {})));
  } finally {
    await setConfig(adminT, 'MAX_VIOLATIONS_DEFAULT', '3');
    await setConfig(adminT, 'TOKEN_DEFAULT_INTERVAL_SEC', '120');
    await setConfig(adminT, 'REQUIRE_SEB_DEFAULT', 'false');
  }

  /* ---------------- settings/public ---------------- */
  console.log('\n[3 — /settings/public terbuka, /settings tetap terlindungi]');
  const pub = await call('/settings/public');
  check('settings/public tanpa token → 200 + brand', pub.status === 200 && typeof pub.json?.SCHOOL_NAME === 'string' && typeof pub.json?.TAHUN_AJARAN === 'string', `status=${pub.status}`);
  const priv = await call('/settings');
  check('settings tanpa token → 401', priv.status === 401, `status=${priv.status}`);


  /* ---------------- Tutup sesi → force-submit + KKM + publish ---------------- */
  console.log('\n[5 — tutup sesi men-submit attempt berjalan; KKM dipakai hasil siswa]');
  const flow = async (siswa, suffix, correct) => {
    const { examId, qid } = await makeExamFlow(guruT, mapelId, `${suffix}-${stamp}`);
    const session = await makeActiveSession(guruT, examId, kelasId, suffix);
    const rel = await call(`/sessions/${session.id}/token/release`, { method: 'POST', token: proktorT, body: {} });
    const start = await call('/attempts/start', { method: 'POST', token: siswa.creds.accessToken, body: { sessionId: session.id, token: rel.json.token } });
    const attemptId = start.json?.attempt?.id ?? start.json?.id;
    await call(`/attempts/${attemptId}/answers`, { method: 'PUT', token: siswa.creds.accessToken, body: { questionId: qid, payload: correct ? 'a' : 'b' } });
    return { examId, session, attemptId };
  };

  // A: siswa benar — jangan submit, biarkan guru TUTUP sesi → FORCE_SUBMITTED
  const A = await flow(siswaA, 'close', true);
  const closedA = await call(`/sessions/${A.session.id}/status`, { method: 'PATCH', token: guruT, body: { status: 'CLOSED' } });
  check('tutup sesi → forceClose dilaporkan (1)', closedA.json?.forceClosed === 1, `got=${closedA.json?.forceClosed} status=${closedA.status}`);
  const attemptA = await call(`/attempts/${A.attemptId}`, { token: siswaA.creds.accessToken });
  check('attempt IN_PROGRESS → FORCE_SUBMITTED setelah tutup sesi', attemptA.json?.attempt?.status === 'FORCE_SUBMITTED', `status=${attemptA.json?.attempt?.status}`);
  const pubA = await call(`/sessions/${A.session.id}/publish`, { method: 'POST', token: guruT, body: { published: true } });
  check('publish sukses setelah tutup paksa (tanpa review tertunda)', pubA.status < 300, `status=${pubA.status} ${pubA.text.slice(0, 160)}`);
  const resA = await call(`/attempts/${A.attemptId}/result`, { token: siswaA.creds.accessToken });
  check('endpoint hasil siswa DIHAPUS (404) — nilai tidak tampil di siswa', resA.status === 404, `status=${resA.status}`);

  // B: siswa salah → TIDAK LULUS
  const B = await flow(siswaB, 'fail', false);
  await call(`/sessions/${B.session.id}/status`, { method: 'PATCH', token: guruT, body: { status: 'CLOSED' } });
  const pubB = await call(`/sessions/${B.session.id}/publish`, { method: 'POST', token: guruT, body: { published: true } });
  check('publish sesi B sukses', pubB.status < 300, `status=${pubB.status} ${pubB.text.slice(0, 160)}`);
  const resB = await call(`/attempts/${B.attemptId}/result`, { token: siswaB.creds.accessToken });
  check('endpoint hasil siswa DIHAPUS (404)', resB.status === 404, `status=${resB.status}`);

  /* ---------------- Export nilai Excel ---------------- */
  console.log('\n[6 — export nilai Excel (KKM + ketuntasan)]');
  const nilaiRes = await call(`/sessions/${A.session.id}/export/nilai`, { token: guruT, raw: true });
  const nilaiBuf = Buffer.from(await nilaiRes.arrayBuffer());
  check(
    'guru pemilik boleh unduh nilai (200 + xlsx + attachment)',
    nilaiRes.status === 200 && (nilaiRes.headers.get('content-type') ?? '').includes('spreadsheetml') && (nilaiRes.headers.get('content-disposition') ?? '').includes('attachment') && nilaiBuf.length > 400,
    `status=${nilaiRes.status} type=${nilaiRes.headers.get('content-type')} bytes=${nilaiBuf.length}`,
  );
  const nilaiSiswa = await call(`/sessions/${A.session.id}/export/nilai`, { token: siswaA.creds.accessToken, raw: true });
  check('siswa ditolak export nilai (403)', nilaiSiswa.status === 403, `status=${nilaiSiswa.status}`);
  const nilaiProktor = await call(`/sessions/${A.session.id}/export/nilai`, { token: proktorT, raw: true });
  check('proktor ditolak export nilai (403)', nilaiProktor.status === 403, `status=${nilaiProktor.status}`);

  /* ---------------- BA Digital dihapus — endpoint sertifikat hilang ---------------- */
  console.log('\n[7 — BA Digital dihapus (11 Nov 2026)]');
  const certGone = await call(`/exams/${A.examId}/certificate?userId=${siswaA.id}`, { token: proktorT, raw: true });
  check('sertifikat → 404', certGone.status === 404, `status=${certGone.status}`);
  const verifyGone = await call('/verify/token-sampah');
  check('GET /api/verify/:token → 404', verifyGone.status === 404, `status=${verifyGone.status}`);

  /* ---------------- /uploads/sign ---------------- */
  console.log('\n[8 — /uploads/sign: terautentikasi, path tervalidasi]');
  const signAnon = await call('/uploads/sign?path=/uploads/questions/x.png');
  check('sign tanpa token → 401', signAnon.status === 401, `status=${signAnon.status}`);
  const signEvil = await call(`/uploads/sign?path=${encodeURIComponent('/uploads/../../etc/passwd')}`, { token: guruT });
  check('sign path traversal → 400', signEvil.status === 400, `status=${signEvil.status}`);
  const signOk = await call(`/uploads/sign?path=${encodeURIComponent('/uploads/questions/q_contoh.png')}`, { token: guruT });
  check('sign path sah → url dengan exp & sig', signOk.status === 200 && /^\/uploads\/questions\/q_contoh\.png\?exp=\d+&sig=.+/.test(signOk.json?.url ?? ''), `status=${signOk.status} ${JSON.stringify(signOk.json)}`);

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
