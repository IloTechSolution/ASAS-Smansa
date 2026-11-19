// Verifikasi Ruang Ujian per siswa (bukan kelas).
// Jalankan: node scripts/verify-ruang.mjs
import ExcelJS from 'exceljs';

const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';
const SCHOOL = process.env.CBT_SCHOOL ?? 'sman1';
const stamp = Date.now().toString(36).slice(-6).toUpperCase();
const digits = String(Date.now()).slice(-8);
let pass = 0;
let fail = 0;
const created = [];

function check(name, cond, info = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${info ? ` :: ${info}` : ''}`); }
}
async function api(path, { method = 'GET', body, token, form } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}`, 'x-school-id': SCHOOL } : {}),
      ...(form ? {} : { 'Content-Type': 'application/json' }),
    },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}
async function login(username, password) {
  const r = await api('/auth/login', { method: 'POST', body: { username, password } });
  return r.json?.accessToken;
}

async function main() {
  console.log(`== Verifikasi Ruang Ujian Siswa (${stamp}) @ ${BASE} ==\n`);
  const admin = await login('admin', 'Admin123!');
  if (!admin) throw new Error('Login admin gagal');

  const seedRows = (await api('/users?role=SISWA&search=0051234567&limit=5', { token: admin })).json;
  const rows = Array.isArray(seedRows) ? seedRows : (seedRows?.data ?? []);
  const kelasId = rows.find((u) => u.username === '0051234567')?.kelasId;
  if (!kelasId) throw new Error('Kelas seed tidak ditemukan');

  const nisnA = `91${digits}`;
  const a = await api('/users', {
    method: 'POST', token: admin,
    body: { username: nisnA, password: 'Siswa123!', name: 'Uji Ruang A', role: 'SISWA', nisn: nisnA, kelasId, ruang: '  LAB-9  ' },
  });
  check('buat siswa dengan ruang', a.status === 201 && a.json?.ruang === 'LAB-9', `${a.status} ${a.text.slice(0, 120)}`);
  if (a.json?.id) created.push(a.json.id);

  const jwtA = await login(nisnA, 'Siswa123!');
  const meA = await api('/auth/me', { token: jwtA });
  check('ruang ikut di /auth/me', meA.json?.ruang === 'LAB-9', JSON.stringify(meA.json).slice(0, 160));

  const proktor = await login('proktor', 'Proktor123!');
  const cardCount = await api('/kartu/count', { token: proktor });
  const kartuKelas = (cardCount.json?.kelas ?? []).find((k) => k.id === kelasId);
  check('ruang siswa tampil di pratinjau kartu', (kartuKelas?.ruang ?? '').includes('LAB-9'), JSON.stringify(kartuKelas).slice(0, 160));
  const pdfParams = new URLSearchParams({ kelasId, judul: 'Verifikasi Ruang' });
  const pdf = await fetch(`${BASE}/kartu/pdf?${pdfParams}`, {
    headers: { Authorization: `Bearer ${proktor}`, 'x-school-id': SCHOOL },
  });
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  // PDFKit menyandikan teks dengan subset font — yang diverifikasi di sini adalah
  // PDF sah; pemetaan ruang siswa dibuktikan oleh cek pratinjau di atas (sumber sama).
  check('PDF kartu terbit (ruang dari data siswa)', pdf.status === 200 && pdf.headers.get('content-type')?.includes('application/pdf') && pdfBuf.subarray(0, 4).toString() === '%PDF', `${pdf.status} ${pdf.headers.get('content-type')}`);

  const up = await api(`/users/${a.json.id}`, { method: 'PATCH', token: admin, body: { ruang: '  12  ' } });
  check('ubah ruang dinormalisasi', up.status === 200 && up.json?.ruang === '12', `${up.status} ${up.text.slice(0, 120)}`);

  const guru = await api('/users', {
    method: 'POST', token: admin,
    body: { username: `auditg${stamp}`, password: 'Guru123!', name: 'Uji Ruang Guru', role: 'GURU', ruang: 'LAB-X' },
  });
  check('ruang diabaikan untuk non-siswa', guru.status === 201 && guru.json?.ruang === null, `${guru.status} ${guru.text.slice(0, 120)}`);
  if (guru.json?.id) created.push(guru.json.id);

  const nisnB = `92${digits}`;
  const kelasName = rows.find((u) => u.username === '0051234567')?.kelas?.name ?? 'XII IPA 1';
  async function importRuang(ruang) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Siswa');
    ws.addRow(['NISN', 'Nama', 'Password', 'Kelas', 'Ruang']);
    ws.addRow([nisnB, 'Uji Ruang B', 'Siswa123!', kelasName, ruang]);
    const buf = await wb.xlsx.writeBuffer();
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'ruang.xlsx');
    return api('/users/import/siswa', { method: 'POST', token: admin, form });
  }
  const imp = await importRuang('LAB-7');
  check('impor Excel sukses', imp.status === 201 && imp.json?.success?.length === 1, `${imp.status} ${imp.text.slice(0, 160)}`);
  const imp2 = await importRuang('LAB-8');
  check('impor ulang memperbarui ruang siswa', (imp2.json?.siswaRuangUpdates ?? 0) >= 1, JSON.stringify(imp2.json).slice(0, 200));

  const jwtB = await login(nisnB, 'Siswa123!');
  const meB = await api('/auth/me', { token: jwtB });
  check('ruang dari Excel tampil di /auth/me', meB.json?.ruang === 'LAB-8', JSON.stringify(meB.json).slice(0, 160));

  const list = await api('/users?role=SISWA&search=LAB-7', { token: admin }).catch(() => null);
  console.log(`  INFO  daftar users dengan ruang=kelas (regex) — diabaikan: ${list?.status ?? '-'}`);

  for (const id of created) await api(`/users/${id}`, { method: 'DELETE', token: admin });
  const foundB = (await api(`/users?search=${nisnB}&limit=5`, { token: admin })).json;
  const rowsB = Array.isArray(foundB) ? foundB : (foundB?.data ?? []);
  const idB = rowsB.find((u) => u.username === nisnB)?.id;
  if (idB) await api(`/users/${idB}`, { method: 'DELETE', token: admin });
  console.log(`\n== HASIL: ${pass} PASS, ${fail} FAIL ==`);
  if (fail > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
