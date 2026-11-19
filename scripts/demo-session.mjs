// Membuat satu sesi ujian ACTIVE + token untuk uji manual via browser.
// Jalankan: node scripts/demo-session.mjs
const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return json;
}

const login = (role, username, password) =>
  call(`/auth/login/${role}`, { method: 'POST', body: { username, password } }).then((r) => r.accessToken);

const admin = await login('admin', 'admin', 'Admin123!');
const guru = await login('guru', 'guru', 'Guru123!');
const proktor = await login('proktor', 'proktor', 'Proktor123!');

const asArr = (r) => (Array.isArray(r) ? r : r.data);
// Kelas seed dipilih dari NISN siswa seed agar demo tetap berjalan walau
// daftar kelas bertambah karena data uji lain.
const seedRows = asArr(await call('/users?role=SISWA&search=0051234567&limit=5', { token: admin }));
const kelasId = seedRows.find((u) => u.username === '0051234567')?.kelasId ?? asArr(await call('/kelas', { token: admin }))[0].id;
const mapelId = asArr(await call('/mapel', { token: admin }))[0].id;

const q = await call('/questions', {
  method: 'POST',
  token: guru,
  body: {
    type: 'PG',
    content: 'Ibu kota Indonesia adalah…',
    weight: 1,
    scoringMode: 'ALL_OR_NOTHING',
    choices: [
      { id: 'a', label: 'Jakarta' },
      { id: 'b', label: 'Bandung' },
      { id: 'c', label: 'Surabaya' },
    ],
    correctChoices: ['a'],
  },
});
const exam = await call('/exams', { method: 'POST', token: guru, body: { title: 'Ujian Demo Fase 5', description: 'demo', mapelId } });
await call(`/exams/${exam.id}/questions`, { method: 'PUT', token: guru, body: { questionIds: [q.id] } });

const now = Date.now();
const session = await call('/sessions', {
  method: 'POST',
  token: guru,
  body: {
    examId: exam.id,
    title: 'Sesi Demo Fase 5',
    startsAt: new Date(now - 30_000).toISOString(),
    endsAt: new Date(now + 60 * 60_000).toISOString(),
    durationMin: 30,
    tokenIntervalSec: 120,
    maxViolations: 3,
    requireSeb: false,
    shuffleQuestions: false,
    shuffleOptions: false,
    kelasIds: [kelasId],
  },
});
await call(`/sessions/${session.id}/status`, { method: 'PATCH', token: guru, body: { status: 'SCHEDULED' } });
await call(`/sessions/${session.id}/status`, { method: 'PATCH', token: guru, body: { status: 'ACTIVE' } });
const rel = await call(`/sessions/${session.id}/token/release`, { method: 'POST', token: proktor, body: { note: 'demo' } });

console.log(JSON.stringify({ sessionId: session.id, attemptId: null, token: rel.token, examId: exam.id }, null, 2));
