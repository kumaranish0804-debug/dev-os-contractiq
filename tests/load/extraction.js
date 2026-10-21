// k6 load test for upload → process (Spec 12 §12.1, before v1.0). Live OpenAI: run only against a
// deployed stack with a key, and mind the per-user limits (20 uploads/hour) — use one user per VU.
//
//   k6 run -e SUPABASE_URL=… -e ANON_KEY=… -e USERS='[{"email":"…","password":"…"}, …]' tests/load/extraction.js
import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend } from 'k6/metrics';

const pdf = open('../fixtures/nda-3-pages.pdf', 'b');
const users = JSON.parse(__ENV.USERS || '[]');
const base = __ENV.SUPABASE_URL;
const anon = __ENV.ANON_KEY;

const extraction = new Trend('extraction_ms', true);

export const options = {
  scenarios: {
    ramp: { executor: 'ramping-vus', startVUs: 1, stages: [{ duration: '1m', target: 5 }, { duration: '3m', target: 5 }, { duration: '30s', target: 0 }] },
  },
  thresholds: {
    extraction_ms: ['p(95)<30000'], // PRD launch gate
    http_req_failed: ['rate<0.05'],
  },
};

export function setup() {
  if (!base || !anon || users.length === 0) fail('Set SUPABASE_URL, ANON_KEY and USERS');
  return users.map((u) => {
    const res = http.post(`${base}/auth/v1/token?grant_type=password`, JSON.stringify(u), {
      headers: { apikey: anon, 'Content-Type': 'application/json' },
    });
    check(res, { 'signed in': (r) => r.status === 200 }) || fail(`sign-in failed for ${u.email}`);
    return res.json('access_token');
  });
}

export default function (tokens) {
  const token = tokens[(__VU - 1) % tokens.length];
  const headers = { apikey: anon, Authorization: `Bearer ${token}` };

  const upload = http.post(
    `${base}/functions/v1/upload-contract`,
    { file: http.file(pdf, 'nda-3-pages.pdf', 'application/pdf'), contract_type: 'NDA' },
    { headers },
  );
  if (!check(upload, { 'upload 201': (r) => r.status === 201 })) return;

  const started = Date.now();
  const processed = http.post(
    `${base}/functions/v1/process-contract`,
    JSON.stringify({ contract_id: upload.json('contract_id'), contract_type: 'NDA', custom_terms: [] }),
    { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: '90s' },
  );
  if (check(processed, { 'process 200': (r) => r.status === 200 })) extraction.add(Date.now() - started);
}
