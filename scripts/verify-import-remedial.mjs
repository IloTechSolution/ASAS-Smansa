// Audit run 6 — 2 fitur baru: Import soal Excel + Remedial/reset attempt
const BASE = 'http://localhost:8080/api';
async function call(path, { method = 'GET', body, token, raw } = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, text, ct: res.headers.get('content-type') };
}
const login = async (role, u, p) => (await call(`/auth/login/${role}`, { method: 'POST', body: { username: u, password: p } })).json.accessToken;
const asArr = (r) => (Array.isArray(r) ? r : r.data);
let pass = 0, fail = 0;
const check = (n, ok, info='') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${info ? ` :: ${info}` : ''}`); };

async function main() {
  const admin = await login('admin', 'admin', 'Admin123!');
  const guru = await login('guru', 'guru', 'Guru123!');
  const proktor = await login('proktor', 'proktor', 'Proktor123!');
  const siswa = await login('siswa', '0051234567', 'Siswa123!');
  const seed = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: admin })).json).find(u => u.username === '0051234567');
  const kelasId = seed.kelasId;
  const mapelId = asArr((await call('/mapel', { token: admin })).json)[0].id;

  console.log('[Template import soal]');
  const tmpl = await call('/questions/import/template', { token: guru });
  check('GET template xlsx 200 + zip', tmpl.status === 200 && (tmpl.ct || '').includes('sheet'), `${tmpl.status} ${tmpl.ct}`);
  const tmplSiswa = await call('/questions/import/template', { token: siswa });
  check('siswa ditolak template (403)', tmplSiswa.status === 403, `${tmplSiswa.status}`);

  console.log('[Import soal Excel — 5 tipe + baris rusak]');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Soal');
  [
    ['Tipe','Konten','Bobot','Mode Skor','Pembahasan','Opsi','Kunci','KunciIsian','Kiri','Kanan','Pernyataan'],
    // 2: PG valid
    ['PG','2+2=?',1,'ALL_OR_NOTHING','QA', 'A|3;B|4;C|5;D|6','B','','','',''],
    // 3: PG_KOMPLEKS valid
    ['PG_KOMPLEKS','Pilih genap',2,'PROPORSIONAL','QA', 'A|2;B|3;C|4;D|5','A,C','','','',''],
    // 4: MATCHING valid (Kolom: Kiri=idx7, Kanan=idx8) — KunciIsian kosong
    ['MATCHING','Jodohkan',1,'ALL_OR_NOTHING','QA', '', '','','Jawa Barat|Jawa Timur|Jawa Tengah','Bandung|Surabaya|Semarang',''],
    // 5: BENAR_SALAH valid (Pernyataan=idx10)
    ['BENAR_SALAH','Nilai pernyataan',1,'ALL_OR_NOTHING','QA', '', '','','','','Bumi bulat|B;Matahari kelilingi bumi|S'],
    // 6: ISIAN valid (KunciIsian=idx7)
    ['ISIAN_SINGKAT','Ibu kota Indonesia?',3,'ALL_OR_NOTHING','QA', '', '','Jakarta,Nusantara','','',''],
    // 7: PG tanpa kunci → gagal
    ['PG','Baris tanpa kunci',1,'ALL_OR_NOTHING','QA', 'A|1;B|2','','','','',''],
    // 8: tipe salah → gagal
    ['NGACO','Tipe salah',1,'ALL_OR_NOTHING','QA', '', '','','','','',''],
    // 9: konten kosong → gagal
    ['PG','',1,'ALL_OR_NOTHING','QA', 'A|1;B|2','A','','','',''],
  ].forEach((r) => ws.addRow(r));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const fd = new FormData();
  fd.set('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'soal.xlsx');
  const imp = await fetch(`${BASE}/questions/import`, { method: 'POST', headers: { Authorization: `Bearer ${guru}` }, body: fd });
  const impJson = await imp.json().catch(() => null);
  console.log('  import:', imp.status, JSON.stringify(impJson).slice(0, 400));
  check('import 200 total 8', imp.status < 300 && impJson?.total === 8, `${imp.status}`);
  check('5 berhasil', impJson?.success?.length === 5, `${impJson?.success?.length}`);
  check('3 gagal (tanpa kunci + tipe salah + konten kosong)', impJson?.failed?.length === 3, `${impJson?.failed?.length}`);

  // Verifikasi soal hasil import bisa dipakai — MATCHING dengan konten 'Jodohkan' dari file ini
  const list = await call('/questions?search=Jodohkan&limit=5', { token: guru });
  const m = asArr(list.json).find(q => q.type === 'MATCHING' && q.content === 'Jodohkan');
  check('soal MATCHING import (konten Jodohkan) ditemukan', Boolean(m), `${asArr(list.json).length} total; matched: ${m ? 'ya' : 'tidak'}`);
  if (m) {
    const det = await call(`/questions/${m.id}`, { token: guru });
    const pairs = det.json?.pairs ?? {};
    const leftTexts = (pairs.left || []).map(x => x.text);
    const rightTexts = (pairs.right || []).map(x => x.text);
    check('mapping 3 kiri→3 kanan urut', leftTexts.join('|') === 'Jawa Barat|Jawa Timur|Jawa Tengah' && rightTexts.join('|') === 'Bandung|Surabaya|Semarang', `${leftTexts.join('|')} :: ${rightTexts.join('|')}`);
  }

  console.log('[Import file salah]');
  const fd2 = new FormData();
  fd2.set('file', new Blob(['bukan excel'], { type: 'text/plain' }), 'jahat.txt');
  const upBad = await fetch(`${BASE}/questions/import`, { method: 'POST', headers: { Authorization: `Bearer ${guru}` }, body: fd2 });
  check('file .txt ditolak (400)', upBad.status === 400, `${upBad.status}`);
  const fd3 = new FormData();
  fd3.set('file', new Blob(['bukan excel'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'rusak.xlsx');
  const upRusak = await fetch(`${BASE}/questions/import`, { method: 'POST', headers: { Authorization: `Bearer ${guru}` }, body: fd3 });
  check('file rusak ditolak (400)', upRusak.status === 400, `${upRusak.status} ${(await upRusak.text()).slice(0,120)}`);

  console.log('[Remedial — guru reset attempt selesai → siswa start ulang]');
  const q = await call('/questions', { method: 'POST', token: guru, body: { type: 'PG', content: 'Remedial 2+2?', weight: 1, scoringMode: 'ALL_OR_NOTHING', choices: [{ id: 'a', label: '4' }, { id: 'b', label: '5' }], correctChoices: ['a'] } });
  const exam = await call('/exams', { method: 'POST', token: guru, body: { title: 'Uji Remedial', mapelId } });
  const examId = exam.json.id;
  await call(`/exams/${examId}/questions`, { method: 'PUT', token: guru, body: { questionIds: [q.json.id] } });
  const now = Date.now();
  const sess = await call('/sessions', { method: 'POST', token: guru, body: { examId, title: 'Sesi Remedial', startsAt: new Date(now - 30000).toISOString(), endsAt: new Date(now + 3600000).toISOString(), durationMin: 30, tokenIntervalSec: 300, requireSeb: false, shuffleQuestions: false, shuffleOptions: false, kelasIds: [kelasId] } });
  const sessionId = sess.json.id;
  await call(`/sessions/${sessionId}/status`, { token: guru, method: 'PATCH', body: { status: 'SCHEDULED' } });
  await call(`/sessions/${sessionId}/status`, { token: guru, method: 'PATCH', body: { status: 'ACTIVE' } });
  const rel = await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktor, body: {} });
  const start1 = await call('/attempts/start', { method: 'POST', token: siswa, body: { sessionId, token: rel.json.token } });
  const attemptId = start1.json?.attempt?.id;
  check('siswa start', start1.status < 300, `${start1.status}`);
  await call(`/attempts/${attemptId}/answers`, { method: 'PUT', token: siswa, body: { questionId: q.json.id, payload: 'b' } });
  await call(`/attempts/${attemptId}/integrity`, { method: 'POST', token: siswa, body: { type: 'TAB_SWITCH', detail: { n: 1 } } });
  await call(`/attempts/${attemptId}/submit`, { method: 'POST', token: siswa, body: { reason: 'MANUAL' } });

  // siswa coba reset sendiri → ditolak
  const resetSiswa = await call(`/attempts/${attemptId}/reset`, { method: 'POST', token: siswa, body: {} });
  check('siswa reset sendiri ditolak (403)', resetSiswa.status === 403, `${resetSiswa.status}`);

  // guru pemilik reset
  const resetGuru = await call(`/attempts/${attemptId}/reset`, { method: 'POST', token: guru, body: { reason: 'remedial' } });
  console.log('  reset guru:', resetGuru.status, JSON.stringify(resetGuru.json).slice(0, 220));
  check('guru pemilik reset 201', resetGuru.status < 300 && resetGuru.json?.deletedAnswers === 1, `${resetGuru.status}`);

  // siswa bisa start ulang dengan token baru
  const rel2 = await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktor, body: {} });
  const start2 = await call('/attempts/start', { method: 'POST', token: siswa, body: { sessionId, token: rel2.json.token } });
  check('siswa bisa start ulang setelah remedial', start2.status < 300, `${start2.status} ${start2.text.slice(0,120)}`);
  const attempt2 = start2.json?.attempt?.id;
  check('attempt baru (id berbeda)', attempt2 && attempt2 !== attemptId, `${attempt2} vs ${attemptId}`);

  // guru lain ditolak reset — login tidak melempar; cek token secara eksplisit
  const guru2u = 'guru2';
  let guru2 = await login('guru', guru2u, 'Guru123!');
  if (!guru2) {
    await call('/users', { method: 'POST', token: admin, body: { username: guru2u, password: 'Guru123!', name: 'Guru Kedua', role: 'GURU' } });
    guru2 = await login('guru', guru2u, 'Guru123!');
  }
  await call(`/attempts/${attempt2}/submit`, { method: 'POST', token: siswa, body: { reason: 'MANUAL' } });
  const resetLain = await call(`/attempts/${attempt2}/reset`, { method: 'POST', token: guru2, body: {} });
  check('guru lain reset ditolak (403)', resetLain.status === 403, `${resetLain.status}`);

  // publish lalu reset → 409
  await call(`/sessions/${sessionId}/status`, { token: guru, method: 'PATCH', body: { status: 'CLOSED' } });
  await call(`/sessions/${sessionId}/publish`, { method: 'POST', token: guru, body: { published: true } });
  const resetPublish = await call(`/attempts/${attempt2}/reset`, { method: 'POST', token: guru, body: {} });
  check('reset setelah publish ditolak (409)', resetPublish.status === 409, `${resetPublish.status} ${resetPublish.text.slice(0,120)}`);

  await call(`/sessions/${sessionId}`, { method: 'DELETE', token: admin }).catch(() => {});
  console.log(`\n== HASIL: ${pass} PASS, ${fail} FAIL ==`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
