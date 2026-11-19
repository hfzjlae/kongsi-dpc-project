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

## Folder structure and the owners

| Folder | Contents | Owner |
|---|---|---|
| `frontend/` | Tier 1: the four pages, `css/style.css`, `js/` | **Myra** |
| `backend/` | Tier 2: the REST API (`src/routes/` = endpoints) | **Najla** |
| `database/` | Tier 3: `schema.sql` (all tables and indexes) | **Aniesha** |
| `deploy/` | AWS scripts and policy files | **Aniesha** (with Najla) |
| `load-testing/` | k6 multi-user and concurrency tests | **Aniesha** (with Myra) |
| `docs/API.md` | the frontend ↔ backend contract | **Myra + Najla** together |
| `docs/DEPLOYMENT-AWS.md` | step-by-step AWS guide | **Aniesha** |

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

## How the system handles many users at once

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
