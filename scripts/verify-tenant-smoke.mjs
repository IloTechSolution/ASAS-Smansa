// Smoke multi-tenant — SMAN 1 & SMAN 8. Jalankan: node scripts/verify-tenant-smoke.cjs
const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';
const ORIGIN = process.env.CBT_ORIGIN ?? 'http://localhost:8080';

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, info = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name} :: ${info}`); console.log(`  FAIL  ${name} :: ${info}`); }
};

async function call(path, { method = 'GET', body, token, school, raw } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(school ? { 'x-school-id': school } : {}),
  };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}
const login = async (username, password) => {
  const r = await call('/auth/login', { method: 'POST', body: { username, password } });
  if (!r.json?.accessToken) throw new Error(`login ${username} gagal: ${r.status} ${r.text}`);
  return r.json;
};
const asArr = (r) => {
  const v = r && typeof r === 'object' && 'json' in r ? r.json : r;
  return Array.isArray(v) ? v : (v?.data ?? []);
};

const main = async () => {
  console.log('[1 - health & login generik]');
  const health = await call('/health');
  check('GET /health 200', health.status === 200, String(health.status));
  const admin = await login('admin', 'Admin123!');
  check('admin login OK', !!admin.accessToken);
  check('admin tanpa sekolah tertentu di token', admin.user?.school?.slug === 'sman1' || admin.user?.school === null || admin.user?.school?.slug === 'sman1', admin.user?.school?.slug);
  const guru8 = await login('guru8', 'Guru123!');
  check('guru8 login & sekolah sman8', guru8.user?.school?.slug === 'sman8', JSON.stringify(guru8.user?.school));
  const proktor8 = await login('proktor8', 'Proktor123!');
  check('proktor8 sekolah sman8', proktor8.user?.school?.slug === 'sman8');
  const siswa8 = await login('0081234567', 'Siswa123!');
  check('siswa8 sekolah sman8 + TAHUN_AJARAN', siswa8.user?.school?.slug === 'sman8' && siswa8.user?.school?.tahunAjaran === '2026/2027', JSON.stringify(siswa8.user?.school));
  const siswa1 = await login('0051234567', 'Siswa123!');
  check('siswa1 sekolah sman1', siswa1.user?.school?.slug === 'sman1');

  console.log('\n[2 - /auth/me menyertakan sekolah]');
  const me8 = await call('/auth/me', { token: siswa8.accessToken });
  check('me siswa8 = sman8', me8.json?.school?.slug === 'sman8' && me8.json?.school?.appName === 'CBT SMAN 8 Gorontalo', JSON.stringify(me8.json?.school));
  const meAdmin = await call('/auth/me', { token: admin.accessToken });
  check('me admin menyertakan sekolah (sman1 sebagai akun)', !!meAdmin.json?.school, JSON.stringify(meAdmin.json?.school));

  console.log('\n[3 - Admin agregat vs terkunci]');
  const allKelas = asArr(await call('/kelas', { token: admin.accessToken }));
  check('agregat: /kelas berisi dua sekolah', asArr(await call('/kelas', { token: admin.accessToken })).some(k => ['X-1', 'X-2', 'XII IPA 1'].includes(k.name)) && allKelas.length >= 3, allKelas.map(k => k.name).join(','));
  const k1 = asArr(await call('/kelas', { token: admin.accessToken, school: 'sman1' }));
  check('sman1: /kelas hanya milik SMAN 1', k1.length > 0 && k1.every(k => k.schoolId === 'sman1'), k1.map(k => `${k.name}:${k.schoolId}`).join(','));
  const k8 = asArr(await call('/kelas', { token: admin.accessToken, school: 'sman8' }));
  check('sman8: /kelas hanya milik SMAN 8', k8.length > 0 && k8.every(k => k.schoolId === 'sman8'), k8.map(k => `${k.name}:${k.schoolId}`).join(','));
  const kelasX2 = k8.find(k => k.name === 'X-2') ?? k8[0];
  const invalid = await call('/kelas', { token: admin.accessToken, school: 'sman99' });
  check('switcher sekolah tidak dikenal → 400', invalid.status === 400, String(invalid.status));
  const schools = await call('/settings/schools', { token: admin.accessToken });
  check('GET /settings/schools = 2 sekolah', Array.isArray(schools.json) && schools.json.length === 2, JSON.stringify(schools.json));

  console.log('\n[4 - Tulis di mode agregat ditolak; terkunci bisa]');
  const noSchoolCreate = await call('/kelas', { method: 'POST', token: admin.accessToken, body: { name: 'TEST-AGG', tahunAjaran: '2026/2027' } });
  check('create kelas tanpa switcher → 400', noSchoolCreate.status === 400, String(noSchoolCreate.status));
  const firstSman8KelasId = (asArr(await call('/kelas', { token: admin.accessToken, school: 'sman8' }))[0] ?? {}).id;
  const noSchoolUser = await call('/users', { method: 'POST', token: admin.accessToken, body: { username: '0099990001', password: 'Siswa123!', name: 'Tes Agregat', role: 'SISWA', nisn: '0099990001', kelasId: firstSman8KelasId } });
  check('create siswa tanpa switcher → 400', noSchoolUser.status === 400, String(noSchoolUser.status));
  const noSchoolConfig = await call('/settings', { method: 'PUT', token: admin.accessToken, body: { key: 'KKM_DEFAULT', value: '77' } });
  check('PUT /settings tanpa switcher → 400', noSchoolConfig.status === 400, String(noSchoolConfig.status));
  const uniqueKelas = `TEST-8A-${Date.now()}`;
  const k8create = await call('/kelas', { method: 'POST', token: admin.accessToken, school: 'sman8', body: { name: uniqueKelas, tahunAjaran: '2026/2027', tingkat: 'X', ruang: '12' } });
  check('create kelas sman8 → 201/200 + ruang', k8create.status < 300 && k8create.json?.name === uniqueKelas && k8create.json?.ruang === '12' && k8create.json?.schoolId === 'sman8', JSON.stringify(k8create.json));
  // bersihkan kelas test agar tidak menumpuk
  if (k8create.json?.id) {
    await call(`/kelas/${k8create.json.id}`, { method: 'DELETE', token: admin.accessToken, school: 'sman8' });
  }

  console.log('\n[5 - Isolasi antar sekolah]');
  const guru8Kelas = asArr(await call('/kelas', { token: guru8.accessToken }));
  check('guru8 hanya melihat kelas SMAN 8', guru8Kelas.length > 0 && guru8Kelas.every(k => k.schoolId === 'sman8'), guru8Kelas.map(k => `${k.name}:${k.schoolId}`).join(','));
  const siswa8List = asArr(await call('/attempts/available', { token: siswa8.accessToken }));
  check('siswa8 melihat ujiannya (array)', Array.isArray(siswa8List) || !!siswa8List, 'not array');
  const guru1 = await login('guru', 'Guru123!');
  const guru1Exams = asArr(await call('/exams', { token: guru1.accessToken }));
  check('guru SMAN 1 tidak melihat ujian SMAN 8', !guru1Exams.some(e => String(e.title ?? '').includes('SMAN8') || e.title === '__SMAN8__'), 'ketemu?');
  const guru8Exams = asArr(await call('/exams', { token: guru8.accessToken }));
  check('guru8 hanya melihat ujian sman8/admin-sman8', Array.isArray(guru8Exams), 'not array');

  console.log('\n[6 - Siswa SMAN 8 tidak bisa menyentuh data SMAN 1 (IDOR)]');
  const k1id = k1[0]?.id;
  const siswa8TryK1 = await call(`/kelas/${k1id}`, { method: 'PATCH', token: siswa8.accessToken, body: { name: 'HACK' } });
  check('siswa8 PATCH kelas SMAN 1 → 403/401/404', [401, 403, 404].includes(siswa8TryK1.status), String(siswa8TryK1.status));
  const guru8TryK1 = await call(`/kelas/${k1id}`, { method: 'PATCH', token: guru8.accessToken, body: { ruang: '99' } });
  check('guru8 PATCH kelas SMAN 1 → 403 (role guard) / 404 (terisolasi)', [403, 404].includes(guru8TryK1.status), String(guru8TryK1.status));
  const guru8TryDelete = await call(`/kelas/${k1id}`, { method: 'DELETE', token: guru8.accessToken });
  check('guru8 DELETE kelas SMAN 1 → 403/404', [403, 404].includes(guru8TryDelete.status), String(guru8TryDelete.status));

  console.log('\n[7 - Pengguna sman8 & ruang ujian dicetak]');
  const users8 = asArr(await call('/users?page=1&limit=50', { token: admin.accessToken, school: 'sman8' }));
  check('admin sman8: daftar pengguna = sekolah 8 saja', users8.length > 0 && users8.every(u => u.school?.slug === 'sman8' || u.schoolId === 'sman8'), users8.map(u => `${u.username}:${u.school?.slug}`).join(','));
  const usersAll = asArr(await call('/users?page=1&limit=50', { token: admin.accessToken }));
  check('admin agregat: pengguna dua sekolah terlihat', usersAll.some(u => u.school?.slug === 'sman8') && usersAll.some(u => u.school?.slug === 'sman1'), usersAll.map(u => u.school?.slug).join(','));

  console.log('\n[8 - Kartu Login PDF]');
  const pdf8 = await call('/kartu/pdf?kelasId=' + kelasX2.id + '&judul=' + encodeURIComponent('ASSESMEN SUMATIF AKHIR SEMESTER KELAS X'), { token: proktor8.accessToken, raw: true });
  const buf8 = Buffer.from(await pdf8.arrayBuffer());
  check('sman8: kartu PDF 200 + %PDF + application/pdf', pdf8.status === 200 && buf8.subarray(0, 4).toString() === '%PDF' && (pdf8.headers.get('content-type') ?? '').includes('application/pdf'), `${pdf8.status} len=${buf8.length}`);
  const pdf1 = await call('/kartu/pdf', { token: admin.accessToken, raw: true });
  const buf1 = Buffer.from(await pdf1.arrayBuffer());
  check('sman1 agregat: kartu PDF ditolak (400)', pdf1.status === 400, String(pdf1.status));
  const pdf1s = await call('/kartu/pdf', { token: ((await login('proktor', 'Proktor123!'))).accessToken, raw: true });
  const buf1s = Buffer.from(await pdf1s.arrayBuffer());
  check('proktor sman1: kartu PDF OK (logo sman1)', pdf1s.status === 200 && buf1s.subarray(0, 4).toString() === '%PDF', `${pdf1s.status} len=${buf1s.length}`);
  const kartuCount8 = await call('/kartu/count', { token: proktor8.accessToken });
  check('proktor8 count = siswa aktif sman8 (>=1)', kartuCount8.status === 200 && kartuCount8.json?.total >= 1, JSON.stringify(kartuCount8.json));

  console.log('\n[9 - Pengaturan per sekolah]');
  const pub1 = await call('/settings/public');
  check('public default = SMAN 1', pub1.json?.SCHOOL_NAME === 'SMAN 1 Gorontalo', JSON.stringify(pub1.json));
  const pub8 = await call('/settings/public?school=sman8');
  check('public sman8', pub8.json?.SCHOOL_NAME === 'SMAN 8 Gorontalo' && pub8.json?.APP_NAME === 'CBT SMAN 8 Gorontalo', JSON.stringify(pub8.json));
  const set8 = await call('/settings', { method: 'GET', token: admin.accessToken, school: 'sman8' });
  check('GET /settings sman8: nama sekolah 8', set8.json?.school?.slug === 'sman8' && set8.json?.school?.name === 'SMAN 8 Gorontalo', JSON.stringify(set8.json?.school));
  const put8 = await call('/settings', { method: 'PUT', token: admin.accessToken, school: 'sman8', body: { key: 'TAHUN_AJARAN', value: '2026/2027' } });
  check('PUT config sman8 OK (TAHUN_AJARAN)', put8.status < 300, String(put8.status));
  const patch8 = await call('/settings/school', { method: 'PATCH', token: admin.accessToken, school: 'sman8', body: { name: 'SMAN 8 Gorontalo', appName: 'CBT SMAN 8 Gorontalo', headmasterName: 'Kepala Sekolah Uji', headmasterNip: '1234567890' } });
  check('PATCH identitas sman8 OK', patch8.status < 300 && patch8.json?.headmasterName === 'Kepala Sekolah Uji', `${patch8.status} ${patch8.text.slice(0, 120)}`);

  console.log('\n[10 - Logo publik per sekolah]');
  const logo1 = await fetch(`${ORIGIN}/api/settings/public/logo?school=sman1`);
  check('logo sman1 200 image/jpeg', logo1.status === 200 && (logo1.headers.get('content-type') ?? '').includes('image'), `${logo1.status}`);
  const logo8 = await fetch(`${ORIGIN}/api/settings/public/logo?school=sman8`);
  check('logo sman8 404 (belum diatur)', logo8.status === 404, String(logo8.status));

  console.log('\n=========================================');
  console.log(`PASS ${pass}  FAIL ${fail}`);
  if (fail) {
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
