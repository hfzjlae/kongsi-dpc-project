// ==================================================================
//  concurrency-test.js — CORRECTNESS UNDER CONCURRENT ACCESS (k6)
//
//  A speed test shows the system is fast. This test shows it is
//  CORRECT when many users act at exactly the same moment.
//
//  USERS virtual users start at the same instant. Each one:
//    * posts ONE comment on the SAME photo, and
//    * uploads ONE photo to the SAME group.
//  Afterwards, teardown() asks the API how many comments and photos
//  exist and checks that NOTHING was lost or overwritten:
//    comments on the photo   == USERS
//    photos in the group     == USERS + 1 (the seed photo)
//    every photo has its own unique URL (no file overwrote another)
//
//  Run:
//    k6 run concurrency-test.js
//    k6 run -e USERS=100 -e API_URL=http://<EC2-address>/api concurrency-test.js
// ==================================================================
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.API_URL || 'http://localhost:3000/api';
const USERS = Number(__ENV.USERS || 50);
const image = open('./sample.jpg', 'b');

export const options = {
  setupTimeout: '5m',
  scenarios: {
    simultaneous_burst: {
      executor: 'per-vu-iterations', // all VUs start together
      vus: USERS,
      iterations: 1,                 // each VU acts exactly once
      maxDuration: '2m',
    },
  },
  thresholds: {
    checks: ['rate==1.0'], // every single check must pass
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
      JSON.stringify({ username: `cc_${run}_${i}`, email: `cc_${run}_${i}@loadtest.local`, password: 'password123' }),
      jsonHeaders()
    );
    if (res.status !== 201) throw new Error(`Could not create test user ${i}: ${res.status} ${res.body}`);
    tokens.push(res.json('token'));
  }
  const group = http.post(`${BASE}/groups`, JSON.stringify({ name: `Concurrency ${run}` }), jsonHeaders(tokens[0])).json('group');
  for (let i = 1; i < USERS; i++) {
    http.post(`${BASE}/groups/join`, JSON.stringify({ inviteCode: group.invite_code }), jsonHeaders(tokens[i]));
  }
  const seed = http.post(
    `${BASE}/groups/${group.id}/photos`,
    { photo: http.file(image, 'seed.jpg', 'image/jpeg'), caption: 'Shared photo everyone comments on' },
    { headers: { Authorization: `Bearer ${tokens[0]}` } }
  );
  return { tokens, groupId: group.id, photoId: seed.json('photo.id') };
}

export default function (data) {
  const token = data.tokens[__VU - 1];
  const auth = { Authorization: `Bearer ${token}` };

  const comment = http.post(
    `${BASE}/photos/${data.photoId}/comments`,
    JSON.stringify({ body: `Simultaneous comment #${__VU}` }),
    { headers: { ...auth, 'Content-Type': 'application/json' }, tags: { name: 'simultaneous comment' } }
  );
  check(comment, { 'comment accepted (201)': (r) => r.status === 201 });

  // Every VU uploads a file with the SAME original name on purpose.
  const upload = http.post(
    `${BASE}/groups/${data.groupId}/photos`,
    { photo: http.file(image, 'IMG_0001.jpg', 'image/jpeg'), caption: `Simultaneous upload #${__VU}` },
    { headers: auth, tags: { name: 'simultaneous upload' } }
  );
  check(upload, { 'upload accepted (201)': (r) => r.status === 201 });
}

export function teardown(data) {
  const auth = { headers: { Authorization: `Bearer ${data.tokens[0]}` } };

  const comments = http.get(`${BASE}/photos/${data.photoId}/comments`, auth).json('comments');
  const uniqueBodies = new Set(comments.map((c) => c.body)).size;

  const photos = http.get(`${BASE}/groups/${data.groupId}/photos?limit=50`, auth).json('photos');
  let allPhotos = photos;
  for (let offset = 50; offset < USERS + 1; offset += 50) {
    allPhotos = allPhotos.concat(http.get(`${BASE}/groups/${data.groupId}/photos?limit=50&offset=${offset}`, auth).json('photos'));
  }
  const uniqueUrls = new Set(allPhotos.map((p) => p.url.split('?')[0])).size;

  console.log('================ CONCURRENCY RESULT ================');
  console.log(`Simultaneous users:            ${USERS}`);
  console.log(`Comments expected / stored:    ${USERS} / ${comments.length} (unique: ${uniqueBodies})`);
  console.log(`Photos expected / stored:      ${USERS + 1} / ${allPhotos.length} (unique files: ${uniqueUrls})`);
  console.log('====================================================');

  check(null, {
    'no comment lost': () => comments.length === USERS && uniqueBodies === USERS,
    'no photo lost': () => allPhotos.length === USERS + 1,
    'no file overwritten': () => uniqueUrls === USERS + 1,
  });
}
