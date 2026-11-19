// Verifikasi audit — mengunci setiap bug yang ditemukan & diperbaiki.
// Jalankan: node scripts/verify-audit.mjs
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

async function call(path, { method = 'GET', body, token, raw } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
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
  return { status: res.status, json, text, headers: res.headers };
}

const login = async (role, username, password) => {
  const r = await call(`/auth/login/${role}`, { method: 'POST', body: { username, password } });
  if (r.status >= 300 || !r.json?.accessToken) throw new Error(`Login ${role}/${username} gagal: ${r.status}`);
  return r.json.accessToken;
};

const asArr = (r) => (Array.isArray(r) ? r : r.data);

function connect(token) {
  return io(`${ORIGIN}/monitoring`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    auth: { token, schoolId: process.env.CBT_SCHOOL ?? 'sman1' },
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

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+7E0WAAAAAElFTkSuQmCC';

async function ensureUser(admin, { username, name, role, password, nisn, kelasId }) {
  const created = await call('/users', {
    method: 'POST',
    token: admin,
    body: { username, password, name, role, ...(nisn ? { nisn } : {}), ...(kelasId ? { kelasId } : {}) },
  });
  if (created.status < 300) return created.json.id;
  const found = await call(`/users?search=${username}&limit=1`, { token: admin });
  const row = asArr(found.json).find((u) => u.username === username) ?? asArr(found.json)[0];
  if (!row) throw new Error(`Gagal menyiapkan ${username}: ${created.status} ${created.text.slice(0, 160)}`);
  // Akun uji bisa sudah nonaktif/berpassword lama — aktifkan & reset agar login andal.
  if (row.isActive === false) {
    const reactivate = await call(`/users/${row.id}`, { method: 'PATCH', token: admin, body: { isActive: true } });
    if (reactivate.status >= 300) throw new Error(`Gagal mengaktifkan ${username}: ${reactivate.status}`);
  }
  const reset = await call(`/users/${row.id}/reset-password`, { method: 'POST', token: admin, body: { newPassword: password } });
  if (reset.status >= 300) throw new Error(`Gagal reset password ${username}: ${reset.status} ${reset.text.slice(0, 160)}`);
  return row.id;
}

async function main() {
  console.log(`== CBT audit verification @ ${BASE} ==\n`);

  console.log('[setup]');
  const admin = await login('admin', 'admin', 'Admin123!');
  const guru = await login('guru', 'guru', 'Guru123!');
  const proktor = await login('proktor', 'proktor', 'Proktor123!');
  const siswaA = await login('siswa', '0051234567', 'Siswa123!');
  // Kelas seed dipilih dari NISN siswa seed, bukan indeks 0 — daftar kelas bisa
  // bertambah karena data uji lain sehingga urutannya bergeser.
  const seedRows = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: admin })).json);
  const kelasId = seedRows.find((u) => u.username === '0051234567')?.kelasId ?? asArr((await call('/kelas', { token: admin })).json)[0].id;
  const mapelId = asArr((await call('/mapel', { token: admin })).json)[0].id;
  const guru2Id = await ensureUser(admin, { username: 'guru2', name: 'Guru Kedua', role: 'GURU', password: 'Guru123!' });
  const guru2 = await login('guru', 'guru2', 'Guru123!');
  await ensureUser(admin, { username: '0098000001', name: 'Uji Audit B', role: 'SISWA', password: 'Siswa123!', nisn: '0098000001', kelasId });
  const siswaB = await login('siswa', '0098000001', 'Siswa123!');
  check('login 3 role + guru kedua + siswa kedua', Boolean(guru2Id && guru2 && siswaB));

  const q = await call('/questions', {
    method: 'POST',
    token: guru,
    body: {
      type: 'PG',
      content: 'Soal audit — 2 + 2 = ?',
      weight: 4,
      scoringMode: 'ALL_OR_NOTHING',
      choices: [
        { id: 'a', label: '4' },
        { id: 'b', label: '5' },
      ],
      correctChoices: ['a'],
    },
  });
  const exam = await call('/exams', { method: 'POST', token: guru, body: { title: 'Ujian Audit', mapelId } });
  const examId = exam.json.id;
  await call(`/exams/${examId}/questions`, { method: 'PUT', token: guru, body: { questionIds: [q.json.id] } });
  const now = Date.now();
  const session = await call('/sessions', {
    method: 'POST',
    token: guru,
    body: {
      examId,
      title: 'Sesi Audit',
      startsAt: new Date(now - 30_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
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
  const rel = await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktor, body: { note: 'audit' } });
  await new Promise((r) => setTimeout(r, 1200));
  const startA = await call('/attempts/start', { method: 'POST', token: siswaA, body: { sessionId, token: rel.json.token } });
  const startB = await call('/attempts/start', { method: 'POST', token: siswaB, body: { sessionId, token: rel.json.token } });
  const attemptA = startA.json?.attempt?.id;
  const attemptB = startB.json?.attempt?.id;
  check('2 attempt dibuat', Boolean(attemptA && attemptB), `${attemptA} ${attemptB}`);

  console.log('\n[BUG 1 — nilai bocor sebelum publish lewat GET /attempts/:id]');
  await call(`/attempts/${attemptA}/answers`, { method: 'PUT', token: siswaA, body: { questionId: q.json.id, payload: 'a' } });
  await call(`/attempts/${attemptA}/submit`, { method: 'POST', token: siswaA, body: { reason: 'MANUAL' } });
  const stateA = await call(`/attempts/${attemptA}`, { token: siswaA });
  check(
    'state siswa menyembunyikan nilai sebelum guru publish',
    stateA.json?.attempt?.score === null && stateA.json?.session?.resultsPublished === false,
    JSON.stringify({ score: stateA.json?.attempt?.score, published: stateA.json?.session?.resultsPublished }),
  );
  const resultsGuru = await call(`/sessions/${sessionId}/results`, { token: guru });
  const rowA = resultsGuru.json?.data?.find((d) => d.attemptId === attemptA);
  check('server tetap menghitung nilainya (4/4)', rowA?.score === 4, JSON.stringify({ score: rowA?.score }));

  console.log('\n[BUG 2 — autosave tanpa payload menimpa jawaban]');
  await call(`/attempts/${attemptB}/answers`, { method: 'PUT', token: siswaB, body: { questionId: q.json.id, payload: 'b' } });
  const flagOnly = await call(`/attempts/${attemptB}/answers`, {
    method: 'PUT',
    token: siswaB,
    body: { questionId: q.json.id, isFlagged: true },
  });
  const stateB = await call(`/attempts/${attemptB}`, { token: siswaB });
  const savedB = stateB.json?.answers?.find((a) => a.questionId === q.json.id);
  check('PUT tanpa payload tidak menghapus jawaban', flagOnly.status < 300 && savedB?.payload === 'b', JSON.stringify(savedB));
  check('tanda ragu-ragu tetap tersimpan', savedB?.isFlagged === true, JSON.stringify(savedB));
  const overwrite = await call(`/attempts/${attemptB}/answers`, {
    method: 'PUT',
    token: siswaB,
    body: { questionId: q.json.id, payload: 'a', isFlagged: false },
  });
  const stateB2 = await call(`/attempts/${attemptB}`, { token: siswaB });
  const savedB2 = stateB2.json?.answers?.find((a) => a.questionId === q.json.id);
  check('PUT dengan payload tetap memperbarui jawaban', overwrite.status < 300 && savedB2?.payload === 'a', JSON.stringify(savedB2));

  console.log('\n[BUG 3 — socket: attempt milik peserta lain & token palsu]');
  const sockA = connect(siswaA);
  await new Promise((resolve) => sockA.once('connect', resolve));
  const joinOwn = await emitAck(sockA, 'attempt:join', attemptA);
  check('siswa bisa masuk ruang attempt miliknya', joinOwn?.ok === true, JSON.stringify(joinOwn));
  const joinOther = await emitAck(sockA, 'attempt:join', attemptB);
  check('siswa DITOLAK masuk ruang attempt peserta lain', joinOther?.ok === false, JSON.stringify(joinOther));
  const hbOther = await emitAck(sockA, 'attempt:heartbeat', attemptB);
  check('heartbeat attempt peserta lain DITOLAK', hbOther?.ok === false, JSON.stringify(hbOther));
  const sockFake = connect('token-salah');
  // Server memutus socket tanpa token sah; 'connect' bisa sempat terpicu lebih
  // dulu, jadi tunggu sebentar lalu pastikan koneksinya memang sudah putus.
  await new Promise((r) => {
    sockFake.once('connect', r);
    sockFake.once('connect_error', r);
    setTimeout(r, 1500);
  });
  await new Promise((r) => setTimeout(r, 1200));
  const fakeJoin = await emitAck(sockFake, 'monitor:join', sessionId);
  check(
    'socket dengan token palsu diputus & tidak bisa apa-apa',
    sockFake.connected === false && fakeJoin?.ok === false,
    JSON.stringify({ connected: sockFake.connected, join: fakeJoin }),
  );
  const board = await call(`/sessions/${sessionId}/monitoring`, { token: proktor });
  const rowBoard = board.json?.data?.find((d) => d.attempt.id === attemptB);
  check('papan tidak menandai peserta lain sebagai online', rowBoard?.online === false, JSON.stringify({ online: rowBoard?.online }));
  sockA.close();
  sockFake.close();

  console.log('\n[BUG 4 — analitik ujian bisa dibaca guru lain]');
  const anaOwner = await call(`/exams/${examId}/analytics`, { token: guru });
  check('pemilik ujian boleh membuka analitiknya', anaOwner.status === 200 && anaOwner.json?.examId === examId, `status=${anaOwner.status}`);
  const anaOther = await call(`/exams/${examId}/analytics`, { token: guru2 });
  check('guru lain DITOLAK (403)', anaOther.status === 403, `status=${anaOther.status}`);
  check('proktor ditolak analitik (403)', (await call(`/exams/${examId}/analytics`, { token: proktor })).status === 403);
  check('admin boleh membaca analitik', (await call(`/exams/${examId}/analytics`, { token: admin })).status === 200);
  check('siswa ditolak analitik (403)', (await call(`/exams/${examId}/analytics`, { token: siswaA })).status === 403);
  check('anonim ditolak analitik (401)', (await call(`/exams/${examId}/analytics`)).status === 401);

  console.log('\n[BUG 5 — BA Digital dihapus — endpoint sertifikat tidak ada lagi]');
  check('GET exam tidak dikenal / certificate → 404 (fitur dihapus)', (await call(`/exams/${examId}/certificate?userId=${rowA?.user?.id}`, { token: guru })).status === 404);
  check('route hilang meski proktor akses → 404', (await call(`/exams/${examId}/certificate?userId=${rowA?.user?.id}`, { token: proktor })).status === 404);
  check('route hilang meski admin akses → 404', (await call(`/exams/${examId}/certificate?userId=${rowA?.user?.id}`, { token: admin })).status === 404);

  console.log('\n[BUG 6 — gambar soal tidak masuk volume Docker + sisa file gagal dihapus]');
  const qImg = await call('/questions', {
    method: 'POST',
    token: guru,
    body: {
      type: 'PG',
      content: 'Soal dengan gambar audit',
      weight: 1,
      scoringMode: 'ALL_OR_NOTHING',
      choices: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correctChoices: ['a'],
    },
  });
  const form = new FormData();
  form.set('image', new Blob([Buffer.from(PNG_1x1, 'base64')], { type: 'image/png' }), 'audit.png');
  const upRes = await fetch(`${BASE}/questions/${qImg.json.id}/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guru}` },
    body: form,
  });
  const upJson = await upRes.json().catch(() => null);
  const imageUrl = upJson?.imageUrl;
  check('unggah gambar soal diterima', upRes.status < 300 && /^\/uploads\/questions\/.+\.png$/.test(imageUrl ?? ''), `${upRes.status} ${JSON.stringify(upJson)}`);
  // P6: /uploads kini bertanda tangan — tanpa sig harus 403, dengan sig 200.
  const imgRes = await fetch(`${ORIGIN}${imageUrl}`);
  check('gambar TANPA signature ditolak (403)', imgRes.status === 403, `status=${imgRes.status}`);
  const signRes = await call(`/uploads/sign?path=${encodeURIComponent(imageUrl)}`, { token: guru });
  const signedUrl = signRes.json?.url;
  check('endpoint sign menerbitkan URL bertanda tangan', signRes.status === 200 && typeof signedUrl === 'string' && signedUrl.includes('exp='), `${signRes.status} ${JSON.stringify(signRes.json)}`);
  const signedRes = signedUrl ? await fetch(`${ORIGIN}${signedUrl}`) : null;
  const imgBuf = signedRes ? Buffer.from(await signedRes.arrayBuffer()) : Buffer.alloc(0);
  check(
    'gambar tersaji lewat /uploads dengan signature (200 + PNG)',
    Boolean(signedRes && signedRes.status === 200 && imgBuf.subarray(1, 4).toString() === 'PNG' && imgBuf.length > 50),
    `status=${signedRes?.status} bytes=${imgBuf.length}`,
  );
  const delQ = await call(`/questions/${qImg.json.id}`, { method: 'DELETE', token: guru });
  check('soal bergambar bisa dihapus (file ikut dibersihkan)', delQ.status < 300, `${delQ.status} ${delQ.text.slice(0, 120)}`);
  const signAfter = await call(`/uploads/sign?path=${encodeURIComponent(imageUrl)}`, { token: guru });
  const signedAfter = signAfter.json?.url ? await fetch(`${ORIGIN}${signAfter.json.url}`) : null;
  check('berkas gambar benar-benar terhapus dari disk', signedAfter?.status === 404, `status=${signedAfter?.status}`);
  console.log(`  INFO  imageUrl=${imageUrl} (cek volume: docker exec cbt-api ls ${imageUrl.replace('/uploads', '/app/uploads')} — harus tidak ada)`);

  console.log('\n[BUG 7 — Kartu Login UNIVERSAL (A4, 8/halaman)]');
  const kartuCount = await call('/kartu/count', { token: proktor });
  check('GET /kartu/count (proktor) → 200 + total angka', kartuCount.status === 200 && typeof kartuCount.json?.total === 'number', `${kartuCount.status}`);
  const kartuPdf = await call('/kartu/pdf', { token: proktor, raw: true });
  const kartuBuf = Buffer.from(await kartuPdf.arrayBuffer());
  check(
    'GET /kartu/pdf = PDF asli (application/pdf)',
    kartuPdf.status === 200 && kartuBuf.subarray(0, 4).toString() === '%PDF' && /application\/pdf/.test(kartuPdf.headers.get('content-type') ?? ''),
    `status=${kartuPdf.status} type=${kartuPdf.headers.get('content-type')} bytes=${kartuBuf.length}`,
  );
  check('nama berkas kartu disertakan', /kartu-login.*.pdf/.test(kartuPdf.headers.get('content-disposition') ?? ''), kartuPdf.headers.get('content-disposition') ?? '');
  check('GURU ditolak kartu universal (403)', (await call('/kartu/pdf', { token: guru })).status === 403);
  check('siswa ditolak kartu universal (403)', (await call('/kartu/pdf', { token: siswaA })).status === 403);
  check('anonim ditolak kartu universal (401)', (await call('/kartu/pdf')).status === 401);

  console.log('\n[otorisasi Fase 7 — guru lain tidak boleh menilai/menerbitkan]');
  check('guru lain ditolak papan penilaian (403)', (await call(`/sessions/${sessionId}/grading`, { token: guru2 })).status === 403);
  check('guru lain ditolak hasil sesi (403)', (await call(`/sessions/${sessionId}/results`, { token: guru2 })).status === 403);
  check('guru lain ditolak daftar review (403)', (await call(`/sessions/${sessionId}/reviews`, { token: guru2 })).status === 403);
  check('guru lain ditolak analisis butir (403)', (await call(`/sessions/${sessionId}/item-analysis`, { token: guru2 })).status === 403);
  check('guru lain ditolak nilai ulang (403)', (await call(`/sessions/${sessionId}/grade`, { method: 'POST', token: guru2 })).status === 403);
  check('guru lain ditolak publish (403)', (await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru2, body: { published: true } })).status === 403);
  check(
    'guru lain ditolak review manual jawaban (403)',
    (await call(`/attempts/${attemptA}/review`, { method: 'POST', token: guru2, body: { questionId: q.json.id, score: 0 } })).status === 403,
  );
  check('proktor ditolak papan penilaian (403)', (await call(`/sessions/${sessionId}/grading`, { token: proktor })).status === 403);

  console.log('\n[efek publish pada gerbang nilai]');
  await call(`/attempts/${attemptB}/submit`, { method: 'POST', token: siswaB, body: { reason: 'MANUAL' } });
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'CLOSED' } });
  const pub = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru, body: { published: true } });
  check('publish berhasil', pub.status < 300 && pub.json?.resultsPublished === true, `${pub.status} ${pub.text.slice(0, 140)}`);
  const stateAfter = await call(`/attempts/${attemptA}`, { token: siswaA });
  check('setelah publish score tetap null di state siswa (nilai tidak tampil di app)', stateAfter.json?.attempt?.score === null, String(stateAfter.json?.attempt?.score));

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
