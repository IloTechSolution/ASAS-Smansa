// Verifikasi fitur enrol + visibilitas ujian admin + pelanggaran + absensi PDF
// + pengaturan pelaksanaan proktor + penghapusan readiness.
// Jalankan: node scripts/verify-enroll.mjs
const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';
const stamp = Date.now().toString(36);

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
  return r.json;
};
const asArr = (r) => (Array.isArray(r) ? r : r?.data);

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

async function ensureGuru(admin, name) {
  const u = `upgu${Date.now().toString(36)}`;
  const created = await call('/users', {
    method: 'POST',
    token: admin,
    body: { username: u, password: 'Guru123!', name, role: 'GURU' },
  });
  if (created.status >= 300) throw new Error(`ensure guru gagal: ${created.status}`);
  return { creds: await login('guru', u, 'Guru123!'), id: created.json.id, username: u };
}

async function main() {
  console.log(`== CBT enroll verification @ ${BASE} ==\n`);

  const adminT = (await login('admin', 'admin', 'Admin123!')).accessToken;
  const guruT = (await login('guru', 'guru', 'Guru123!')).accessToken;
  const proktorT = (await login('proktor', 'proktor', 'Proktor123!')).accessToken;
  const guru2 = await ensureGuru(adminT, `Upgrade Guru ${stamp}`);
  const guru2T = guru2.creds.accessToken;
  const seedRows = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: adminT })).json);
  const kelasId = seedRows.find((u) => u.username === '0051234567')?.kelasId ?? asArr((await call('/kelas', { token: adminT })).json)[0].id;
  const mapels = asArr((await call('/mapel', { token: adminT })).json);
  const mapelId = (mapels.find((m) => m.name === 'Matematika') ?? mapels[0]).id;
  const siswaA = await ensureSiswa(adminT, kelasId, `Enroll A ${stamp}`);
  const siswaB = await ensureSiswa(adminT, kelasId, `Enroll B ${stamp}`);
  const siswaC = await ensureSiswa(adminT, kelasId, `Enroll C ${stamp}`);
  console.log(`[setup] siswa A=${siswaA.username} B=${siswaB.username}\n`);

  /* ---------------- 1. Enrol API ---------------- */
  console.log('[1 — enrol: akses & replace set]');
  const exam1 = await call('/exams', { method: 'POST', token: guruT, body: { title: `Ujian Enroll ${stamp}`, mapelId } });
  const examId = exam1.json?.id;
  check('guru membuat ujian (201)', exam1.status < 300 && Boolean(examId), `status=${exam1.status}`);

  const enGuru2 = await call(`/exams/${examId}/enrollments`, { method: 'PUT', token: guru2T, body: { userIds: [siswaA.id] } });
  check('guru lain ditolak enrol ujian orang (403)', enGuru2.status === 403, `status=${enGuru2.status}`);
  const enSiswa = await call(`/exams/${examId}/enrollments`, { method: 'PUT', token: siswaA.creds.accessToken, body: { userIds: [siswaA.id] } });
  check('siswa ditolak enrol (403)', enSiswa.status === 403, `status=${enSiswa.status}`);
  const enBadUser = await call(`/exams/${examId}/enrollments`, { method: 'PUT', token: guruT, body: { userIds: [guru2.id] } });
  check('enrol non-siswa ditolak (400)', enBadUser.status === 400, `status=${enBadUser.status}`);
  const enA = await call(`/exams/${examId}/enrollments`, { method: 'PUT', token: guruT, body: { userIds: [siswaA.id] } });
  check('guru pemilik enrol 1 siswa (200)', enA.status === 200 && enA.json?.total === 1, `status=${enA.status} ${enA.text.slice(0, 120)}`);
  const enList = await call(`/exams/${examId}/enrollments`, { token: guruT });
  check('daftar enrol memuat siswa A', enList.json?.total === 1 && enList.json?.data?.[0]?.username === siswaA.username, `total=${enList.json?.total}`);
  const enAB = await call(`/exams/${examId}/enrollments`, { method: 'PUT', token: guruT, body: { userIds: [siswaA.id, siswaB.id] } });
  check('replace set enrol (A+B)', enAB.status === 200 && enAB.json?.total === 2, `total=${enAB.json?.total}`);
  const enBack = await call(`/exams/${examId}/enrollments`, { method: 'PUT', token: guruT, body: { userIds: [siswaA.id] } });
  check('kembalikan set enrol ke {A}', enBack.status === 200 && enBack.json?.total === 1, `total=${enBack.json?.total}`);
  const enCand = await call(`/exams/${examId}/candidates?search=${encodeURIComponent('Enroll')}&limit=10`, { token: guruT });
  check('kandidat menampilkan siswa enrol + flag', enCand.status === 200 && Array.isArray(enCand.json?.data) && enCand.json.data.some((c) => c.id === siswaA.id && c.enrolled === true), `status=${enCand.status}`);

  /* ---------------- 2. Visibilitas siswa ---------------- */
  console.log('\n[2 — enrol membatasi visibilitas ujian siswa]');
  const q = await call('/questions', {
    method: 'POST',
    token: guruT,
    body: { type: 'PG', content: `Soal enrol ${stamp}`, weight: 5, scoringMode: 'ALL_OR_NOTHING', choices: [{ id: 'a', label: 'x' }, { id: 'b', label: 'y' }], correctChoices: ['a'] },
  });
  await call(`/exams/${examId}/questions`, { method: 'PUT', token: guruT, body: { questionIds: [q.json.id] } });
  const now = Date.now();
  const sess = await call('/sessions', {
    method: 'POST',
    token: guruT,
    body: { examId, title: `Sesi Enroll ${stamp}`, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(), durationMin: 30, requireSeb: false, kelasIds: [kelasId], shuffleQuestions: false, shuffleOptions: false },
  });
  const sessionId = sess.json?.id;
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guruT, body: { status: 'SCHEDULED' } });
  await call(`/sessions/${sessionId}/status`, { method: 'PATCH', token: guruT, body: { status: 'ACTIVE' } });
  const rel = await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktorT, body: {} });

  const availA = await call('/attempts/available', { token: siswaA.creds.accessToken });
  check('siswa terdaftar melihat sesi di daftar ujian', (availA.json?.data ?? []).some((s) => s.id === sessionId), `count=${availA.json?.data?.length}`);
  const availB = await call('/attempts/available', { token: siswaC.creds.accessToken });
  check('siswa NON-terdaftar TIDAK melihat sesi', !(availB.json?.data ?? []).some((s) => s.id === sessionId), `count=${availB.json?.data?.length}`);
  const startB = await call('/attempts/start', { method: 'POST', token: siswaC.creds.accessToken, body: { sessionId, token: rel.json.token } });
  check('siswa NON-terdaftar ditolak start (403)', startB.status === 403, `status=${startB.status} ${startB.text.slice(0, 120)}`);
  const startA = await call('/attempts/start', { method: 'POST', token: siswaA.creds.accessToken, body: { sessionId, token: rel.json.token } });
  check('siswa terdaftar bisa start (201)', startA.status < 300 && Boolean(startA.json?.attempt?.id ?? startA.json?.id), `status=${startA.status} ${startA.text.slice(0, 120)}`);

  /* ---------------- 3. Ujian admin terlihat semua guru ---------------- */
  console.log('\n[3 — ujian buatan ADMIN muncul untuk semua guru]');
  const examAdmin = await call('/exams', { method: 'POST', token: adminT, body: { title: `Ujian Sekolah ${stamp}`, mapelId } });
  const examAdminId = examAdmin.json?.id;
  check('admin membuat ujian (201)', examAdmin.status === 201 && Boolean(examAdminId), `status=${examAdmin.status}`);
  const listGuru2 = await call(`/exams?search=${encodeURIComponent('Ujian Sekolah')}`, { token: guru2T });
  check('guru lain melihat ujian admin di daftar', (asArr(listGuru2.json) ?? []).some((e) => e.id === examAdminId), `status=${listGuru2.status}`);
  const detailGuru2 = await call(`/exams/${examAdminId}`, { token: guru2T });
  check('guru lain boleh buka detail ujian admin', detailGuru2.status === 200, `status=${detailGuru2.status}`);
  const writeGuru2 = await call(`/exams/${examAdminId}/questions`, { method: 'PUT', token: guru2T, body: { questionIds: [] } });
  check('guru lain TIDAK boleh susun soal ujian admin (4xx)', writeGuru2.status >= 400 && writeGuru2.status < 500, `status=${writeGuru2.status}`);
  const enrollGuru2 = await call(`/exams/${examAdminId}/enrollments`, { method: 'PUT', token: guru2T, body: { userIds: [siswaA.id] } });
  check('guru lain boleh enrol ujian admin', enrollGuru2.status === 200, `status=${enrollGuru2.status}`);
  const sessGuru2 = await call('/sessions', {
    method: 'POST',
    token: guru2T,
    body: { examId: examAdminId, title: `Sesi Admin Guru ${stamp}`, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 600_000).toISOString(), durationMin: 10, kelasIds: [kelasId] },
  });
  check('guru lain boleh membuat sesi untuk ujian admin', sessGuru2.status === 201, `status=${sessGuru2.status} ${sessGuru2.text.slice(0, 160)}`);
  const gradingGuru2 = await call(`/sessions/${sessGuru2.json?.id}/grading`, { token: guru2T });
  check('guru lain boleh buka papan penilaian sesi ujian admin', gradingGuru2.status === 200, `status=${gradingGuru2.status}`);

  /* ---------------- 4. Monitoring pelanggaran ---------------- */
  console.log('\n[4 — monitoring pelanggaran (PROKTOR/ADMIN)]');
  const integProktor = await call('/integrity', { token: proktorT });
  check('PROKTOR boleh GET /integrity', integProktor.status === 200 && typeof integProktor.json?.count === 'number', `status=${integProktor.status}`);
  check('GURU ditolak /integrity (403)', (await call('/integrity', { token: guruT })).status === 403);
  check('SISWA ditolak /integrity (403)', (await call('/integrity', { token: siswaA.creds.accessToken })).status === 403);

  /* ---------------- 5. Absensi PDF ---------------- */
  console.log('\n[5 — absensi PDF]');
  const pdfGuru = await call(`/sessions/${sessionId}/export/absensi/pdf`, { token: guruT, raw: true });
  const pdfBuf = Buffer.from(await pdfGuru.arrayBuffer());
  check(
    'guru pemilik boleh unduh absensi PDF (200 + application/pdf)',
    pdfGuru.status === 200 && (pdfGuru.headers.get('content-type') ?? '').includes('application/pdf') && pdfBuf.length > 400,
    `status=${pdfGuru.status} type=${pdfGuru.headers.get('content-type')} bytes=${pdfBuf.length}`,
  );
  const pdfGuru2 = await call(`/sessions/${sessionId}/export/absensi/pdf`, { token: guru2T, raw: true });
  check('guru lain ditolak absensi PDF (403)', pdfGuru2.status === 403, `status=${pdfGuru2.status}`);
  const pdfProktor = await call(`/sessions/${sessionId}/export/absensi/pdf`, { token: proktorT, raw: true });
  check('proktor boleh unduh absensi PDF (200)', pdfProktor.status === 200, `status=${pdfProktor.status}`);
  const pdfSiswa = await call(`/sessions/${sessionId}/export/absensi/pdf`, { token: siswaA.creds.accessToken, raw: true });
  check('siswa ditolak absensi PDF (403)', pdfSiswa.status === 403, `status=${pdfSiswa.status}`);

  /* ---------------- 6. Kartu peserta UNIVERSAL ---------------- */
  console.log('\n[6 — kartu peserta universal (PROKTOR/ADMIN only)]');
  const kartuCount = await call('/kartu/count', { token: proktorT });
  check('PROKTOR GET /kartu/count → 200', kartuCount.status === 200 && typeof kartuCount.json?.total === 'number', `status=${kartuCount.status}`);
  const kartuPdfProktor = await call('/kartu/pdf', { token: proktorT, raw: true });
  check('PROKTOR GET /kartu/pdf → 200 PDF', kartuPdfProktor.status === 200 && (kartuPdfProktor.headers.get('content-type') ?? '').includes('application/pdf'), `status=${kartuPdfProktor.status}`);
  check('GURU ditolak /kartu/pdf (403)', (await call('/kartu/pdf', { token: guruT })).status === 403);
  check('GURU ditolak /kartu/count (403)', (await call('/kartu/count', { token: guruT })).status === 403);

  /* ---------------- 7. Readiness dihapus ---------------- */
  console.log('\n[7 — readiness (checklist lab) dihapus]');
  check('GET readiness → 404', (await call(`/sessions/${sessionId}/readiness`, { token: proktorT })).status === 404);
  check('PUT readiness → 404', (await call(`/sessions/${sessionId}/readiness`, { method: 'PUT', token: proktorT, body: { items: [{ key: 'X', label: 'X', checked: true }] } })).status === 404);

  /* ---------------- 8. Proktor pengaturan pelaksanaan ---------------- */
  console.log('\n[8 — proktor boleh ubah pengaturan sesi]');
  const patchProktor = await call(`/sessions/${sessGuru2.json?.id}`, { method: 'PATCH', token: proktorT, body: { durationMin: 45 } });
  check('PROKTOR boleh PATCH sesi DRAFT milik ujian admin (pengaturan pelaksanaan)', patchProktor.status === 200 && patchProktor.json?.durationMin === 45, `status=${patchProktor.status} ${patchProktor.text.slice(0, 120)}`);
  const kelasProktor = await call(`/sessions/${sessGuru2.json?.id}/kelas`, { method: 'PUT', token: proktorT, body: { kelasIds: [kelasId] } });
  check('PROKTOR boleh PUT kelas sesi', kelasProktor.status === 200, `status=${kelasProktor.status}`);

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
