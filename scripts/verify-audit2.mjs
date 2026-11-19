// Regresi audit-2 — mengunci 10 fix backend + E2E penuh ujian siswa.
// Jalankan: node scripts/verify-audit2.mjs
import { io } from 'socket.io-client';

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
  if (r.status >= 300 || !r.json?.accessToken) throw new Error(`Login ${role}/${username} gagal: ${r.status} ${r.text.slice(0, 120)}`);
  return r.json;
};
const asArr = (r) => (Array.isArray(r) ? r : r.data);
const stamp = Date.now().toString(36);

async function ensureSiswa(admin, kelasId) {
  const digits = String(Date.now() % 10000000000).padStart(10, '0');
  const uname = digits;
  const created = await call('/users', {
    method: 'POST',
    token: admin,
    body: { username: uname, password: 'Siswa123!', name: 'Siswa Audit2', role: 'SISWA', nisn: uname, kelasId },
  });
  if (created.status >= 300) throw new Error(`ensure siswa gagal: ${created.status} ${created.text.slice(0, 160)}`);
  return login('siswa', uname, 'Siswa123!');
}

async function makeExamFlow(guru, mapelId, suffix) {
  const q = await call('/questions', {
    method: 'POST',
    token: guru,
    body: {
      type: 'PG', content: `Soal ${suffix} — 3+3?`, weight: 10, scoringMode: 'ALL_OR_NOTHING',
      choices: [{ id: 'a', label: '6' }, { id: 'b', label: '7' }], correctChoices: ['a'],
    },
  });
  const exam = await call('/exams', { method: 'POST', token: guru, body: { title: `Ujian ${suffix}`, mapelId } });
  await call(`/exams/${exam.json.id}/questions`, { method: 'PUT', token: guru, body: { questionIds: [q.json.id] } });
  return { qid: q.json.id, examId: exam.json.id };
}

async function makeSession(guru, examId, kelasId, { startsInMs = -30_000, endsInMs = 3_600_000, durationMin = 30 } = {}) {
  const now = Date.now();
  const s = await call('/sessions', {
    method: 'POST',
    token: guru,
    body: {
      examId, title: `Sesi ${stamp}`, startsAt: new Date(now + startsInMs).toISOString(),
      endsAt: new Date(now + endsInMs).toISOString(), durationMin,
      tokenIntervalSec: 300, maxViolations: 5, requireSeb: false,
      shuffleQuestions: false, shuffleOptions: false, kelasIds: [kelasId],
    },
  });
  if (s.status >= 300) throw new Error(`buat sesi gagal: ${s.status} ${s.text.slice(0, 160)}`);
  await call(`/sessions/${s.json.id}/status`, { method: 'PATCH', token: guru, body: { status: 'SCHEDULED' } });
  await call(`/sessions/${s.json.id}/status`, { method: 'PATCH', token: guru, body: { status: 'ACTIVE' } });
  return s.json.id;
}

async function main() {
  console.log(`== CBT audit-2 verification @ ${BASE} ==\n`);

  console.log('[setup]');
  const adminT = (await login('admin', 'admin', 'Admin123!')).accessToken;
  const guruT = (await login('guru', 'guru', 'Guru123!')).accessToken;
  const proktorT = (await login('proktor', 'proktor', 'Proktor123!')).accessToken;
  const siswaSeed = await login('siswa', '0051234567', 'Siswa123!');
  const siswaT = siswaSeed.accessToken;
  // Kelas seed dipilih dari NISN siswa seed, bukan indeks 0 — daftar kelas bisa
  // bertambah karena data uji lain sehingga urutannya bergeser.
  const seedRows = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: adminT })).json);
  const kelasId = seedRows.find((u) => u.username === '0051234567')?.kelasId ?? asArr((await call('/kelas', { token: adminT })).json)[0].id;
  const mapelId = asArr((await call('/mapel', { token: adminT })).json)[0].id;
  const fresh = await ensureSiswa(adminT, kelasId);
  const siswa2T = fresh.accessToken;
  check('login 4 role + siswa segar', Boolean(siswa2T));

  console.log('\n[F1 — login role tak dikenal → 400]');
  const badRole = await call('/auth/login/kepalasekolah', { method: 'POST', body: { username: 'admin', password: 'Admin123!' } });
  check('role invalid ditolak 400 (bukan login generik)', badRole.status === 400, `status=${badRole.status}`);

  console.log('\n[F2 — buat sesi dengan kelasIds duplikat → 200, bukan 500]');
  const { examId: examDup } = await makeExamFlow(guruT, mapelId, `dup-${stamp}`);
  const nowD = Date.now();
  const dup = await call('/sessions', {
    method: 'POST',
    token: guruT,
    body: {
      examId: examDup, title: `Sesi dup ${stamp}`, startsAt: new Date(nowD - 60_000).toISOString(),
      endsAt: new Date(nowD + 3_600_000).toISOString(), durationMin: 30,
      tokenIntervalSec: 120, shuffleQuestions: false, shuffleOptions: false,
      kelasIds: [kelasId, kelasId],
    },
  });
  check('kelasIds duplikat didedupe (<300)', dup.status < 300, `status=${dup.status} ${dup.text.slice(0, 120)}`);

  console.log('\n[F3 — siswa ditolak mulai sebelum startsAt]');
  const { examId: examFut } = await makeExamFlow(guruT, mapelId, `fut-${stamp}`);
  const futId = await makeSession(guruT, examFut, kelasId, { startsInMs: 3_600_000, endsInMs: 7_200_000 });
  const relFut = await call(`/sessions/${futId}/token/release`, { method: 'POST', token: proktorT, body: {} });
  const early = await call('/attempts/start', { method: 'POST', token: siswa2T, body: { sessionId: futId, token: relFut.json.token } });
  check('start sebelum startsAt → 409', early.status === 409, `status=${early.status} ${early.text.slice(0, 120)}`);

  console.log('\n[F4+F5 — expiry: publish tak gagal palsu + state EXPIRED]');
  const { examId: examExp, qid: qExp } = await makeExamFlow(guruT, mapelId, `exp-${stamp}`);
  const expId = await makeSession(guruT, examExp, kelasId, { startsInMs: -60_000, endsInMs: 4_000, durationMin: 30 });
  const relExp = await call(`/sessions/${expId}/token/release`, { method: 'POST', token: proktorT, body: {} });
  const stExp = await call('/attempts/start', { method: 'POST', token: siswa2T, body: { sessionId: expId, token: relExp.json.token } });
  const attExp = stExp.json?.attempt?.id;
  check('attempt dibuat (berakhir ikut endsAt ±4 dtk)', Boolean(attExp));
  await call(`/attempts/${attExp}/answers`, { method: 'PUT', token: siswa2T, body: { questionId: qExp, payload: 'a' } });
  await new Promise((r) => setTimeout(r, 5000));
  await call(`/sessions/${expId}/status`, { method: 'PATCH', token: guruT, body: { status: 'CLOSED' } });
  const pub = await call(`/sessions/${expId}/publish`, { method: 'POST', token: guruT, body: { published: true } });
  check('publish sukses walau attempt lewat waktu (auto-expire dulu)', pub.status < 300, `status=${pub.status} ${pub.text.slice(0, 160)}`);
  const stateExp = await call(`/attempts/${attExp}`, { token: siswa2T });
  check('state polling menandai EXPIRED + score tetap null pasca-publish (nilai tidak tampil di app)', stateExp.json?.attempt?.status === 'EXPIRED' && stateExp.json?.attempt?.score === null, JSON.stringify(stateExp.json?.attempt));

  console.log('\n[F6 — extend dibatasi endsAt + ditolak saat CLOSED]');
  const { examId: examCap } = await makeExamFlow(guruT, mapelId, `cap-${stamp}`);
  const capId = await makeSession(guruT, examCap, kelasId, { startsInMs: -60_000, endsInMs: 600_000, durationMin: 60 });
  const relCap = await call(`/sessions/${capId}/token/release`, { method: 'POST', token: proktorT, body: {} });
  const stCap = await call('/attempts/start', { method: 'POST', token: siswa2T, body: { sessionId: capId, token: relCap.json.token } });
  const attCap = stCap.json?.attempt?.id;
  const extBig = await call(`/attempts/${attCap}/extend`, { method: 'POST', token: proktorT, body: { minutes: 120 } });
  const sessCap = await call(`/sessions/${capId}`, { token: guruT });
  const capped = extBig.status < 300 && Date.parse(extBig.json.expiresAt) <= Date.parse(sessCap.json.endsAt);
  check('extend 120 mnt dipotong ke endsAt sesi', capped, `status=${extBig.status} ${extBig.text.slice(0, 120)}`);
  await call(`/sessions/${capId}/status`, { method: 'PATCH', token: guruT, body: { status: 'CLOSED' } });
  const extClosed = await call(`/attempts/${attCap}/extend`, { method: 'POST', token: proktorT, body: { minutes: 5 } });
  check('extend saat sesi CLOSED → 409', extClosed.status === 409, `status=${extClosed.status}`);

  console.log('\n[F7 — export sesi tak dikenal → 404 cepat, bukan hang]');
  const badExp = await call('/sessions/tidak-ada/export/absensi', { token: proktorT, timeoutMs: 10000 });
  check('export invalid → 404', badExp.status === 404, `status=${badExp.status}`);

  console.log('\n[F8 — BA Digital dihapus — endpoint sertifikat hilang (404)]');
  const { examId: examCert } = await makeExamFlow(guruT, mapelId, `cert-${stamp}`);
  const certId = await makeSession(guruT, examCert, kelasId);
  const relCert = await call(`/sessions/${certId}/token/release`, { method: 'POST', token: proktorT, body: {} });
  await call('/attempts/start', { method: 'POST', token: siswa2T, body: { sessionId: certId, token: relCert.json.token } });
  const me2 = await call('/auth/me', { token: siswa2T });
  const certRun = await call(`/exams/${examCert}/certificate?userId=${me2.json.id}`, { token: proktorT });
  check('sertifikat → 404 (fitur dihapus)', certRun.status === 404, `status=${certRun.status} ${certRun.text.slice(0, 120)}`);

  console.log('\n[F9 — imageUrl traversal ditolak]');
  const evil = '/uploads/../../etc/passwd';
  const qEvil = await call('/questions', {
    method: 'POST',
    token: guruT,
    body: {
      type: 'PG', content: `Soal evil ${stamp}`, weight: 1, scoringMode: 'ALL_OR_NOTHING',
      choices: [{ id: 'a', label: 'x' }], correctChoices: ['a'], imageUrl: evil,
    },
  });
  check('create imageUrl traversal → 400', qEvil.status === 400, `status=${qEvil.status}`);
  const { qid: qClean } = await makeExamFlow(guruT, mapelId, `clean-${stamp}`);
  const uEvil = await call(`/questions/${qClean}`, { method: 'PATCH', token: guruT, body: { type: 'PG', content: 'x', imageUrl: evil } });
  check('update imageUrl traversal → 400', uEvil.status === 400, `status=${uEvil.status} ${uEvil.text.slice(0, 120)}`);

  console.log('\n[F10 — socket menolak refresh token]');
  const sockR = io(`${ORIGIN}/monitoring`, { transports: ['websocket'], reconnection: false, timeout: 5000, auth: { token: fresh.refreshToken } });
  await new Promise((r) => {
    sockR.once('connect', r);
    sockR.once('connect_error', r);
    setTimeout(r, 1500);
  });
  await new Promise((r) => setTimeout(r, 1200));
  check('socket refresh-token diputus', sockR.connected === false, `connected=${sockR.connected}`);
  sockR.close();

  console.log('\n[E2E siswa — token → kerjakan → submit → tutup → publish → hasil]');
  const { examId: examE2E, qid: qE2E } = await makeExamFlow(guruT, mapelId, `e2e-${stamp}`);
  const e2eId = await makeSession(guruT, examE2E, kelasId);
  const avail0 = await call('/attempts/available', { token: siswaT });
  check('daftar ujian tampil untuk siswa', Array.isArray(avail0.json?.data) && avail0.json.data.some((s) => s.id === e2eId));
  const relE2E = await call(`/sessions/${e2eId}/token/release`, { method: 'POST', token: proktorT, body: { note: 'e2e' } });
  check('proktor merilis token live', Boolean(relE2E.json?.token) && relE2E.json.token.length === 6, JSON.stringify(relE2E.json)?.slice(0, 80));
  const badTok = await call('/attempts/start', { method: 'POST', token: siswaT, body: { sessionId: e2eId, token: '000000' } });
  check('token salah ditolak', badTok.status === 400, `status=${badTok.status}`);
  const stE2E = await call('/attempts/start', { method: 'POST', token: siswaT, body: { sessionId: e2eId, token: relE2E.json.token } });
  const attE2E = stE2E.json?.attempt?.id;
  const noKey = !JSON.stringify(stE2E.json).includes('correctChoices');
  check('ujian dimulai + soal tersanitasi (tanpa kunci)', stE2E.status < 300 && noKey, `status=${stE2E.status}`);
  const ans = await call(`/attempts/${attE2E}/answers`, { method: 'PUT', token: siswaT, body: { questionId: qE2E, payload: 'a' } });
  check('autosave jawaban', ans.status < 300, `status=${ans.status}`);
  const sub = await call(`/attempts/${attE2E}/submit`, { method: 'POST', token: siswaT, body: { reason: 'MANUAL' } });
  check('submit manual', sub.status < 300 && sub.json?.attempt?.status === 'SUBMITTED', `status=${sub.status}`);
  const prePub = await call('/attempts/available', { token: siswaT });
  const rowPre = prePub.json?.data?.find((s) => s.id === e2eId);
  check('nilai disembunyikan sebelum publish', rowPre?.attempt?.score === null && rowPre?.resultsPublished === false, JSON.stringify(rowPre?.attempt));
  const resPre = await call(`/attempts/${attE2E}/result`, { token: siswaT });
  check('endpoint hasil siswa DIHAPUS (404)', resPre.status === 404, `status=${resPre.status}`);
  await call(`/sessions/${e2eId}/status`, { method: 'PATCH', token: guruT, body: { status: 'CLOSED' } });
  const pubE2E = await call(`/sessions/${e2eId}/publish`, { method: 'POST', token: guruT, body: { published: true } });
  check('guru menutup + menerbitkan hasil', pubE2E.status < 300, `status=${pubE2E.status} ${pubE2E.text.slice(0, 120)}`);
  const resPost = await call(`/attempts/${attE2E}/result`, { token: siswaT });
  check('endpoint hasil siswa tetap 404 setelah publish (siswa tidak melihat nilai)', resPost.status === 404, `status=${resPost.status}`);
  const board = await call(`/sessions/${e2eId}/monitoring`, { token: proktorT });
  check('papan proktor menampilkan SUBMITTED', board.json?.data?.[0]?.attempt?.status === 'SUBMITTED', JSON.stringify(board.json?.summary));

  console.log('\n[sweep peran — guard tiap fitur]');
  check('admin: list pengguna', (await call('/users?limit=1', { token: adminT })).status === 200);
  check('siswa ditolak list pengguna (403)', (await call('/users?limit=1', { token: siswaT })).status === 403);
  check('guru: bank soal', (await call('/questions?limit=1', { token: guruT })).status === 200);
  check('siswa ditolak bank soal (403)', (await call('/questions?limit=1', { token: siswaT })).status === 403);
  check('proktor: token sesi (aktif)', (await call(`/sessions/${futId}/token/current`, { token: proktorT })).status === 200);
  check('siswa ditolak token sesi (403)', (await call(`/sessions/${futId}/token/current`, { token: siswaT })).status === 403);
  check('guru: papan penilaian', (await call(`/sessions/${e2eId}/grading`, { token: guruT })).status === 200);
  check('siswa ditolak papan penilaian (403)', (await call(`/sessions/${e2eId}/grading`, { token: siswaT })).status === 403);
  check('web terlayani', (await fetch(`${ORIGIN}/`).then((r) => r.status).catch(() => 0)) === 200);

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
