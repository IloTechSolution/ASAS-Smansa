// Uji beban CBT — simulasi siswa login + start ujian + autosave + heartbeat.
// Jalankan: node scripts/load-test.mjs --users 400 --duration 120 --ramp 30
// Opsi: --answer-every 2000 (ms), --keep (jangan hapus data uji), --base http://localhost:8080/api
// Catatan: butuh stack berjalan. Semua data uji dibuat & (default) dibersihkan otomatis.
import { io } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const argv = (() => {
  const out = { users: 100, duration: 60, ramp: 15, answerEvery: 2000, keep: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--keep') out.keep = true;
    else if (a[i].startsWith('--') && a[i + 1] !== undefined) out[a[i].slice(2)] = a[++i];
  }
  out.users = Number(out.users);
  out.duration = Number(out.duration);
  out.ramp = Number(out.ramp);
  out.answerEvery = Number(out.answerEvery);
  return out;
})();

const BASE = process.env.CBT_BASE ?? (argv.base ?? 'http://localhost:8080/api');
const WEB = BASE.replace(/\/api$/, '');
const SCHOOL = process.env.CBT_SCHOOL ?? 'sman1';
const PREFIX = `LT${Date.now().toString(36)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', body, token } = {}) {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}`, 'x-school-id': SCHOOL } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text, ms: performance.now() - started };
}

// Web memakai endpoint generik POST /api/auth/login — ini yang kena rate-limit nginx.
function login(_role, username, password) {
  return api('/auth/login', { method: 'POST', body: { username, password } });
}

const stats = { ok: 0, err: 0, ratelimit: 0, latencies: [], byPhase: {} };
function record(phase, r, expect = 300) {
  if (!stats.byPhase[phase]) stats.byPhase[phase] = { ok: 0, err: 0, ms: [] };
  const s = stats.byPhase[phase];
  s.ms.push(r.ms);
  stats.latencies.push(r.ms);
  if (r.status < expect) { s.ok++; stats.ok++; } else {
    s.err++; stats.err++;
    if (r.status === 429) stats.ratelimit++;
  }
  return r;
}
function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function setup() {
  console.log(`== Setup: ${argv.users} siswa, sesi ${PREFIX} ==`);
  const admin = (await login('admin', process.env.ADMIN_USER ?? 'admin', process.env.ADMIN_PASS ?? 'Admin123!')).json?.accessToken;
  const guru = (await login('guru', process.env.GURU_USER ?? 'guru', process.env.GURU_PASS ?? 'Guru123!')).json?.accessToken;
  const proktor = (await login('proktor', process.env.PROKTOR_USER ?? 'proktor', process.env.PROKTOR_PASS ?? 'Proktor123!')).json?.accessToken;
  if (!admin || !guru || !proktor) throw new Error('Login admin/guru/proktor gagal — cek kredensial');

  const seed = (await api('/users?role=SISWA&search=0051234567&limit=5', { token: admin })).json;
  const rows = Array.isArray(seed) ? seed : (seed?.data ?? []);
  const kelasId = rows.find((u) => u.username === '0051234567')?.kelasId;
  const mapelId = ((await api('/mapel', { token: admin })).json?.data ?? (await api('/mapel', { token: admin })).json)?.[0]?.id;
  if (!kelasId || !mapelId) throw new Error('Kelas/mapel seed tidak ditemukan');

  const questionIds = [];
  for (let i = 0; i < 5; i++) {
    const q = await api('/questions', {
      method: 'POST', token: guru,
      body: {
        type: 'PG', content: `Soal beban ${i + 1}`, weight: 1, scoringMode: 'ALL_OR_NOTHING',
        choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correctChoices: ['b'],
      },
    });
    if (!q.json?.id) throw new Error(`Buat soal gagal: ${q.status} ${q.text.slice(0, 120)}`);
    questionIds.push(q.json.id);
  }

  const examId = (await api('/exams', {
    method: 'POST', token: guru,
    body: { title: `${PREFIX} uji beban`, description: 'load test', mapelId },
  })).json?.id;
  if (!examId) throw new Error('Buat ujian gagal');
  await api(`/exams/${examId}/questions`, { method: 'PUT', token: guru, body: { questionIds } });

  const now = Date.now();
  const sessionRes = await api('/sessions', {
    method: 'POST', token: guru,
    body: {
      examId, title: `${PREFIX} sesi beban`,
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + (argv.duration + 600) * 1000).toISOString(),
      durationMin: Math.ceil((argv.duration + 300) / 60),
      tokenIntervalSec: 600, maxViolations: 20, requireSeb: false,
      shuffleQuestions: false, shuffleOptions: false, kelasIds: [kelasId],
    },
  });
  const sessionId = sessionRes.json?.id;
  if (!sessionId) throw new Error(`Buat sesi gagal: ${sessionRes.status} ${sessionRes.text.slice(0, 300)}`);
  await api(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'SCHEDULED' } });
  await api(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'ACTIVE' } });
  const token = (await api(`/sessions/${sessionId}/token/release`, {
    method: 'POST', token: proktor, body: { note: PREFIX },
  })).json?.token;
  if (!token) throw new Error('Rilis token gagal');

  const students = [];
  const base = Number(String(Date.now()).slice(-7)) * 100;
  let next = 0;
  let tries = 0;
  while (students.length < argv.users && tries < argv.users * 3) {
    const batch = Math.min(20, argv.users - students.length);
    tries += batch;
    await Promise.all(Array.from({ length: batch }, async () => {
      // NISN wajib tepat 10 digit angka (lihat shared/schemas.ts).
      const username = String(base + next++).padStart(10, '0');
      const r = await api('/users', {
        method: 'POST', token: admin,
        body: { username, password: 'Siswa123!', name: `Beban ${username}`, role: 'SISWA', nisn: username, kelasId },
      });
      if (r.status < 300) students.push({ username, id: r.json?.id });
      else if (r.status !== 409) console.warn(`  Buat siswa ${username} gagal: ${r.status} ${r.text.slice(0, 100)}`);
    }));
  }
  if (students.length < argv.users) throw new Error(`Hanya ${students.length}/${argv.users} siswa berhasil dibuat`);
  console.log(`Setup selesai: ${students.length} siswa, ${questionIds.length} soal.\n`);
  return { admin, guru, proktor, questionIds, examId, sessionId, token, students };
}

async function runStudent(slot, ctx, startAt) {
  await sleep(Math.max(0, startAt - Date.now()));
  const { username } = ctx.students[slot];
  const until = Date.now() + argv.duration * 1000;
  let attemptId = '';
  let jwt = '';
  let socket = null;

  try {
    const l = record('login', await login('siswa', username, 'Siswa123!'));
    if (l.status >= 300) return;
    jwt = l.json.accessToken;

    const st = record('start', await api('/attempts/start', {
      method: 'POST', token: jwt, body: { sessionId: ctx.sessionId, token: ctx.token },
    }));
    if (st.status >= 300) return;
    // start mengembalikan buildState → id ada di `attempt.id` (bukan top-level).
    attemptId = st.json?.attempt?.id;
    if (!attemptId) {
      console.warn(`  start tanpa attempt.id: ${st.text.slice(0, 160)}`);
      return;
    }
    const qid = st.json?.questions?.[0]?.id ?? ctx.questionIds[0];

    try {
      socket = io(`${WEB}/monitoring`, {
        auth: { token: jwt }, transports: ['websocket'], reconnection: false,
      });
      await new Promise((resolve) => {
        socket.on('connect', () => { socket.emit('attempt:join', attemptId); resolve(); });
        socket.on('connect_error', resolve);
        setTimeout(resolve, 5000);
      });
    } catch { /* socket opsional */ }

    let beatAt = Date.now() + 25_000;
    while (Date.now() < until) {
      record('autosave', await api(`/attempts/${attemptId}/answers`, {
        method: 'PUT', token: jwt,
        body: { questionId: qid, payload: 'a', isFlagged: false },
      }));
      if (socket?.connected) socket.emit('attempt:heartbeat', attemptId);
      if (Date.now() >= beatAt) beatAt = Date.now() + 25_000;
      await sleep(argv.answerEvery);
    }
    record('submit', await api(`/attempts/${attemptId}/submit`, {
      method: 'POST', token: jwt, body: { reason: 'MANUAL' },
    }));
  } catch (e) {
    stats.err++;
    console.error(`  VU ${slot} error: ${e.message} ${e.cause?.code ?? e.cause?.message ?? ''}`);
  } finally {
    socket?.disconnect();
  }
}

/**
 * Cleanup deterministik lewat Prisma. Endpoint DELETE API menolak sesi ACTIVE
 * dan user yang punya AuditLog ATTEMPT_SUBMIT, jadi uji beban membersihkan
 * datanya sendiri langsung dari DB_dev (skrip ini memang hanya untuk dev).
 */
async function cleanupDb(ctx) {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
  const p = new PrismaClient();
  try {
    const usernames = ctx.students.map((s) => s.username);
    const users = await p.user.findMany({ where: { username: { in: usernames } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await p.examSession.deleteMany({ where: { title: { startsWith: PREFIX } } });
    await p.exam.deleteMany({ where: { title: { startsWith: PREFIX } } });
    await p.question.deleteMany({ where: { id: { in: ctx.questionIds } } });
    await p.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await p.$disconnect();
  }
}

async function teardown(ctx) {
  if (argv.keep) { console.log(`--keep: data ${PREFIX} dipertahankan.`); return; }
  console.log(`\nBersihkan data ${PREFIX}...`);
  try {
    await cleanupDb(ctx);
    console.log('Selesai.');
  } catch (e) {
    console.warn(`  cleanup gagal: ${e.message.split('\n')[0]} — hapus manual judul ${PREFIX}`);
  }
}

async function main() {
  const began = Date.now();
  const ctx = await setup();
  console.log(`== Run: ${argv.users} VU, ramp ${argv.ramp}s, durasi ${argv.duration}s ==`);
  const t0 = Date.now();
  await Promise.all(ctx.students.map((_, i) => runStudent(i, ctx, t0 + (i / argv.users) * argv.ramp * 1000)));
  console.log(`\n== Hasil (${((Date.now() - began) / 1000).toFixed(1)}s) ==`);
  const all = stats.latencies.sort((a, b) => a - b);
  console.log(`Request: ${stats.ok} sukses, ${stats.err} gagal (429: ${stats.ratelimit})`);
  console.log(`Latensi p50/p95/p99: ${pct(all, .5).toFixed(0)} / ${pct(all, .95).toFixed(0)} / ${pct(all, .99).toFixed(0)} ms`);
  for (const [phase, s] of Object.entries(stats.byPhase)) {
    const l = s.ms.sort((a, b) => a - b);
    console.log(`  ${phase.padEnd(9)} ok=${String(s.ok).padStart(6)} err=${String(s.err).padStart(4)} p95=${pct(l, .95).toFixed(0)}ms`);
  }
  await teardown(ctx);
  if (stats.err > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
