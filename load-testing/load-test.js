// ==================================================================
//  load-test.js — MULTI-USER LOAD TEST (k6)
//
//  What it does:
//    1. setup(): creates USERS test accounts, one friend group they all
//       join, and one seed photo.
//    2. Each virtual user (VU) then repeatedly behaves like a real
//       friend: opens the album, opens a photo, reads comments, posts a
//       comment, searches, and sometimes uploads a photo.
//    3. The number of simultaneous users ramps up to USERS, holds, then
//       ramps down. k6 reports response times and error rate.
//
//  Run (from this folder):
//    k6 run load-test.js                                   (local API)
//    k6 run -e API_URL=http://<EC2-address>/api load-test.js   (AWS)
//    k6 run -e USERS=100 -e API_URL=... load-test.js           (more users)
//    k6 run -e QUICK=1 load-test.js                        (short version)
//
//  Save evidence for the report:
//    k6 run --summary-export=results-load.json load-test.js
// ==================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.API_URL || 'http://localhost:3000/api';
const USERS = Number(__ENV.USERS || 50);
const QUICK = __ENV.QUICK === '1';
const image = open('./sample.jpg', 'b'); // must be loaded here, not inside functions

export const options = {
  setupTimeout: '5m',
  stages: QUICK
    ? [
        { duration: '10s', target: USERS },
        { duration: '20s', target: USERS },
        { duration: '5s', target: 0 },
      ]
    : [
        { duration: '30s', target: Math.ceil(USERS / 5) }, // warm up
        { duration: '1m', target: USERS },                 // ramp to full load
        { duration: '2m', target: USERS },                 // hold full load
        { duration: '30s', target: 0 },                    // ramp down
      ],
  // Pass/fail rules shown at the end of the run
  thresholds: {
    http_req_failed: ['rate<0.01'],          // under 1% of requests may fail
    http_req_duration: ['p(95)<1500'],       // 95% of requests under 1.5 s
    checks: ['rate>0.99'],
  },
};

function jsonHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { headers };
}

export function setup() {
  const run = Date.now().toString(36);
  const tokens = [];

  for (let i = 0; i < USERS; i++) {
    const res = http.post(
      `${BASE}/auth/register`,
      JSON.stringify({
        username: `k6_${run}_${i}`,
        email: `k6_${run}_${i}@loadtest.local`,
        password: 'password123',
      }),
      jsonHeaders()
    );
    if (res.status !== 201) throw new Error(`Could not create test user ${i}: ${res.status} ${res.body}`);
    tokens.push(res.json('token'));
  }

  const groupRes = http.post(`${BASE}/groups`, JSON.stringify({ name: `Load test ${run}` }), jsonHeaders(tokens[0]));
  const group = groupRes.json('group');
  for (let i = 1; i < USERS; i++) {
    http.post(`${BASE}/groups/join`, JSON.stringify({ inviteCode: group.invite_code }), jsonHeaders(tokens[i]));
  }

  const upload = http.post(
    `${BASE}/groups/${group.id}/photos`,
    { photo: http.file(image, 'seed.jpg', 'image/jpeg'), caption: 'Seed photo for load test', tags: 'loadtest' },
    { headers: { Authorization: `Bearer ${tokens[0]}` } }
  );
  if (upload.status !== 201) throw new Error(`Seed upload failed: ${upload.status} ${upload.body}`);

  console.log(`Prepared ${USERS} users in group ${group.id} (invite ${group.invite_code})`);
  return { tokens, groupId: group.id, photoId: upload.json('photo.id') };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const auth = { Authorization: `Bearer ${token}` };

  // 1. Open the group album
  let res = http.get(`${BASE}/groups/${data.groupId}/photos`, { headers: auth, tags: { name: 'view album' } });
  check(res, { 'album loads (200)': (r) => r.status === 200 });

  // 2. Open a photo and read its comments
  res = http.get(`${BASE}/photos/${data.photoId}`, { headers: auth, tags: { name: 'view photo' } });
  check(res, { 'photo loads (200)': (r) => r.status === 200 });
  res = http.get(`${BASE}/photos/${data.photoId}/comments`, { headers: auth, tags: { name: 'read comments' } });
  check(res, { 'comments load (200)': (r) => r.status === 200 });

  // 3. Post a comment
  res = http.post(
    `${BASE}/photos/${data.photoId}/comments`,
    JSON.stringify({ body: `Comment from user ${__VU}, round ${__ITER}` }),
    { headers: { ...auth, 'Content-Type': 'application/json' }, tags: { name: 'post comment' } }
  );
  check(res, { 'comment saved (201)': (r) => r.status === 201 });

  // 4. Search the album
  res = http.get(`${BASE}/groups/${data.groupId}/photos?q=seed&tag=loadtest`, {
    headers: auth,
    tags: { name: 'search' },
  });
  check(res, { 'search works (200)': (r) => r.status === 200 });

  // 5. Every 5th round, upload a photo
  if (__ITER % 5 === 0) {
    res = http.post(
      `${BASE}/groups/${data.groupId}/photos`,
      { photo: http.file(image, `vu${__VU}.jpg`, 'image/jpeg'), caption: `Upload by user ${__VU}`, tags: 'loadtest' },
      { headers: auth, tags: { name: 'upload photo' } }
    );
    check(res, { 'photo uploaded (201)': (r) => r.status === 201 });
  }

  sleep(1 + Math.random()); // "think time" like a real person
}
