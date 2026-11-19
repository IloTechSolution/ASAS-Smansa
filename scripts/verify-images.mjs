// Verifikasi gambar soal & gambar opsi + cleanup berkas (P4/refcount lintas JSON).
// Jalankan: node scripts/verify-images.mjs
const BASE = process.env.CBT_BASE ?? 'http://localhost:8080/api';
const ORIGIN = process.env.CBT_ORIGIN ?? 'http://localhost:8080';
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
  if (r.status >= 300) throw new Error(`Login ${role} gagal: ${r.status}`);
  return r.json.accessToken;
};

/** Unggah multipart sesuai endpoint (field `image`). */
async function upload(path, token, bytes, filename, type = 'image/png') {
  const form = new FormData();
  form.set('image', new Blob([bytes], { type }), filename);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'x-school-id': process.env.CBT_SCHOOL ?? 'sman1' }, body: form });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}

/** Fetch file publik via signed URL — dipakai untuk membuktikan berkas ada/hilang. */
async function fetchSigned(imageUrl, token) {
  const sign = await call(`/uploads/sign?path=${encodeURIComponent(imageUrl)}`, { token });
  if (sign.status !== 200 || !sign.json?.url) return null;
  return fetch(`${ORIGIN}${sign.json.url}`);
}

const stamp = Date.now().toString(36);

async function main() {
  console.log(`== CBT image verification @ ${BASE} ==\n`);
  const guruT = await login('guru', 'guru', 'Guru123!');

  console.log('[1 — upload gambar bebas]\n');
  const pngBytes = Buffer.from(PNG_1x1, 'base64');
  const up = await upload('/questions/image', guruT, pngBytes, 'bebas.png');
  const freeUrl = up.json?.imageUrl;
  check('POST /questions/image diterima (200/201)', up.status < 300 && /^\/uploads\/questions\//.test(freeUrl ?? ''), `${up.status} ${JSON.stringify(up.json)}`);
  const served = await fetchSigned(freeUrl, guruT);
  const servedBuf = served ? Buffer.from(await served.arrayBuffer()) : Buffer.alloc(0);
  check('berkas gambar tersaji via signed URL (200 + PNG)', Boolean(served && served.status === 200 && servedBuf.subarray(1, 4).toString() === 'PNG'), `status=${served?.status}`);
  const bad = await upload('/questions/image', guruT, Buffer.from('ini bukan png'), 'palsu.png');
  check('isi file bukan gambar → 400', bad.status === 400, `status=${bad.status}`);
  const evil = await call(`/uploads/sign?path=${encodeURIComponent('/uploads/../../etc/passwd')}`, { token: guruT });
  check('sign path traversal → 400', evil.status === 400, `status=${evil.status}`);

  console.log('\n[2 — gambar opsi tersimpan di soal (persist)]');
  const q = await call('/questions', {
    method: 'POST',
    token: guruT,
    body: {
      type: 'PG',
      content: `Soal gambar opsi ${stamp} — pilih gambar yang benar?`,
      weight: 1,
      scoringMode: 'ALL_OR_NOTHING',
      choices: [
        { id: 'a', label: 'Opsi gambar', imageUrl: freeUrl },
        { id: 'b', label: 'Opsi teks' },
      ],
      correctChoices: ['a'],
    },
  });
  const qid = q.json?.id;
  check('soal dengan gambar opsi dibuat (201)', q.status < 300 && Boolean(qid), `status=${q.status} ${q.text.slice(0, 200)}`);
  const detail = await call(`/questions/${qid}`, { token: guruT });
  const gotImg = detail.json?.choices?.find((c) => c.id === 'a')?.imageUrl;
  check('imageUrl opsi ikut tersimpan (a)', gotImg === freeUrl, `got=${gotImg}`);

  const q2 = await call('/questions', {
    method: 'POST',
    token: guruT,
    body: {
      type: 'PG',
      content: `Soal gambar opsi kembar ${stamp}`,
      weight: 1,
      scoringMode: 'ALL_OR_NOTHING',
      choices: [
        { id: 'a', label: 'Kembar', imageUrl: freeUrl },
        { id: 'b', label: 'Lain' },
      ],
      correctChoices: ['a'],
    },
  });
  check('soal kedua berbagi gambar opsi (201)', q2.status < 300, `status=${q2.status}`);

  console.log('\n[3 — cleanup berkas: refcount media utama + opsi]');
  const del1 = await call(`/questions/${qid}`, { method: 'DELETE', token: guruT });
  check('soal pertama dihapus (200)', del1.status < 300, `status=${del1.status}`);
  const stillThere = await fetchSigned(freeUrl, guruT);
  check('berkas tetap ada (dipakai soal kembar)', stillThere?.status === 200, `status=${stillThere?.status}`);
  const del2 = await call(`/questions/${q2.json?.id}`, { method: 'DELETE', token: guruT });
  check('soal kembar dihapus (200)', del2.status < 300, `status=${del2.status}`);
  const gone = await fetchSigned(freeUrl, guruT);
  check('berkas ikut terhapus setelah pemakai terakhir hilang (404)', gone?.status === 404, `status=${gone?.status}`);

  console.log('\n[4 — cleanup berkas saat gambar opsi dihapus dari soal]');
  const up2 = await upload('/questions/image', guruT, pngBytes, 'hapus-opsi.png');
  const url2 = up2.json?.imageUrl;
  const q3 = await call('/questions', {
    method: 'POST',
    token: guruT,
    body: {
      type: 'PG',
      content: `Soal gambar opsi hapus ${stamp}`,
      weight: 1,
      scoringMode: 'ALL_OR_NOTHING',
      choices: [
        { id: 'a', label: 'Pakai gambar', imageUrl: url2 },
        { id: 'b', label: 'Polos' },
      ],
      correctChoices: ['a'],
    },
  });
  const q3id = q3.json?.id;
  check('soal dengan gambar opsi kedua dibuat', q3.status < 300 && Boolean(q3id), `${q3.status}`);
  const patched = await call(`/questions/${q3id}`, {
    method: 'PATCH',
    token: guruT,
    body: { type: 'PG', content: `Soal gambar opsi hapus ${stamp}`, correctChoices: ['a'], choices: [{ id: 'a', label: 'Tanpa gambar' }, { id: 'b', label: 'Polos' }] },
  });
  check('opsi gambar dihapus dari soal (PATCH 200)', patched.status === 200, `status=${patched.status} ${patched.text.slice(0, 140)}`);
  const gone2 = await fetchSigned(url2, guruT);
  check('berkas opsi ikut terhapus (404)', gone2?.status === 404, `status=${gone2?.status}`);
  await call(`/questions/${q3id}`, { method: 'DELETE', token: guruT });

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
