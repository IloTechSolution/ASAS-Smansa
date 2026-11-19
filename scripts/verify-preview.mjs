// Verifikasi fitur "Pratinjau Ujian" — GET /exams/:id/preview (kunci + statistik).
// Jalankan: node scripts/verify-preview.mjs
// Keamanan yang dikunci: anon 401 · SISWA/PROKTOR 403 · GURU boleh (ujian buatan ADMIN) · admin 200.
const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';

let pass = 0;
let fail = 0;
function check(name, cond, info = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
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
  if (r.status >= 300) throw new Error(`Login ${role} gagal: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.accessToken;
};

const TS = Date.now();
let admin = null;
let examId = null;
const questionIds = [];

try {
  admin = await login('admin', 'admin', 'Admin123!');

  const mapelRes = await call('/mapel', { token: admin });
  const mapelList = Array.isArray(mapelRes.json) ? mapelRes.json : mapelRes.json?.data;
  const mapelId = Array.isArray(mapelList) && mapelList.length > 0 ? mapelList[0].id : null;
  check('tersedia minimal satu mapel di DB dev', !!mapelId);

  const q1 = await call('/questions', {
    method: 'POST',
    body: {
      type: 'PG',
      content: `Pratinjau uji ${TS} — ibu kota Indonesia?`,
      weight: 2,
      scoringMode: 'ALL_OR_NOTHING',
      explanation: 'Jakarta adalah ibu kota Indonesia.',
      choices: [
        { id: 'a', label: 'Jakarta' },
        { id: 'b', label: 'Surabaya' },
      ],
      correctChoices: ['a'],
    },
    token: admin,
  });
  check('buat soal PG', q1.status < 300, JSON.stringify(q1.json));
  if (q1.json?.id) questionIds.push(q1.json.id);

  const q2 = await call('/questions', {
    method: 'POST',
    body: {
      type: 'ISIAN_SINGKAT',
      content: `Pratinjau uji ${TS} — 2 + 2 = ?`,
      weight: 1,
      scoringMode: 'ALL_OR_NOTHING',
      acceptedAnswers: ['4'],
    },
    token: admin,
  });
  check('buat soal ISIAN_SINGKAT', q2.status < 300, JSON.stringify(q2.json));
  if (q2.json?.id) questionIds.push(q2.json.id);

  const exam = await call('/exams', {
    method: 'POST',
    body: { title: `PRATINJAU-TMP-${TS}`, description: 'ujian uji pratinjau (hapus sendiri)', mapelId },
    token: admin,
  });
  check('buat ujian sementara', exam.status < 300, JSON.stringify(exam.json));
  examId = exam.json?.id ?? null;

  const setQ = await call(`/exams/${examId}/questions`, {
    method: 'PUT',
    body: { questionIds },
    token: admin,
  });
  check('susun 2 soal ke ujian', setQ.status < 300, JSON.stringify(setQ.json));

  // === akses & bentuk respons ===
  const anon = await call(`/exams/${examId}/preview`);
  check('anon → 401', anon.status === 401);

  const siswa = await login('siswa', '0051234567', 'Siswa123!');
  const siswaRes = await call(`/exams/${examId}/preview`, { token: siswa });
  check('SISWA → 403', siswaRes.status === 403);

  const proktor = await login('proktor', 'proktor', 'Proktor123!');
  const proktorRes = await call(`/exams/${examId}/preview`, { token: proktor });
  check('PROKTOR → 403', proktorRes.status === 403);

  const guru = await login('guru', 'guru', 'Guru123!');
  const guruRes = await call(`/exams/${examId}/preview`, { token: guru });
  check('GURU (ujian ADMIN dibagikan) → 200', guruRes.status === 200, String(guruRes.status));

  const res = await call(`/exams/${examId}/preview`, { token: admin });
  check('ADMIN → 200', res.status === 200, String(res.status));
  const p = res.json;
  check('totalWeight = 3', p?.totalWeight === 3, String(p?.totalWeight));
  check('sessions = 0 dan attempts = 0', p?.sessions === 0 && p?.attempts === 0);
  check('dua soal terurut', p?.questions?.length === 2 && p.questions[0].order === 1 && p.questions[1].order === 2);

  const pg = p?.questions?.[0];
  const isian = p?.questions?.[1];
  check('PG: kunci a isKey=true, b isKey=false',
    pg?.choices?.find((c) => c.id === 'a')?.isKey === true && pg?.choices?.find((c) => c.id === 'b')?.isKey === false);
  check('PG: pembahasan ikut tampil', typeof pg?.explanation === 'string' && pg.explanation.includes('Jakarta'));
  check('ISIAN_SINGKAT: acceptedAnswers ikut tampil', JSON.stringify(isian?.acceptedAnswers) === '["4"]');
  check('belum ada attempt → stats null', pg?.stats === null && isian?.stats === null);
  check('usageCount = 1 (ujian ini)', pg?.usageCount === 1 && isian?.usageCount === 1);
  check('total soal = 2', p?.questions?.length === 2);
} catch (err) {
  fail++;
  console.error('ERROR:', err);
} finally {
  // === cleanup: ujian dulu (beda dengan soal), lalu soal ===
  if (examId) {
    const del = await call(`/exams/${examId}`, { method: 'DELETE', token: admin ?? '' });
    console.log(`cleanup ujian → ${del.status}`);
  }
  for (const id of questionIds) {
    const del = await call(`/questions/${id}`, { method: 'DELETE', token: admin ?? '' });
    console.log(`cleanup soal ${id} → ${del.status}`);
  }
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
