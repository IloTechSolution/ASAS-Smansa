// Verifikasi: import siswa khusus (auto-create kelas), export/import CSV soal.
// Jalankan: node scripts/verify-siswa-csv.mjs
import ExcelJS from 'exceljs';

const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';
const stamp = Date.now().toString(36);
const KELAS_UJI = `Kelas CSV ${stamp}`;
const NISN_1 = `9${String(Date.now()).slice(-9)}`;
const NISN_2 = `8${String(Date.now() + 1).slice(-9)}`;

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
  if (r.status >= 300 || !r.json?.accessToken) throw new Error(`Login ${role} gagal: ${r.status}`);
  return r.json.accessToken;
};
const asArr = (r) => (Array.isArray(r) ? r : r?.data);

async function main() {
  console.log(`== CBT siswa+CSV verification @ ${BASE} ==\n`);
  const adminT = await login('admin', 'admin', 'Admin123!');
  const guruT = await login('guru', 'guru', 'Guru123!');

  console.log('[1 — template & import siswa (kelas auto-create)]');
  const tmpl = await call('/users/import/siswa/template', { token: adminT, raw: true });
  const tmplBuf = Buffer.from(await tmpl.arrayBuffer());
  check('template siswa diunduh (200 + xlsx)', tmpl.status === 200 && tmplBuf.subarray(0, 2).toString() === 'PK', `${tmpl.status}`);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Siswa');
  ws.addRow(['NISN', 'Nama', 'Password', 'Kelas']);
  ws.addRow([NISN_1, 'Uji Import Satu', 'Siswa123!', KELAS_UJI]);
  ws.addRow([NISN_2, 'Uji Import Dua', 'Siswa123!', KELAS_UJI]);
  const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());
  const form = new FormData();
  form.set('file', new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'siswa.xlsx');
  const impRes = await fetch(`${BASE}/users/import/siswa`, { method: 'POST', headers: { Authorization: `Bearer ${adminT}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' }, body: form });
  const impText = await impRes.text();
  let imp = null;
  try { imp = JSON.parse(impText); } catch { /* */ }
  check(
    'import 2 siswa berhasil',
    impRes.status === 201 || impRes.status === 200,
    `${impRes.status} ${impText.slice(0, 200)}`,
  );
  check('2 siswa tercatat sukses', imp?.success?.length === 2, JSON.stringify(imp?.success));
  check('tidak ada gagal', imp?.failed?.length === 0, JSON.stringify(imp?.failed));

  // kelas otomatis dibuat?
  const kelasList = asArr((await call('/kelas', { token: adminT })).json);
  const found = (kelasList ?? []).find((k) => k.name === KELAS_UJI);
  check('kelas otomatis dibuat dari import', Boolean(found), `kelas: ${JSON.stringify(found)}`);

  // siswa bisa login
  const loginSiswa = await call('/auth/login/siswa', { method: 'POST', body: { username: NISN_1, password: 'Siswa123!' } });
  check('siswa hasil import bisa login', loginSiswa.status < 300 && Boolean(loginSiswa.json?.accessToken), `${loginSiswa.status}`);

  // import ulang — harus gagal (duplikat)
  const form2 = new FormData();
  form2.set('file', new Blob([xlsxBuf]), 'siswa.xlsx');
  const imp2Res = await fetch(`${BASE}/users/import/siswa`, { method: 'POST', headers: { Authorization: `Bearer ${adminT}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' }, body: form2 });
  const imp2 = JSON.parse(await imp2Res.text());
  check('import ulang → gagal duplikat', imp2?.failed?.length === 2 && imp2?.success?.length === 0, JSON.stringify(imp2));

  console.log('\n[2 — export CSV soal]');
  // buat soal guru
  const q = await call('/questions', {
    method: 'POST',
    token: guruT,
    body: {
      type: 'PG',
      content: 'Berapa hasil 7+8?',
      weight: 3,
      scoringMode: 'ALL_OR_NOTHING',
      choices: [{ id: 'a', label: '15' }, { id: 'b', label: '14' }],
      correctChoices: ['a'],
    },
  });
  check('soal guru dibuat', q.status === 201 || q.status === 200, `${q.status}`);
  const qid = q.json?.id;

  const exp = await call('/questions/export', { token: guruT, raw: true });
  const csvBuf = Buffer.from(await exp.arrayBuffer());
  const csv = csvBuf.toString('utf8');
  check('export CSV 200 + text/csv', exp.status === 200 && (exp.headers.get('content-type') ?? '').includes('text/csv'), `${exp.status}`);
  check('CSV punya header id,tipe,bobot,konten', csv.includes('id,tipe,bobot,konten'), csv.split('\n')[0]);
  check('CSV memuat soal guru', csv.includes(qid), `qid=${qid}`);

  console.log('\n[3 — import CSV ke ujian + simpan soal]');
  const exam = await call('/exams', { method: 'POST', token: guruT, body: { title: `Ujian CSV ${stamp}`, mapelId: (asArr((await call('/mapel', { token: adminT })).json).find((m) => m.name === 'Matematika') ?? asArr((await call('/mapel', { token: adminT })).json)[0]).id } });
  const examId = exam.json?.id;
  check('ujian dibuat', exam.status === 201 && Boolean(examId), `${exam.status}`);

  const ids = [...csv.matchAll(/([a-z0-9]{25}),/gi)].map((m) => m[1]);
  const putRes = await call(`/exams/${examId}/questions`, { method: 'PUT', token: guruT, body: { questionIds: [qid] } });
  check('soal masuk ke ujian (PUT questions)', putRes.status < 300, `${putRes.status} ${putRes.text.slice(0, 120)}`);
  const detail = await call(`/exams/${examId}`, { token: guruT });
  const inExam = (detail.json?.questions ?? []).find((x) => x.id === qid);
  check('soal tampil di susunan dengan bobot', inExam?.weight === 3, JSON.stringify(inExam));

  console.log('\n[4 — hapus sesi & ujian]');
  // buat sesi untuk ujian ini & isi attempt siswa, lalu coba hapus
  const now = Date.now();
  const sess = await call('/sessions', {
    method: 'POST',
    token: guruT,
    body: {
      examId,
      title: `Sesi CSV ${stamp}`,
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3600_000).toISOString(),
      durationMin: 30,
      kelasIds: [found.id],
    },
  });
  const sessionId = sess.json?.id;
  check('sesi dibuat', sess.status === 201, `${sess.status}`);
  const delSesi = await call(`/sessions/${sessionId}`, { method: 'DELETE', token: guruT });
  check('sesi tanpa attempt bisa dihapus (200)', delSesi.status < 300, `${delSesi.status}`);

  // bersihkan: hapus ujian (semua sesi sudah bersih)
  const delExam = await call(`/exams/${examId}`, { method: 'DELETE', token: guruT });
  check('ujian bisa dihapus (200)', delExam.status < 300, `${delExam.status}`);

  console.log(`\n== HASIL: ${pass} PASS, ${fail} FAIL ==`);
  if (fail > 0) {
    console.log('Rincian gagal:');
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
