// Verifikasi eksekusi Fase 7 — mesin penilaian 5 tipe soal (bobot,
// all-or-nothing/proporsional), review manual isian singkat, publish hasil,
// dan analisis butir soal.
// Jalankan: node scripts/verify-fase-7.mjs
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
  if (r.status >= 300 || !r.json?.accessToken) throw new Error(`Login ${role}/${username} gagal: ${r.status} ${r.text.slice(0, 160)}`);
  return r.json.accessToken;
};

const asArr = (r) => (Array.isArray(r) ? r : r.data);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bobot tiap soal — total 25. */
const WEIGHT = { PG: 4, PGK_PROP: 6, MATCH: 3, BS: 3, ISIAN: 4, PGK_AON: 5 };

/** Jawaban tiap peserta + skor akhir yang diharapkan dari mesin penilaian. */
const STUDENTS = {
  // Semua benar (isian beda kapitalisasi → harus tetap cocok).
  A: {
    expect: 25,
    answers: {
      PG: 'a',
      PGK_PROP: ['a', 'b', 'c'],
      MATCH: { l1: 'r1', l2: 'r2', l3: 'r3' },
      BS: { s1: true, s2: false, s3: true },
      ISIAN: 'Tokyo',
      PGK_AON: ['a', 'b'],
    },
  },
  // PGK proporsional sebagian dihitung, MATCHING all-or-nothing jadi 0, isian perlu review.
  B: {
    expectBeforeReview: 11,
    expect: 15,
    answers: {
      PG: 'a',
      PGK_PROP: ['a', 'b'],
      MATCH: { l1: 'r1', l2: 'r2', l3: 'r1' },
      BS: { s1: true, s2: false, s3: true },
      ISIAN: 'Bandung',
      PGK_AON: ['a'],
    },
  },
  C: {
    expect: 15,
    answers: {
      PG: 'b',
      PGK_PROP: ['a', 'b', 'c', 'd'],
      MATCH: { l1: 'r1', l2: 'r3', l3: 'r2' },
      BS: { s1: true, s2: false, s3: false },
      ISIAN: 'tokyo',
      PGK_AON: ['a', 'b'],
    },
  },
  D: { expect: 0, answers: {} },
  E: {
    expect: 0,
    answers: {
      PG: 'c',
      PGK_PROP: ['d'],
      MATCH: { l1: 'r2', l2: 'r3', l3: 'r1' },
      BS: { s1: false, s2: true, s3: false },
      ISIAN: '',
      PGK_AON: ['a'],
    },
  },
};

async function ensureStudent(admin, nisn, name, kelasId) {
  const created = await call('/users', {
    method: 'POST',
    token: admin,
    body: { username: nisn, password: 'Siswa123!', name, role: 'SISWA', nisn, kelasId },
  });
  if (created.status < 300) return created.json.id;
  const found = await call(`/users?search=${nisn}&limit=1`, { token: admin });
  const row = asArr(found.json).find?.((u) => u.nisn === nisn) ?? asArr(found.json)[0];
  if (!row) throw new Error(`Gagal menyiapkan siswa ${nisn}: ${created.status} ${created.text.slice(0, 160)}`);
  return row.id;
}

async function main() {
  console.log(`== CBT Fase 7 verification @ ${BASE} ==\n`);

  console.log('[data & login]');
  const admin = await login('admin', 'admin', 'Admin123!');
  const guru = await login('guru', 'guru', 'Guru123!');
  const proktor = await login('proktor', 'proktor', 'Proktor123!');
  const tokenA = await login('siswa', '0051234567', 'Siswa123!');
  check('login 4 role', true);

  // Kelas seed dipilih dari NISN siswa seed, bukan indeks 0 — daftar kelas bisa
  // bertambah karena data uji lain sehingga urutannya bergeser.
  const seedRows = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: admin })).json);
  const kelasId = seedRows.find((u) => u.username === '0051234567')?.kelasId ?? asArr((await call('/kelas', { token: admin })).json)[0].id;
  const mapelId = asArr((await call('/mapel', { token: admin })).json)[0].id;

  // 6 soal: 5 tipe + kedua mode penilaian untuk kunci jamak.
  const mk = (body) => call('/questions', { method: 'POST', token: guru, body });
  const qPG = await mk({
    type: 'PG',
    content: 'Ibu kota Indonesia adalah…',
    weight: WEIGHT.PG,
    scoringMode: 'ALL_OR_NOTHING',
    choices: [
      { id: 'a', label: 'Jakarta' },
      { id: 'b', label: 'Bandung' },
      { id: 'c', label: 'Surabaya' },
    ],
    correctChoices: ['a'],
    explanation: 'Ibu kota Indonesia adalah Jakarta.',
  });
  const qPGKProp = await mk({
    type: 'PG_KOMPLEKS',
    content: 'Pilih bilangan genap.',
    weight: WEIGHT.PGK_PROP,
    scoringMode: 'PROPORSIONAL',
    choices: [
      { id: 'a', label: '2' },
      { id: 'b', label: '4' },
      { id: 'c', label: '6' },
      { id: 'd', label: '7' },
    ],
    correctChoices: ['a', 'b', 'c'],
  });
  const qMatch = await mk({
    type: 'MATCHING',
    content: 'Pasangkan negara dan ibu kotanya.',
    weight: WEIGHT.MATCH,
    scoringMode: 'ALL_OR_NOTHING',
    pairs: {
      left: [
        { id: 'l1', text: 'Indonesia' },
        { id: 'l2', text: 'Malaysia' },
        { id: 'l3', text: 'Jepang' },
      ],
      right: [
        { id: 'r1', text: 'Jakarta' },
        { id: 'r2', text: 'Kuala Lumpur' },
        { id: 'r3', text: 'Tokyo' },
      ],
      mapping: { l1: 'r1', l2: 'r2', l3: 'r3' },
    },
  });
  const qBS = await mk({
    type: 'BENAR_SALAH',
    content: 'Tentukan benar atau salah.',
    weight: WEIGHT.BS,
    scoringMode: 'PROPORSIONAL',
    statements: [
      { id: 's1', text: 'Air mendidih pada 100°C di tekanan normal.', answer: true },
      { id: 's2', text: 'Matahari mengelilingi bumi.', answer: false },
      { id: 's3', text: '2 + 2 = 4.', answer: true },
    ],
  });
  const qIsian = await mk({
    type: 'ISIAN_SINGKAT',
    content: 'Sebutkan ibu kota Jepang.',
    weight: WEIGHT.ISIAN,
    acceptedAnswers: ['Tokyo', 'tokyo'],
    explanation: 'Ibu kota Jepang adalah Tokyo.',
  });
  const qPGKAon = await mk({
    type: 'PG_KOMPLEKS',
    content: 'Pilih bilangan prima.',
    weight: WEIGHT.PGK_AON,
    scoringMode: 'ALL_OR_NOTHING',
    choices: [
      { id: 'a', label: '2' },
      { id: 'b', label: '3' },
      { id: 'c', label: '4' },
    ],
    correctChoices: ['a', 'b'],
  });
  const qIds = [qPG, qPGKProp, qMatch, qBS, qIsian, qPGKAon].map((q) => q.json?.id);
  check('6 soal dibuat (5 tipe + 2 mode kunci jamak)', qIds.every(Boolean), JSON.stringify(qIds));
  check(
    'total bobot soal = 25',
    [qPG, qPGKProp, qMatch, qBS, qIsian, qPGKAon].reduce((s, q) => s + (q.json?.weight ?? 0), 0) === 25,
  );

  const exam = await call('/exams', {
    method: 'POST',
    token: guru,
    body: { title: 'Uji Fase 7', description: 'penilaian', mapelId },
  });
  const examId = exam.json?.id;
  await call(`/exams/${examId}/questions`, { method: 'PUT', token: guru, body: { questionIds: qIds } });

  const now = Date.now();
  const session = await call('/sessions', {
    method: 'POST',
    token: guru,
    body: {
      examId,
      title: 'Sesi Fase 7',
      startsAt: new Date(now - 30_000).toISOString(),
      endsAt: new Date(now + 60 * 60_000).toISOString(),
      durationMin: 40,
      tokenIntervalSec: 300,
      maxViolations: 5,
      requireSeb: false,
      shuffleQuestions: false,
      shuffleOptions: false,
      kelasIds: [kelasId],
    },
  });
  const sessionId = session.json?.id;
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'SCHEDULED' } });
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'ACTIVE' } });
  const rel = await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktor, body: { note: 'f7' } });
  check('sesi ACTIVE + token rilis', Boolean(sessionId) && /^\d{6}$/.test(rel.json?.token ?? ''));
  await sleep(1200); // biar token TOTP pasti sinkron dengan jam server

  console.log('\n[peserta]');
  const roster = { A: { token: tokenA, id: null } };
  const tokens = { A: tokenA };
  for (const key of ['B', 'C', 'D', 'E', 'F']) {
    const nisn = `00990000${String(key.charCodeAt(0) - 64).padStart(2, '0')}`;
    roster[key] = { nisn, id: await ensureStudent(admin, nisn, `Uji Fase 7 ${key}`, kelasId) };
    tokens[key] = await login('siswa', nisn, 'Siswa123!');
  }
  check('6 peserta siswa siap (5 selesai + 1 masih mengerjakan)', Object.keys(roster).length === 6);

  const attempts = {};
  for (const key of Object.keys(roster)) {
    const start = await call('/attempts/start', {
      method: 'POST',
      token: tokens[key],
      body: { sessionId, token: rel.json.token },
    });
    attempts[key] = start.json?.attempt?.id;
    if (!attempts[key]) throw new Error(`start attempt ${key} gagal: ${start.status} ${start.text.slice(0, 160)}`);
  }
  check('6 attempt dibuat', Object.values(attempts).every(Boolean));

  const qByKey = { PG: qPG.json.id, PGK_PROP: qPGKProp.json.id, MATCH: qMatch.json.id, BS: qBS.json.id, ISIAN: qIsian.json.id, PGK_AON: qPGKAon.json.id };
  for (const key of Object.keys(STUDENTS)) {
    for (const [qk, payload] of Object.entries(STUDENTS[key].answers)) {
      const r = await call(`/attempts/${attempts[key]}/answers`, {
        method: 'PUT',
        token: tokens[key],
        body: { questionId: qByKey[qk], payload },
      });
      if (r.status >= 300) throw new Error(`simpan jawaban ${key}/${qk} gagal: ${r.status} ${r.text.slice(0, 160)}`);
    }
  }
  // F masih mengerjakan (hanya mengisi isian salah) → attempt tetap IN_PROGRESS.
  await call(`/attempts/${attempts.F}/answers`, {
    method: 'PUT',
    token: tokens.F,
    body: { questionId: qByKey.ISIAN, payload: 'X' },
  });
  check('jawaban tersimpan untuk semua peserta', true);

  for (const key of Object.keys(STUDENTS)) {
    const r = await call(`/attempts/${attempts[key]}/submit`, { method: 'POST', token: tokens[key], body: { reason: 'MANUAL' } });
    if (r.status >= 300) throw new Error(`submit ${key} gagal: ${r.status} ${r.text.slice(0, 160)}`);
  }
  check('5 peserta submit, 1 masih IN_PROGRESS', true);

  console.log('\n[mesin penilaian otomatis saat submit]');
  const grade0 = await call(`/sessions/${sessionId}/grading`, { token: guru });
  check('papan penilaian dapat diakses guru', grade0.status === 200, `status=${grade0.status}`);
  check('attempt dinilai otomatis tanpa menunggu publish', grade0.json?.summary?.graded === 5, JSON.stringify(grade0.json?.summary));
  check('total bobot terbaca server = 25', grade0.json?.maxScore === 25, String(grade0.json?.maxScore));
  check('review isian tertunda terdeteksi', grade0.json?.summary?.pendingReview === 1, JSON.stringify(grade0.json?.summary));

  const res0 = await call(`/sessions/${sessionId}/results`, { token: guru });
  const rowOf = (key) => res0.json?.data?.find((d) => d.attemptId === attempts[key]);
  const scores0 = Object.fromEntries(Object.keys(STUDENTS).map((k) => [k, rowOf(k)?.score]));
  check(
    'skor otomatis sesuai bobot & mode (A=25, B=11, C=15, D=0, E=0)',
    scores0.A === 25 && scores0.B === 11 && scores0.C === 15 && scores0.D === 0 && scores0.E === 0,
    JSON.stringify(scores0),
  );
  check('skor 100% untuk peserta semua benar', rowOf('A')?.percent === 100, String(rowOf('A')?.percent));

  const itemOf = (key, qk) => rowOf(key)?.items?.find((i) => i.questionId === qByKey[qk]);
  check(
    'PGK proporsional memberi skor sebagian (B: 2/3 kunci → 4)',
    itemOf('B', 'PGK_PROP')?.score === 4,
    JSON.stringify(itemOf('B', 'PGK_PROP')),
  );
  check(
    'PGK proporsional menghukum pilihan salah (C: 3 benar + 1 salah → 4)',
    itemOf('C', 'PGK_PROP')?.score === 4,
    JSON.stringify(itemOf('C', 'PGK_PROP')),
  );
  check('PGK all-or-nothing = 0 tanpa kunci lengkap', itemOf('B', 'PGK_AON')?.score === 0);
  check('MATCHING all-or-nothing = 0 untuk 2/3 pasangan', itemOf('B', 'MATCH')?.score === 0);
  check('MATCHING proporsional tidak dipakai (soal AON)', itemOf('B', 'MATCH')?.isCorrect === false);
  check('BENAR-SALAH proporsional memberi 2 dari 3', itemOf('C', 'BS')?.score === 2, JSON.stringify(itemOf('C', 'BS')));
  check('BENAR-SALAH all-or-nothing untuk peserta benar semua', itemOf('A', 'BS')?.score === 3);
  check('PG salah = 0 (C menjawab b)', itemOf('C', 'PG')?.score === 0);
  check('isian singkat cocok tanpa peduli kapitalisasi (A: "Tokyo")', itemOf('A', 'ISIAN')?.score === 4);
  check(
    'isian singkat tak cocok kunci → perlu review manual',
    itemOf('B', 'ISIAN')?.needsReview === true && itemOf('B', 'ISIAN')?.score === 0,
    JSON.stringify(itemOf('B', 'ISIAN')),
  );
  check('peserta tanpa jawaban dinilai 0 (D)', rowOf('D')?.score === 0 && rowOf('D')?.items?.length === 6);
  check(
    'rincian per butir lengkap (6 butir + bobot)',
    rowOf('A')?.items?.length === 6 && rowOf('A')?.items?.every((i) => typeof i.weight === 'number'),
  );

  console.log('\n[review manual isian singkat]');
  const reviews = await call(`/sessions/${sessionId}/reviews`, { token: guru });
  check('1 jawaban menunggu review', reviews.json?.total === 1, JSON.stringify(reviews.json).slice(0, 200));
  check(
    'review menyertakan jawaban siswa + kunci + bobot',
    reviews.json?.data?.[0]?.answer === 'Bandung' && reviews.json?.data?.[0]?.maxScore === WEIGHT.ISIAN,
    JSON.stringify(reviews.json?.data?.[0]).slice(0, 200),
  );

  const reviewF = await call(`/attempts/${attempts.F}/review`, {
    method: 'POST',
    token: guru,
    body: { questionId: qByKey.ISIAN, score: 0, note: 'salah' },
  });
  check('review attempt yang masih IN_PROGRESS ditolak (409)', reviewF.status === 409, `status=${reviewF.status}`);

  const overScore = await call(`/attempts/${attempts.B}/review`, {
    method: 'POST',
    token: guru,
    body: { questionId: qByKey.ISIAN, score: WEIGHT.ISIAN + 1 },
  });
  check('skor melebihi bobot soal ditolak (400)', overScore.status === 400, `status=${overScore.status}`);
  const reviewByStudent = await call(`/attempts/${attempts.B}/review`, {
    method: 'POST',
    token: tokenA,
    body: { questionId: qByKey.ISIAN, score: 4 },
  });
  check('siswa tidak boleh review (403)', reviewByStudent.status === 403, `status=${reviewByStudent.status}`);
  const reviewAnon = await call(`/attempts/${attempts.B}/review`, { method: 'POST', body: { questionId: qByKey.ISIAN, score: 4 } });
  check('anonim tidak boleh review (401)', reviewAnon.status === 401, `status=${reviewAnon.status}`);
  const badQuestion = await call(`/attempts/${attempts.B}/review`, {
    method: 'POST',
    token: guru,
    body: { questionId: 'soal-tidak-ada', score: 1 },
  });
  check('review soal yang tidak dijawab ditolak (404)', badQuestion.status === 404, `status=${badQuestion.status}`);

  const reviewOk = await call(`/attempts/${attempts.B}/review`, {
    method: 'POST',
    token: guru,
    body: { questionId: qByKey.ISIAN, score: 4, note: 'jawaban benar secara konsep' },
  });
  check('review manual diterima & skor total dihitung ulang', reviewOk.status < 300 && reviewOk.json?.score === 15, `${reviewOk.status} ${reviewOk.text.slice(0, 160)}`);
  const resAfterReview = await call(`/sessions/${sessionId}/results`, { token: guru });
  const rowB = resAfterReview.json?.data?.find((d) => d.attemptId === attempts.B);
  check(
    'override guru tersimpan sebagai reviewedScore',
    rowB?.items?.find((i) => i.questionId === qByKey.ISIAN)?.reviewedScore === 4,
    JSON.stringify(rowB?.items?.find((i) => i.questionId === qByKey.ISIAN)),
  );
  check(
    'review tertunda bersih (peserta yang masih mengerjakan belum dihitung)',
    (await call(`/sessions/${sessionId}/reviews`, { token: guru })).json?.total === 0,
    '',
  );

  console.log('\n[terbitkan hasil]');
  const publishBeforeClose = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru, body: { published: true } });
  check('publish ditolak selama sesi belum CLOSED (409)', publishBeforeClose.status === 409, `status=${publishBeforeClose.status}`);
  const publishByStudent = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: tokenA, body: { published: true } });
  check('siswa tidak boleh publish (403)', publishByStudent.status === 403, `status=${publishByStudent.status}`);
  const publishByProktor = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: proktor, body: { published: true } });
  check('proktor tidak boleh publish (403)', publishByProktor.status === 403, `status=${publishByProktor.status}`);
  const publishAnon = await call(`/sessions/${sessionId}/publish`, { method: 'POST', body: { published: true } });
  check('anonim tidak boleh publish (401)', publishAnon.status === 401, `status=${publishAnon.status}`);

  const resultBeforePublish = await call(`/attempts/${attempts.A}/result`, { token: tokenA });
  check('endpoint hasil siswa sudah DIHAPUS (404) — nilai tidak tampil di siswa', resultBeforePublish.status === 404, `status=${resultBeforePublish.status}`);
  const availableBefore = await call('/attempts/available', { token: tokenA });
  const avail0 = asArr(availableBefore.json).find((s) => s.id === sessionId);
  check('nilai belum bocor ke daftar ujian siswa', avail0?.attempt?.score === null && avail0?.resultsPublished === false, JSON.stringify(avail0?.attempt));

  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guru, body: { status: 'CLOSED' } });
  const publishPending = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru, body: { published: true } });
  check('publish diblokir selama masih ada peserta yang belum selesai (409)', publishPending.status === 409, `status=${publishPending.status} ${publishPending.text.slice(0, 140)}`);

  // F masih IN_PROGRESS → selesaikan dulu supaya butirnya bisa dinilai.
  await call(`/attempts/${attempts.F}/submit`, { method: 'POST', token: tokens.F, body: { reason: 'MANUAL' } });
  const publishPendingReview = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru, body: { published: true } });
  check('publish diblokir selama masih ada review tertunda (409)', publishPendingReview.status === 409, `status=${publishPendingReview.status} ${publishPendingReview.text.slice(0, 140)}`);
  check('review tertunda peserta terakhir terdeteksi', (await call(`/sessions/${sessionId}/reviews`, { token: guru })).json?.total === 1);
  const reviewFAgain = await call(`/attempts/${attempts.F}/review`, {
    method: 'POST',
    token: guru,
    body: { questionId: qByKey.ISIAN, score: 0, note: 'jawaban salah' },
  });
  check('review setelah peserta selesai diterima', reviewFAgain.status < 300, `${reviewFAgain.status} ${reviewFAgain.text.slice(0, 140)}`);
  const publishOk = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru, body: { published: true } });
  check('publish berhasil setelah sesi CLOSED & review tuntas', publishOk.status < 300 && publishOk.json?.resultsPublished === true, `${publishOk.status} ${publishOk.text.slice(0, 140)}`);

  console.log('\n[hasil untuk siswa]');
  const resultA = await call(`/attempts/${attempts.A}/result`, { token: tokenA });
  check('endpoint hasil siswa DIHAPUS (404) — nilai hanya lewat ekspor Excel guru', resultA.status === 404, `${resultA.status}`);
  const resultByGuru = await call(`/attempts/${attempts.A}/result`, { token: guru });
  check('endpoint hasil siswa juga 404 untuk guru (route hilang)', resultByGuru.status === 404, `status=${resultByGuru.status}`);
  const availableAfter = await call('/attempts/available', { token: tokenA });
  const avail1 = asArr(availableAfter.json).find((s) => s.id === sessionId);
  check('nilai TIDAK muncul di daftar ujian siswa bahkan setelah publish', avail1?.attempt?.score === null && avail1?.resultsPublished === true, JSON.stringify(avail1?.attempt));

  console.log('\n[analisis butir soal]');
  const ana = await call(`/sessions/${sessionId}/item-analysis`, { token: guru });
  check('analisis butir dapat diakses guru', ana.status === 200 && ana.json?.data?.length === 6, `status=${ana.status} rows=${ana.json?.data?.length}`);
  const anaOf = (qk) => ana.json?.data?.find((d) => d.questionId === qByKey[qk]);
  check('tingkat kesulitan PG = 0,50 (sedang)', anaOf('PG')?.difficulty === 0.5 && anaOf('PG')?.difficultyLabel === 'SEDANG', JSON.stringify(anaOf('PG')));
  check(
    'jawaban kosong & belum dijawab ikut tercatat (blank=2, answered=4)',
    anaOf('PG')?.blank === 2 && anaOf('PG')?.answered === 4,
    JSON.stringify({ blank: anaOf('PG')?.blank, answered: anaOf('PG')?.answered }),
  );
  check('matching paling sulit (0,25 → SULIT)', anaOf('MATCH')?.difficultyLabel === 'SULIT' && anaOf('MATCH')?.difficulty === 0.25, JSON.stringify(anaOf('MATCH')));
  const dist = Object.fromEntries((anaOf('PG')?.choices ?? []).map((c) => [c.id, c.picked]));
  check('sebaran pengecoh PG terhitung (a=2, b=1, c=1)', dist.a === 2 && dist.b === 1 && dist.c === 1, JSON.stringify(dist));
  check('pengecoh menandai kunci jawaban', anaOf('PG')?.choices?.find((c) => c.id === 'a')?.isKey === true);
  check(
    'daya pembeda terhitung untuk semua butir',
    ana.json?.data?.every((d) => typeof d.discrimination === 'number'),
    JSON.stringify(ana.json?.data?.map((d) => d.discrimination)),
  );
  check(
    'daya pembeda PG positif (kelompok atas lebih benar)',
    (anaOf('PG')?.discrimination ?? -1) > 0,
    String(anaOf('PG')?.discrimination),
  );
  check('analisis butir isian tanpa pengecoh', (anaOf('ISIAN')?.choices ?? []).length === 0);
  check(
    'jawaban yang diputuskan guru dihitung benar di analisis (isian 3/4)',
    anaOf('ISIAN')?.correct === 3 && anaOf('ISIAN')?.difficulty === 0.75,
    JSON.stringify({ correct: anaOf('ISIAN')?.correct, difficulty: anaOf('ISIAN')?.difficulty }),
  );
  check(
    'hasil peserta menampilkan keputusan guru sebagai benar',
    resAfterReview.json?.data?.find((d) => d.attemptId === attempts.B)?.items?.find((i) => i.questionId === qByKey.ISIAN)?.isCorrect === true,
  );

  console.log('\n[penilaian ulang & guard]');
  const regrade = await call(`/sessions/${sessionId}/grade`, { method: 'POST', token: guru });
  check('endpoint nilai ulang jalan (idempoten)', regrade.status < 300 && regrade.json?.graded >= 5, `${regrade.status} ${regrade.text.slice(0, 140)}`);
  const resFinal = await call(`/sessions/${sessionId}/results`, { token: guru });
  const finalScores = Object.fromEntries(Object.keys(STUDENTS).map((k) => [k, resFinal.json?.data?.find((d) => d.attemptId === attempts[k])?.score]));
  check(
    'nilai tidak berubah setelah dinilai ulang (A=25, B=15, C=15, D=0, E=0)',
    finalScores.A === 25 && finalScores.B === 15 && finalScores.C === 15 && finalScores.D === 0 && finalScores.E === 0,
    JSON.stringify(finalScores),
  );
  const boardByProktor = await call(`/sessions/${sessionId}/grading`, { token: proktor });
  check('proktor ditolak papan penilaian (403)', boardByProktor.status === 403, `status=${boardByProktor.status}`);
  check('proktor ditolak hasil (403)', (await call(`/sessions/${sessionId}/results`, { token: proktor })).status === 403);
  check('siswa ditolak papan penilaian (403)', (await call(`/sessions/${sessionId}/grading`, { token: tokenA })).status === 403);
  check('siswa ditolak hasil sesi (403)', (await call(`/sessions/${sessionId}/results`, { token: tokenA })).status === 403);
  check('siswa ditolak analisis butir (403)', (await call(`/sessions/${sessionId}/item-analysis`, { token: tokenA })).status === 403);
  check('anonim ditolak papan penilaian (401)', (await call(`/sessions/${sessionId}/grading`)).status === 401);
  check('anonim ditolak nilai ulang (401)', (await call(`/sessions/${sessionId}/grade`, { method: 'POST' })).status === 401);

  const un = await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru, body: { published: false } });
  check('hasil bisa ditarik kembali', un.status < 300 && un.json?.resultsPublished === false, `${un.status}`);
  check('setelah ditarik, endpoint hasil siswa tetap 404', (await call(`/attempts/${attempts.A}/result`, { token: tokenA })).status === 404);

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
