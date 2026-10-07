# Kongsi API Reference

This is the **contract between the presentation tier (frontend) and the application tier (backend)**. The frontend may only talk to the system through these endpoints. If you change an endpoint, update this file in the same commit so both sides stay in sync.

**Base URL**

| Environment | Base URL |
|---|---|
| Local | `http://localhost:3000/api` |
| AWS (EC2 + Nginx) | `http://<EC2 Elastic IP or public DNS>/api` |
| AWS (with CloudFront) | `https://<distribution>.cloudfront.net/api` |

**Authentication.** Every endpoint except `register`, `login` and `health` needs the token returned by login, sent in a header:

```
Authorization: Bearer <token>
```

**Errors.** Every error has the same shape, so the frontend can always show `error`:

```json
{ "error": "Human-readable message" }
```

| Status | Meaning |
|---|---|
| 200 / 201 / 204 | OK / created / deleted (no body) |
| 400 | Invalid input (message explains what to fix) |
| 401 | Not signed in, or token expired |
| 403 | Signed in, but not allowed (e.g. deleting someone else's photo) |
| 404 | Not found, **or** you are not a member of that group (we do not reveal which) |
| 409 | Conflict: username/email taken, or a comment was edited elsewhere |
| 413 | Photo too large |
| 429 | Too many login/register attempts |
| 500 | Server error (details are only in the server log) |

---

## Health

### `GET /health`
Checks the API and its database connection. Used by Nginx, load balancers and you.

```json
{ "status": "ok", "instance": "ip-172-31-5-20", "storage": "s3", "time": "2026-10-08T03:00:00.000Z" }
```
`instance` shows which server answered (useful when demonstrating two instances). Every response also carries an `X-Served-By` header with the same value.

---

## Accounts

### `POST /auth/register`
```json
{ "username": "lae", "email": "lae@example.com", "password": "atleast8chars" }
```
Rules: username 3–30 letters/numbers/underscores (case-insensitive unique), valid email, password 8+ characters.
**201**
```json
{ "token": "eyJhbGciOi...", "user": { "id": 1, "username": "lae", "email": "lae@example.com", "created_at": "..." } }
```

### `POST /auth/login`
```json
{ "login": "lae or lae@example.com", "password": "atleast8chars" }
```
**200** same shape as register. **401** `Username or password is incorrect.`

### `GET /auth/me`
**200** `{ "user": { "id": 1, "username": "lae", "email": "...", "created_at": "..." } }`

---

## Friend groups

### `GET /groups`
Groups the signed-in user belongs to.
```json
{ "groups": [ { "id": 1, "name": "Trip to Ipoh", "invite_code": "NKX3W5BS", "created_at": "...", "member_count": 3, "photo_count": 12 } ] }
```

### `POST /groups`
```json
{ "name": "Trip to Ipoh" }
```
**201** `{ "group": { "id": 1, "name": "Trip to Ipoh", "invite_code": "NKX3W5BS", "created_at": "..." } }`
The creator is added as the first member in the same database transaction.

### `POST /groups/join`
```json
{ "inviteCode": "NKX3W5BS" }
```
**200** `{ "group": { ... } }`. Joining twice is harmless. **404** if the code does not exist.

### `GET /groups/:groupId`
```json
{
  "group": { "id": 1, "name": "Trip to Ipoh", "invite_code": "NKX3W5BS", "created_by": 1, "created_at": "..." },
  "members": [ { "id": 2, "username": "aiman", "joined_at": "..." } ],
  "tags": [ "food", "ipoh" ]
}
```

---

## Photos

A **photo object** looks like this everywhere:
```json
{
  "id": 7,
  "group_id": 1,
  "caption": "Dim sum breakfast",
  "content_type": "image/jpeg",
  "size_bytes": 284113,
  "created_at": "2026-10-08T03:12:45.000Z",
  "uploader_id": 2,
  "uploader": "aiman",
  "tags": ["food", "ipoh"],
  "comment_count": 4,
  "url": "https://<bucket>.s3.ap-southeast-1.amazonaws.com/groups/1/5f1c...jpg?X-Amz-...&X-Amz-Expires=3600"
}
```
On AWS, `url` is a **pre-signed S3 link valid for one hour**. The bucket itself is private. Always use the `url` from the latest response; do not store it.

### `GET /groups/:groupId/photos` (feed + search & filter)
All query parameters are optional and can be combined:

| Parameter | Example | Effect |
|---|---|---|
| `q` | `q=nasi` | keyword in caption, tag **or any comment** (case-insensitive) |
| `uploader` | `uploader=aiman` | photos by that user |
| `tag` | `tag=food` | photos with that tag |
| `from` | `from=2026-10-01` | uploaded on or after this date |
| `to` | `to=2026-10-31` | uploaded on or before this date |
| `limit` | `limit=24` | page size, 1–50 (default 24) |
| `offset` | `offset=24` | skip this many (for "Show more") |

Newest first. **200** `{ "photos": [ ...photo objects ], "limit": 24, "offset": 0 }`

### `POST /groups/:groupId/photos` (upload)
`multipart/form-data` (use `FormData` in the browser; do **not** set Content-Type yourself):

| Field | Required | Notes |
|---|---|---|
| `photo` | yes | JPEG, PNG, WebP or GIF, max `MAX_UPLOAD_MB` (default 5 MB) |
| `caption` | no | up to 500 characters |
| `tags` | no | comma-separated, e.g. `food, #ipoh`; max 10; letters, numbers, `-`, `_` |

**201** `{ "photo": { ...photo object } }`

### `GET /photos/:photoId`
**200** `{ "photo": { ...photo object } }`

### `DELETE /photos/:photoId`
Uploader only. Deletes the photo, its comments and tags links, and the stored file. **204**

---

## Comments

A **comment object**:
```json
{ "id": 15, "body": "Looks delicious!", "version": 1, "created_at": "...", "updated_at": null, "user_id": 1, "username": "lae" }
```

### `GET /photos/:photoId/comments`
Oldest first. **200** `{ "comments": [ ...comment objects ] }`
The photo page calls this every 5 seconds so new comments from friends appear automatically.

### `POST /photos/:photoId/comments`
```json
{ "body": "Looks delicious!" }
```
1–1000 characters. **201** `{ "comment": { ... } }`

### `PUT /comments/:commentId` (edit, author only)
```json
{ "body": "Looks so good", "version": 1 }
```
Send the `version` you loaded. **200** returns the comment with `version` increased by 1.
**409** if someone changed it since you loaded it (optimistic concurrency control):
```json
{ "error": "This comment was changed somewhere else. Reload to see the latest version.", "currentVersion": 2 }
```

### `DELETE /comments/:commentId` (author only)
**204**
