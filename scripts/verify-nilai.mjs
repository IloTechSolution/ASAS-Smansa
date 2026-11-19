// Regresi alur nilai (11 Nov 2026):
//  - siswa TIDAK melihat nilai di app (endpoint /attempts/:id/result dihapus, score selalu null)
//  - nilai hanya guru pemilik (+admin); proktor ditolak (403) di papan penilaian/hasil/analitik
//  - export nilai Excel TERKUNCI (409) selama masih ada isian singkat menunggu review guru
// Jalankan: node scripts/verify-nilai.mjs
const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';
import 'dotenv/config';

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
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

const login = async (role, username, password) => {
  const r = await call(`/auth/login/${role}`, { method: 'POST', body: { username, password } });
  if (r.status >= 300 || !r.json?.accessToken) throw new Error(`Login ${username} gagal: ${r.status}`);
  return r.json;
};
const asArr = (r) => (Array.isArray(r) ? r : r.data);
const stamp = Date.now().toString(36);

async function main() {
  console.log(`== CBT nilai verification @ ${BASE} ==\n`);

  const admin = await login('admin', 'admin', 'Admin123!');
  const guru = await login('guru', 'guru', 'Guru123!');
  const proktor = await login('proktor', 'proktor', 'Proktor123!');
  const kelasId = asArr((await call('/kelas', { token: admin.accessToken })).json)[0]?.id;
  if (!kelasId) throw new Error('tidak ada kelas');

  // Siswa uji baru di kelas seed
  const digits = String(Date.now() % 10000000000).padStart(10, '0');
  const buat = await call('/users', {
    method: 'POST',
    token: admin.accessToken,
    body: { username: digits, password: 'Siswa123!', name: `NilaiTest ${stamp}`, role: 'SISWA', nisn: digits, kelasId },
  });
  const siswaId = buat.json?.id;
  const siswa = await login('siswa', digits, 'Siswa123!');
  console.log(`[setup] siswa=${digits}\n`);

  // Mapel: Matematika
  const mapels = asArr((await call('/mapel', { token: admin.accessToken })).json);
  const mapelId = (mapels.find((m) => m.name === 'Matematika') ?? mapels[0])?.id;

  // Soal: 1 PG (10) + 1 ISIAN_SINGKAT (10)
  const pg = await call('/questions', {
    method: 'POST',
    token: guru.accessToken,
    body: { type: 'PG', content: 'Nilai uji PG — 1+1?', weight: 10, scoringMode: 'ALL_OR_NOTHING', choices: [{ id: 'a', label: '2' }, { id: 'b', label: '3' }], correctChoices: ['a'] },
  });
  const isian = await call('/questions', {
    method: 'POST',
    token: guru.accessToken,
    body: { type: 'ISIAN_SINGKAT', content: 'Nilai uji isian — ibu kota Indonesia?', weight: 10, scoringMode: 'ALL_OR_NOTHING', acceptedAnswers: ['jakarta'] },
  });
  const exam = await call('/exams', { method: 'POST', token: guru.accessToken, body: { title: `Ujian nilai uji ${stamp}`, mapelId } });
  const examId = exam.json?.id;
  await call(`/exams/${examId}/questions`, { method: 'PUT', token: guru.accessToken, body: { questionIds: [pg.json?.id, isian.json?.id] } });

  const now = Date.now();
  const sesi = await call('/sessions', {
    method: 'POST',
    token: guru.accessToken,
    body: {
      examId, title: `Sesi nilai uji ${stamp}`,
      startsAt: new Date(now - 30_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
      durationMin: 30, kelasIds: [kelasId], shuffleQuestions: false, shuffleOptions: false,
    },
  });
  const sessionId = sesi.json?.id;
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru.accessToken, body: { status: 'SCHEDULED' } });
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru.accessToken, body: { status: 'ACTIVE' } });

  const rel = await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktor.accessToken, body: {} });
  const start = await call('/attempts/start', { method: 'POST', token: siswa.accessToken, body: { sessionId, token: rel.json.token } });
  const attemptId = start.json?.attempt?.id ?? start.json?.id;
  if (!attemptId) throw new Error(`attempt gagal: ${start.status} ${start.text.slice(0, 200)}`);
  await call(`/attempts/${attemptId}/answers`, { method: 'PUT', token: siswa.accessToken, body: { questionId: pg.json?.id, payload: 'a' } });
  await call(`/attempts/${attemptId}/answers`, { method: 'PUT', token: siswa.accessToken, body: { questionId: isian.json?.id, payload: 'semarang' } });
  await call(`/attempts/${attemptId}/submit`, { method: 'POST', token: siswa.accessToken, body: { reason: 'MANUAL' } });
  console.log('[setup] attempt selesai, isian salah → perlu review guru\n');

  console.log('[1 — export nilai terkunci sebelum review]');
  const exportBefore = await call(`/sessions/${sessionId}/export/nilai`, { token: guru.accessToken, raw: true });
  check('export nilai ditolak 409 (masih ada review tertunda)', exportBefore.status === 409, `status=${exportBefore.status}`);
  const papan = await call(`/sessions/${sessionId}/grading`, { token: guru.accessToken });
  check('papan guru menunjukkan review tertunda ≥ 1', (papan.json?.summary?.pendingReview ?? papan.json?.pendingReview) >= 1, JSON.stringify(papan.json).slice(0, 200));

  console.log('\n[2 — proktor TIDAK melihat nilai (403)]');
  check('proktor ditolak papan penilaian (403)', (await call(`/sessions/${sessionId}/grading`, { token: proktor.accessToken })).status === 403);
  check('proktor ditolak hasil sesi (403)', (await call(`/sessions/${sessionId}/results`, { token: proktor.accessToken })).status === 403);
  check('proktor ditolak analisis butir (403)', (await call(`/sessions/${sessionId}/item-analysis`, { token: proktor.accessToken })).status === 403);
  check('proktor ditolak analitik ujian (403)', (await call(`/exams/${examId}/analytics`, { token: proktor.accessToken })).status === 403);
  check('proktor ditolak export nilai (403)', (await call(`/sessions/${sessionId}/export/nilai`, { token: proktor.accessToken, raw: true })).status === 403);

  console.log('\n[3 — siswa TIDAK melihat nilai di app]');
  check('GET /attempts/:id/result → 404 (dihapus)', (await call(`/attempts/${attemptId}/result`, { token: siswa.accessToken })).status === 404);
  const avail = asArr((await call('/attempts/available', { token: siswa.accessToken })).json?.data);
  const row = avail.find((s) => s.id === sessionId);
  check('daftar ujian siswa: score null', row?.attempt?.score === null, JSON.stringify(row?.attempt));

  console.log('\n[4 — guru review dulu → baru bisa export]');
  const reviewsBefore = await call(`/sessions/${sessionId}/reviews`, { token: guru.accessToken });
  const isianRow = asArr(reviewsBefore.json?.data).find((r) => r.questionId === isian.json?.id);
  check('jawaban isian salah masuk antrean review', isianRow?.answer === 'semarang', JSON.stringify(isianRow).slice(0, 150));
  const review = await call(`/attempts/${attemptId}/review`, {
    method: 'POST', token: guru.accessToken,
    body: { questionId: isian.json?.id, score: 0, note: 'salah — kunci: Jakarta' },
  });
  check('guru memberi skor review 0', review.status < 300, `status=${review.status} ${review.text.slice(0, 140)}`);
  const exportAfter = await call(`/sessions/${sessionId}/export/nilai`, { token: guru.accessToken, raw: true });
  check('export nilai berhasil setelah review (200 + xlsx)', exportAfter.status === 200 && (exportAfter.headers.get('content-type') ?? '').includes('spreadsheetml'), `status=${exportAfter.status} type=${exportAfter.headers.get('content-type')}`);
  const exportBuf = Buffer.from(await exportAfter.arrayBuffer());
  check('berkas xlsx tidak kosong (>400 byte)', exportBuf.length > 400, `bytes=${exportBuf.length}`);

  console.log('\n[5 — setelah publish pun, siswa tetap tidak melihat nilai]');
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru.accessToken, body: { status: 'CLOSED' } });
  const pub = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru.accessToken, body: { published: true } });
  check('publish sukses', pub.status < 300 && pub.json?.resultsPublished === true, `status=${pub.status} ${pub.text.slice(0, 140)}`);
  check('endpoint hasil siswa tetap 404 setelah publish', (await call(`/attempts/${attemptId}/result`, { token: siswa.accessToken })).status === 404);
  const availPub = asArr((await call('/attempts/available', { token: siswa.accessToken })).json?.data);
  const rowPub = availPub.find((s) => s.id === sessionId);
  check('score tetap null di daftar ujian siswa setelah publish', rowPub?.attempt?.score === null, JSON.stringify(rowPub?.attempt));

  console.log(`\n== HASIL: ${pass} PASS, ${fail} FAIL ==`);
  if (fail > 0) {
    console.log('Gagal:');
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
