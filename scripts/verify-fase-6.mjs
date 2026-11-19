// Verifikasi eksekusi Fase 6 — monitoring realtime Socket.io + kendali attempt.
// Jalankan: node scripts/verify-fase-6.mjs
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
  if (r.status >= 300 || !r.json?.accessToken) throw new Error(`Login ${role} gagal: ${r.status}`);
  return r.json.accessToken;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(token) {
  return io(`${ORIGIN}/monitoring`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    auth: { token, schoolId: process.env.CBT_SCHOOL ?? 'sman1' },
  });
}

function waitFor(socket, event, timeoutMs = 5000, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout menunggu event ${event}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    };
    socket.on(event, onEvent);
  });
}

function connected(socket, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    const t = setTimeout(() => reject(new Error('socket tidak terhubung')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
    socket.once('connect_error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function emitAck(socket, event, payload, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'ack timeout' });
      }
    }, timeoutMs);
    socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(err ? { ok: false, error: String(err) } : res);
    });
  });
}

async function main() {
  console.log(`== CBT Fase 6 verification @ ${BASE} ==\n`);

  console.log('[data]');
  const admin = await login('admin', 'admin', 'Admin123!');
  const guru = await login('guru', 'guru', 'Guru123!');
  const proktor = await login('proktor', 'proktor', 'Proktor123!');
  const siswa = await login('siswa', '0051234567', 'Siswa123!');
  check('login 4 role', true);

  const asArr = (r) => (Array.isArray(r) ? r : r.data);
  // Kelas seed dipilih dari NISN siswa seed, bukan indeks 0 — daftar kelas bisa
  // bertambah karena data uji lain sehingga urutannya bergeser.
  const seedRows = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: admin })).json);
  const kelasId = seedRows.find((u) => u.username === '0051234567')?.kelasId ?? asArr((await call('/kelas', { token: admin })).json)[0].id;
  const mapelId = asArr((await call('/mapel', { token: admin })).json)[0].id;

  const q = await call('/questions', {
    method: 'POST',
    token: guru,
    body: {
      type: 'PG',
      content: 'Soal uji Fase 6',
      weight: 1,
      scoringMode: 'ALL_OR_NOTHING',
      choices: [
        { id: 'a', label: 'Satu' },
        { id: 'b', label: 'Dua' },
      ],
      correctChoices: ['a'],
    },
  });
  const exam = await call('/exams', { method: 'POST', token: guru, body: { title: 'Uji Fase 6', description: 'f6', mapelId } });
  await call(`/exams/${exam.json.id}/questions`, { method: 'PUT', token: guru, body: { questionIds: [q.json.id] } });

  const now = Date.now();
  const session = await call('/sessions', {
    method: 'POST',
    token: guru,
    body: {
      examId: exam.json.id,
      title: 'Sesi Fase 6',
      startsAt: new Date(now - 30_000).toISOString(),
      endsAt: new Date(now + 60 * 60_000).toISOString(),
      durationMin: 30,
      tokenIntervalSec: 300,
      maxViolations: 5,
      requireSeb: false,
      shuffleQuestions: false,
      shuffleOptions: false,
      kelasIds: [kelasId],
    },
  });
  const sessionId = session.json.id;
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'SCHEDULED' } });
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'ACTIVE' } });
  const rel = await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktor, body: { note: 'f6' } });
  check('sesi ACTIVE + token rilis', Boolean(sessionId) && /^\d{6}$/.test(rel.json?.token ?? ''), `${sessionId}`);

  const start = await call('/attempts/start', { method: 'POST', token: siswa, body: { sessionId, token: rel.json.token } });
  const attemptId = start.json?.attempt?.id;
  check('attempt siswa dibuat', Boolean(attemptId), start.text.slice(0, 120));

  console.log('\n[REST: papan monitoring]');
  const board0 = await call(`/sessions/${sessionId}/monitoring`, { token: proktor });
  check('GET /sessions/:id/monitoring (proktor)', board0.status === 200, `status=${board0.status}`);
  const row0 = board0.json?.data?.find((d) => d.attempt.id === attemptId);
  check('papan berisi peserta IN_PROGRESS', row0?.attempt?.status === 'IN_PROGRESS', JSON.stringify(row0).slice(0, 160));
  check('papan menyertakan progres jawaban', typeof row0?.answeredCount === 'number' && row0.questionCount >= 1, '');
  check('admin boleh akses papan', (await call(`/sessions/${sessionId}/monitoring`, { token: admin })).status === 200, '');
  check('siswa ditolak akses papan (403)', (await call(`/sessions/${sessionId}/monitoring`, { token: siswa })).status === 403, '');

  console.log('\n[guard kendali]');
  const forbiddenExtend = await call(`/attempts/${attemptId}/extend`, { method: 'POST', token: siswa, body: { minutes: 5 } });
  check('siswa ditolak kendali (403)', forbiddenExtend.status === 403, `status=${forbiddenExtend.status}`);
  const anonExtend = await call(`/attempts/${attemptId}/extend`, { method: 'POST', body: { minutes: 5 } });
  check('anonim ditolak kendali (401)', anonExtend.status === 401, `status=${anonExtend.status}`);
  const badExtend = await call(`/attempts/${attemptId}/extend`, { method: 'POST', token: proktor, body: { minutes: 0 } });
  check('validasi durasi perpanjangan (400)', badExtend.status === 400, `status=${badExtend.status}`);

  console.log('\n[socket]');
  const student = connect(siswa);
  const proktorSocket = connect(proktor);
  let connectOk = true;
  try {
    await Promise.all([connected(student), connected(proktorSocket)]);
  } catch (e) {
    connectOk = false;
    console.log('  ! gagal connect:', e.message);
  }
  check('socket siswa & proktor terhubung', connectOk);

  const roomProktor = await emitAck(proktorSocket, 'monitor:join', sessionId);
  check('proktor join ruang sesi', roomProktor?.ok === true, JSON.stringify(roomProktor));
  const roomStudent = await emitAck(student, 'attempt:join', attemptId);
  check('siswa join ruang attempt', roomStudent?.ok === true, JSON.stringify(roomStudent));
  const denied = await emitAck(student, 'monitor:join', sessionId);
  check('siswa ditolak masuk ruang monitor', denied?.ok === false, JSON.stringify(denied));
  const fakeSocket = connect('token-salah');
  try {
    await connected(fakeSocket, 3000);
    const fakeJoin = await emitAck(fakeSocket, 'monitor:join', sessionId);
    check('token palsu ditolak join', fakeJoin?.ok === false, JSON.stringify(fakeJoin));
    fakeSocket.close();
  } catch {
    check('token palsu ditolak (tidak tersambung)', true);
    fakeSocket.close();
  }

  console.log('\n[heartbeat]');
  const hbAck = await emitAck(student, 'attempt:heartbeat', attemptId);
  check('heartbeat siswa diterima', hbAck?.ok === true, JSON.stringify(hbAck));
  const boardHb = await call(`/sessions/${sessionId}/monitoring`, { token: proktor });
  const rowHb = boardHb.json?.data?.find((d) => d.attempt.id === attemptId);
  check('papan menandai peserta online', rowHb?.online === true && rowHb?.lastSeenAt != null, JSON.stringify({ online: rowHb?.online, lastSeen: rowHb?.lastSeenAt }));

  console.log('\n[kendali proktor]');
  const beforeExpires = rowHb.attempt.expiresAt;
  const snapshotP = waitFor(proktorSocket, 'monitor:snapshot', 6000);
  const extendEvent = waitFor(student, 'attempt:control', 6000, (p) => p?.type === 'extend');
  const ext = await call(`/attempts/${attemptId}/extend`, { method: 'POST', token: proktor, body: { minutes: 10, note: 'uji' } });
  check('extend 10 menit sukses', ext.status < 300 && Date.parse(ext.json.expiresAt) > Date.parse(beforeExpires), `${ext.status} ${ext.text.slice(0, 120)}`);
  const ctrlPayload = await extendEvent.catch(() => null);
  check('siswa menerima event extend realtime', Boolean(ctrlPayload?.expiresAt), JSON.stringify(ctrlPayload));
  const snap = await snapshotP.catch(() => null);
  check('proktor menerima snapshot monitoring', Boolean(snap && Array.isArray(snap.data)), snap ? 'ok' : 'tidak ada snapshot');

  const warnEvent = waitFor(student, 'warn', 6000);
  const warn = await call(`/attempts/${attemptId}/warn`, { method: 'POST', token: proktor, body: { message: 'Fokus, jangan pindah tab!' } });
  check('warn tersimpan (integritas OTHER)', warn.status < 300 && warn.json?.ok === true, `${warn.status} ${warn.text.slice(0, 140)}`);
  const warnPayload = await warnEvent.catch(() => null);
  check('siswa menerima peringatan realtime', warnPayload?.message === 'Fokus, jangan pindah tab!', JSON.stringify(warnPayload));

  const integrityLogs = await call(`/sessions/${sessionId}/integrity`, { token: proktor });
  const logged = integrityLogs.json?.data ?? integrityLogs.json ?? [];
  check('log integritas mencatat peringatan', Array.isArray(logged) && logged.some((l) => l.type === 'OTHER'), JSON.stringify(integrityLogs.json).slice(0, 200));

  const forceEvent = waitFor(student, 'attempt:control', 6000, (p) => p?.type === 'force-submit');
  const forced = await call(`/attempts/${attemptId}/force-submit`, { method: 'POST', token: proktor });
  check('force-submit sukses', forced.status < 300 && forced.json?.status === 'FORCE_SUBMITTED', `${forced.status} ${forced.text.slice(0, 140)}`);
  const forcePayload = await forceEvent.catch(() => null);
  check('siswa menerima event force-submit', forcePayload?.type === 'force-submit', JSON.stringify(forcePayload));

  const boardAfter = await call(`/sessions/${sessionId}/monitoring`, { token: proktor });
  const rowAfter = boardAfter.json?.data?.find((d) => d.attempt.id === attemptId);
  check('papan menampilkan FORCE_SUBMITTED', rowAfter?.attempt?.status === 'FORCE_SUBMITTED', rowAfter?.attempt?.status);
  check('ringkasan papan ikut berubah', (boardAfter.json?.summary?.forced ?? 0) >= 1, JSON.stringify(boardAfter.json?.summary));

  const extAfter = await call(`/attempts/${attemptId}/extend`, { method: 'POST', token: proktor, body: { minutes: 5 } });
  check('extend ditolak setelah selesai (409)', extAfter.status === 409, `status=${extAfter.status}`);

  student.close();
  proktorSocket.close();

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
