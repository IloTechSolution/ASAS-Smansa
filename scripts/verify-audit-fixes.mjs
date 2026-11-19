// Audit run 5 — verifikasi fix: (1) guru pemilik kendali + guru lain 403; (2) signed URL di PATCH + opsi gambar
const BASE = 'http://localhost:8080/api';
async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, text };
}
const login = async (role, u, p) => (await call(`/auth/login/${role}`, { method: 'POST', body: { username: u, password: p } })).json.accessToken;
const asArr = (r) => (Array.isArray(r) ? r : r.data);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+7E0WAAAAAElFTkSuQmCC', 'base64');
let pass = 0, fail = 0;
const check = (n, ok, info='') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${info ? ` :: ${info}` : ''}`); };

async function main() {
  const admin = await login('admin', 'admin', 'Admin123!');
  const guru = await login('guru', 'guru', 'Guru123!');
  const proktor = await login('proktor', 'proktor', 'Proktor123!');
  const siswa = await login('siswa', '0051234567', 'Siswa123!');
  // guru2
  const guru2u = 'guru2';
  let guru2;
  try { guru2 = await login('guru', guru2u, 'Guru123!'); } catch {
    await call('/users', { method: 'POST', token: admin, body: { username: guru2u, password: 'Guru123!', name: 'Guru Kedua', role: 'GURU' } });
    guru2 = await login('guru', guru2u, 'Guru123!');
  }
  const seed = asArr((await call('/users?role=SISWA&search=0051234567&limit=5', { token: admin })).json).find(u => u.username === '0051234567');
  const kelasId = seed.kelasId;
  const mapelId = asArr((await call('/mapel', { token: admin })).json)[0].id;

  const q = await call('/questions', { method: 'POST', token: guru, body: { type: 'PG', content: 'Fix kendali — 2+2?', weight: 1, scoringMode: 'ALL_OR_NOTHING', choices: [{ id: 'a', label: '4' }, { id: 'b', label: '5' }], correctChoices: ['a'] } });
  const exam = await call('/exams', { method: 'POST', token: guru, body: { title: 'Fix Kendali', mapelId } });
  const examId = exam.json.id;
  await call(`/exams/${examId}/questions`, { method: 'PUT', token: guru, body: { questionIds: [q.json.id] } });
  const now = Date.now();
  const sess = await call('/sessions', { method: 'POST', token: guru, body: { examId, title: 'Sesi Fix', startsAt: new Date(now - 30000).toISOString(), endsAt: new Date(now + 3600000).toISOString(), durationMin: 30, tokenIntervalSec: 300, requireSeb: false, shuffleQuestions: false, shuffleOptions: false, kelasIds: [kelasId] } });
  const sessionId = sess.json.id;
  await call(`/sessions/${sessionId}/status`, { token: guru, method: 'PATCH', body: { status: 'SCHEDULED' } });
  await call(`/sessions/${sessionId}/status`, { token: guru, method: 'PATCH', body: { status: 'ACTIVE' } });
  const rel = await call(`/sessions/${sessionId}/token/release`, { method: 'POST', token: proktor, body: {} });
  const start = await call('/attempts/start', { method: 'POST', token: siswa, body: { sessionId, token: rel.json.token } });
  const attemptId = start.json?.attempt?.id;

  console.log('[Fix 1 — guru pemilik kendali attempt]');
  check('guru pemilik warn 201', (await call(`/attempts/${attemptId}/warn`, { method: 'POST', token: guru, body: { message: 'Uji' } })).status === 201);
  check('guru pemilik extend 201', (await call(`/attempts/${attemptId}/extend`, { method: 'POST', token: guru, body: { minutes: 5 } })).status === 201);
  check('guru lain warn 403', (await call(`/attempts/${attemptId}/warn`, { method: 'POST', token: guru2, body: { message: 'Uji' } })).status === 403);
  check('guru lain extend 403', (await call(`/attempts/${attemptId}/extend`, { method: 'POST', token: guru2, body: { minutes: 5 } })).status === 403);
  check('guru lain force-submit 403', (await call(`/attempts/${attemptId}/force-submit`, { method: 'POST', token: guru2 })).status === 403);
  check('siswa warn sendiri ditolak 403', (await call(`/attempts/${attemptId}/warn`, { method: 'POST', token: siswa, body: { message: 'x' } })).status === 403);

  console.log('\n[Fix 2 — PATCH imageUrl signed + kanonikalisasi]');
  const qImg = await call('/questions', { method: 'POST', token: guru, body: { type: 'PG', content: 'Soal gambar fix', weight: 1, scoringMode: 'ALL_OR_NOTHING', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correctChoices: ['a'] } });
  const fd = new FormData(); fd.set('image', new Blob([PNG], { type: 'image/png' }), 'fix.png');
  const up = await fetch(`${BASE}/questions/${qImg.json.id}/image`, { method: 'POST', headers: { Authorization: `Bearer ${guru}` }, body: fd });
  const upJson = await up.json().catch(() => null);
  const imageUrl = upJson?.imageUrl;
  const sign = await call(`/uploads/sign?path=${encodeURIComponent(imageUrl)}`, { token: guru });
  const signed = sign.json?.url;
  console.log('  signed url:', (signed || '').slice(0, 80));
  const signedPath = (signed || '').replace(/^https?:\/\/[^/]+/, '');
  const patchSigned = await call(`/questions/${qImg.json.id}`, { method: 'PATCH', token: guru, body: { type: 'PG', content: 'Soal gambar fix', weight: 1, scoringMode: 'ALL_OR_NOTHING', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correctChoices: ['a'], imageUrl: signedPath } });
  check('PATCH imageUrl signed (query) tidak 400', patchSigned.status < 300, `${patchSigned.status}`);
  const detail = await call(`/questions/${qImg.json.id}`, { token: guru });
  check('DB tersimpan kanonis (tanpa ?)', (detail.json?.imageUrl || '') === imageUrl, detail.json?.imageUrl);

  // Opsi gambar: PATCH choices dengan imageUrl signed
  const patchChoice = await call(`/questions/${qImg.json.id}`, { method: 'PATCH', token: guru, body: { type: 'PG', content: 'Soal gambar fix', weight: 1, scoringMode: 'ALL_OR_NOTHING', choices: [{ id: 'a', label: 'A', imageUrl: signedPath }, { id: 'b', label: 'B' }], correctChoices: ['a'] } });
  check('PATCH opsi imageUrl signed diterima', patchChoice.status < 300, `${patchChoice.status}`);
  const detail2 = await call(`/questions/${qImg.json.id}`, { token: guru });
  const c0 = detail2.json?.choices?.[0]?.imageUrl;
  check('opsi tersimpan kanonis', c0 === imageUrl, JSON.stringify(c0));

  console.log('\n[Fix 3 — BA Digital dihapus — endpoint sertifikat hilang (404)]');
  const cert = await call(`/exams/${examId}/certificate?userId=${siswa ? seed.id : ''}`, { token: guru });
  console.log(`  GET certificate: ${cert.status}`);
  check('sertifikat → 404 (fitur dihapus)', cert.status === 404, `${cert.status}`);

  await call(`/sessions/${sessionId}`, { method: 'DELETE', token: admin }).catch(() => {});
  console.log(`\n== HASIL: ${pass} PASS, ${fail} FAIL ==`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
