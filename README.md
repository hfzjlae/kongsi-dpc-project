# Kongsi — Distributed Photo-Sharing and Commenting System

TEB3033 Distributed and Parallel Computing — group project.

Kongsi lets a group of friends create a shared album, invite each other with a code, upload photos, comment on each other's photos, and search or filter the album. It is built as a **three-tier distributed system** and deployed on **AWS**.

```
┌────────────────────────────┐
│ Tier 1: PRESENTATION       │  frontend/   HTML + CSS + JavaScript
│ (runs in the browser)      │  hosted on Amazon S3 (static website)
└─────────────┬──────────────┘
              │ HTTP(S) + JSON, JWT token
┌─────────────▼──────────────┐
│ Tier 2: APPLICATION        │  backend/    Node.js + Express REST API
│ (business rules)           │  on Amazon EC2 behind Nginx, managed by PM2
└──────┬──────────────┬──────┘
       │ SQL (TLS)    │ AWS SDK (IAM role)
┌──────▼──────┐ ┌─────▼──────────────┐
│ Tier 3:     │ │ Tier 3:            │
│ PostgreSQL  │ │ Amazon S3 (private)│
│ on RDS      │ │ the photo files    │
└─────────────┘ └────────────────────┘
```

The browser never touches the database or the photo bucket directly. Only the API does.

---

## Folder structure and who owns what

| Folder | Contents | Owner |
|---|---|---|
| `frontend/` | Tier 1: the four pages, `css/style.css`, `js/` | **Member A** |
| `backend/` | Tier 2: the REST API (`src/routes/` = endpoints) | **Member B** |
| `database/` | Tier 3: `schema.sql` (all tables and indexes) | **Member C** |
| `deploy/` | AWS scripts and policy files | **Member C** (with B) |
| `load-testing/` | k6 multi-user and concurrency tests | **Member C** (with A) |
| `docs/API.md` | the frontend ↔ backend contract | **A + B** together |
| `docs/DEPLOYMENT-AWS.md` | step-by-step AWS guide | **C** |

```
kongsi/
├── README.md
├── database/schema.sql
├── backend/
│   ├── package.json
│   ├── .env.example            copy to .env and fill in
│   └── src/
│       ├── server.js           starts the API, security, logging, errors
│       ├── config.js           reads settings from .env
│       ├── db.js               PostgreSQL connection pool + transactions
│       ├── storage.js          photo files: local disk or Amazon S3
│       ├── middleware/auth.js  JWT login check, group membership check
│       ├── services/photos.js  photo queries + SEARCH & FILTER
│       └── routes/             auth.js, groups.js, photos.js, comments.js
├── frontend/
│   ├── index.html  groups.html  group.html  photo.html
│   ├── css/style.css
│   └── js/  config.js (API address)  api.js (shared helpers)
│            login.js  groups.js  group.js  photo.js
├── load-testing/  load-test.js  concurrency-test.js  sample.jpg
├── deploy/        ec2-setup.sh  start-api.sh  update-api.sh  nginx-kongsi.conf
│                  iam-s3-photo-policy.json  s3-website-bucket-policy.json
└── docs/          API.md  DEPLOYMENT-AWS.md
```

---

## Features

| Feature | Where |
|---|---|
| Register / sign in (bcrypt-hashed passwords, JWT tokens) | `routes/auth.js`, `index.html` |
| Friend groups with invite codes; only members see a group | `routes/groups.js`, `groups.html` |
| Upload photos with caption and tags (resized in the browser first) | `routes/groups.js`, `group.html` |
| Album feed, refreshes every 20 s | `group.js` |
| Comment, edit and delete your own comments | `routes/photos.js`, `routes/comments.js`, `photo.html` |
| Comments refresh every 5 s, so friends see each other live | `photo.js` |
| **Bonus: search & filter** by keyword (caption, tag or comment text), uploader, tag, date range | `services/photos.js`, `group.html` |
| Delete your own photos | `routes/photos.js` |

## How the system handles many users at once (for the report)

| Problem | Solution in the code |
|---|---|
| Too many database connections under load | Connection **pool** (`db.js`, `DB_POOL_MAX`) |
| Two people upload `IMG_0001.jpg` at the same moment | Every file gets a random **UUID** name (`routes/groups.js`) |
| Photo saved but its tags fail halfway | Metadata + tags saved in one **transaction** (`db.transaction`) |
| File stored but database insert fails | **Compensating action** deletes the orphan file |
| Two uploads create the same new tag at once | `INSERT ... ON CONFLICT` upsert |
| Two devices edit the same comment | **Optimistic concurrency control** with a `version` column → 409 Conflict |
| Same username registered twice simultaneously | Database **UNIQUE** constraint is the final judge |
| Running 2+ API servers | API is **stateless** (JWT, files in S3, data in RDS); `X-Served-By` header shows which server answered |
| Friends seeing each other's updates | Short **polling** (5 s comments, 20 s feed) |

## Security measures

Parameterised SQL (no SQL injection), HTML escaping in the frontend (no XSS), bcrypt password hashing, JWT expiry, membership checks on every group/photo/comment request, owner-only edit/delete, upload type and size limits, rate limiting on login/register, Helmet security headers, CORS restricted to our own website, private photo bucket with one-hour pre-signed links, private RDS reachable only from the API's security group, IAM role with least privilege (no AWS keys in code), secrets only in `.env` (never committed).

---

## Running it on your laptop (Week 1)

### 1. Install the tools (once)

| Tool | Get it from | Check it works |
|---|---|---|
| **Node.js 22 LTS** | nodejs.org | `node -v` |
| **PostgreSQL 16 or 17** (includes pgAdmin) | postgresql.org/download | open pgAdmin |
| **Git** | git-scm.com | `git --version` |
| **VS Code** + extension **Live Server** | code.visualstudio.com | — |

While installing PostgreSQL, set a password for the `postgres` user and **write it down**. Keep the port as 5432.

### 2. Get the code
```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
```

### 3. Create the database
In **pgAdmin**: right-click *Databases → Create → Database*, name it `kongsi`. Then right-click `kongsi` → *Query Tool* → open `database/schema.sql` → press ▶ (Execute).
(Or in a terminal: `psql -U postgres -c "CREATE DATABASE kongsi"` then `psql -U postgres -d kongsi -f database/schema.sql`.)

Running `schema.sql` again **deletes all data** and starts fresh, which is handy during development.

### 4. Configure and start the API
```bash
cd backend
npm install
```
Copy `.env.example` to a new file called `.env` (same folder) and change:
```ini
DATABASE_URL=postgres://postgres:<your-postgres-password>@localhost:5432/kongsi
JWT_SECRET=<any long random text>
```
Leave `STORAGE_MODE=local` on your laptop. Then:
```bash
npm run dev
```
You should see `Kongsi API listening on port 3000 (storage: local ...)`. Check http://localhost:3000/api/health in your browser.
`npm run dev` restarts automatically when you save a backend file.

### 5. Open the website
In VS Code, open the `frontend` folder, right-click `index.html` → **Open with Live Server**. It opens at `http://127.0.0.1:5500`.

### 6. Try it as two users
Open a normal window and an **incognito/private** window (they keep separate logins). Register two accounts, create a group in one, join with the invite code in the other, upload a photo, open the same photo in both and comment. Each window shows the other's comment within 5 seconds.

---

## Testing with many users (Week 3)

Install k6: Windows `winget install k6 --source winget`, macOS `brew install k6` (or see grafana.com/docs/k6). Then from the `load-testing` folder:

```bash
# Load test: ramps up to 50 simultaneous users (~4 minutes)
k6 run load-test.js
k6 run -e USERS=100 -e API_URL=http://<API-IP>/api --summary-export=results-load.json load-test.js

# Correctness test: 50 users comment and upload at the same instant,
# then it checks that nothing was lost or overwritten
k6 run concurrency-test.js
k6 run -e USERS=100 -e API_URL=http://<API-IP>/api concurrency-test.js
```
Add `-e QUICK=1` to the load test for a 35-second version while trying things out.

Results from our local test run (50 virtual users):
- Concurrency test: 50/50 comments stored, 51/51 photos stored, 51 unique files, 100% of checks passed.
- Quick load test: 4,904 requests, 0% failed, 95th percentile response time 16 ms.

Run both again against AWS and use **those** numbers in the report (expect slower times over the internet).

---

## Deploying to AWS

Follow **`docs/DEPLOYMENT-AWS.md`** step by step.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required setting DATABASE_URL` | You have no `backend/.env`. Copy `.env.example` to `.env`. |
| `password authentication failed` | Wrong password in `DATABASE_URL`. |
| `database "kongsi" does not exist` | Do step 3. |
| `relation "users" does not exist` | Run `database/schema.sql`. |
| `EADDRINUSE :3000` | The API is already running in another terminal. Close it. |
| Website says *Cannot reach the server* | API not running, or `frontend/js/config.js` has the wrong address. |
| Works in Postman, fails in the browser (CORS error in console) | Add the exact website address (e.g. `http://127.0.0.1:5500`) to `CORS_ORIGIN` in `.env`, restart the API. |
| Opening `index.html` by double-clicking doesn't work | Use Live Server; pages must be served over `http://`. |

## Submission checklist

- [ ] Zip the project **without** `backend/node_modules`, `backend/.env` and `backend/uploads`
- [ ] Deployed URL (S3 website or CloudFront address) works from a phone on mobile data
- [ ] Report (Arial 11, max 8 pages, IEEE references at size 8, marking rubric on the last page)
- [ ] Video (max 2 minutes, all members speak, live demo with two users)
- [ ] After grading: delete all AWS resources (`docs/DEPLOYMENT-AWS.md`, Part 12)
