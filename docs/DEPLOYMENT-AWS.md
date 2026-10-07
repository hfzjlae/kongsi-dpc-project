# Deploying Kongsi on AWS (Free Plan)

This guide deploys each tier on its own AWS service:

| Tier | AWS service | What runs there |
|---|---|---|
| Presentation | **Amazon S3** (static website hosting) | `frontend/` files |
| Application | **Amazon EC2** `t3.micro` + Nginx + PM2 | `backend/` Node.js API |
| Data: records | **Amazon RDS for PostgreSQL** | users, groups, photo metadata, tags, comments |
| Data: photo files | **Amazon S3** (private bucket) | the actual images |
| Optional: HTTPS | **Amazon CloudFront** | one secure address for website + API |
| Optional: scaling | **Application Load Balancer** + 2nd EC2 | horizontal scale-out demo |

```
Browser ──HTTP──> S3 website (Tier 1)
   │
   └──HTTP /api──> EC2: Nginx :80 ──> Node API :3000 (Tier 2)
                                  ├──> RDS PostgreSQL :5432 (Tier 3, private)
                                  └──> S3 photo bucket (Tier 3, private, via IAM role)
```

**Who does this:** Member C leads, with Member B on the EC2/API steps (Part 5–6) and Member A on the website steps (Part 8). Take a **screenshot of every configuration page** as you go; Section 6 of the report needs them.

**Time needed:** about 2–3 hours the first time. Do it in Week 2, not Week 4.

> Throughout this guide, replace anything in `<angle brackets>` with your own value. Keep a shared note (not in GitHub) of every name, endpoint and password you create.

---

## Part 0 — Before you start (15 min)

1. **Pick one AWS account** to host everything (the Cloud lead's). Only one person needs to deploy.
2. Sign in to the AWS Console. In the top-right **Region** menu choose **Asia Pacific (Singapore) `ap-southeast-1`**. Every resource in this guide must be created in this same region (it is close to Malaysia, and keeping everything in one region avoids cross-region data charges).
3. **Create a budget first** (it also earns Free Plan onboarding credit):
   *Billing and Cost Management → Budgets → Create budget → Use a template → Monthly cost budget*. Amount: **USD 10**. Enter all three members' emails. Create. Screenshot it.
4. Check your credit balance any time at *Billing and Cost Management → Credits*.

---

## Part 1 — Security groups (the firewalls) (10 min)

A **security group** decides which traffic may reach a resource. We create two, so the database only accepts connections from the API server. This is what makes the tiers "clearly separated".

*EC2 console → Network & Security → Security Groups → Create security group* (VPC: the default VPC).

**`kongsi-api-sg`** (for the EC2 API server)

| Type | Port | Source | Why |
|---|---|---|---|
| HTTP | 80 | `0.0.0.0/0` (Anywhere-IPv4) | browsers call the API |
| SSH | 22 | **prefix list** `com.amazonaws.ap-southeast-1.ec2-instance-connect` | lets you open a terminal from the AWS website (EC2 Instance Connect) |

(If you cannot find the prefix list, use **My IP** for SSH instead and connect with the downloaded key pair.)

**`kongsi-db-sg`** (for the RDS database)

| Type | Port | Source | Why |
|---|---|---|---|
| PostgreSQL | 5432 | **`kongsi-api-sg`** (choose the security group, not an IP) | only the API tier can reach the database |

Leave outbound rules as default. Screenshot both.

---

## Part 2 — S3 bucket for photos (5 min)

*S3 → Create bucket*

- Bucket name: `kongsi-photos-<groupname>-<random digits>` (must be globally unique, lowercase)
- Region: Singapore
- **Block all public access: ON** (keep it ticked). Photos are only shown through short-lived signed links the API generates.
- Default encryption: SSE-S3 (default)
- Create.

---

## Part 3 — IAM role so EC2 can use the photo bucket (10 min)

Instead of putting AWS passwords (access keys) in the code, we give the EC2 server a **role**. The AWS SDK picks it up automatically.

1. *IAM → Roles → Create role*
2. Trusted entity: **AWS service**, use case **EC2** → Next
3. Do not tick any policy → Next → Role name **`kongsi-ec2-role`** → Create role
4. Open the role → *Add permissions → Create inline policy → JSON*. Paste the contents of `deploy/iam-s3-photo-policy.json`, replacing `REPLACE-WITH-PHOTO-BUCKET-NAME` with your photo bucket name.
5. Policy name `kongsi-photo-bucket-access` → Create.

This policy follows **least privilege**: the server can only put, get and delete objects in that one bucket, nothing else in your account.

---

## Part 4 — RDS PostgreSQL database (10 min + ~10 min waiting)

*RDS → Databases → Create database*

| Setting | Value |
|---|---|
| Creation method | **Full configuration** (Standard create) |
| Engine | **PostgreSQL**, latest 16.x or 17.x |
| Template | **Free tier** (or *Sandbox* / *Dev/Test* if Free tier is not shown) |
| Deployment | Single-AZ (no standby) |
| DB instance identifier | `kongsi-db` |
| Master username | `postgres` |
| Credentials management | **Self managed**, set a strong password and save it |
| Instance class | **db.t4g.micro** (or db.t3.micro) |
| Storage | gp3, **20 GiB**; untick *Enable storage autoscaling* |
| Compute resource | Don't connect to an EC2 compute resource |
| VPC | Default VPC |
| **Public access** | **No** |
| VPC security group | Choose existing → **`kongsi-db-sg`** (remove `default`) |
| Additional configuration → **Initial database name** | `kongsi` |
| Backup retention | 1 day |
| Performance Insights / Enhanced monitoring | Off |

Create, then wait until Status is **Available**. Open the database and copy the **Endpoint** (looks like `kongsi-db.xxxxxxxx.ap-southeast-1.rds.amazonaws.com`). Screenshot the *Connectivity & security* tab showing *Publicly accessible: No*.

---

## Part 5 — EC2 server for the API (15 min)

*EC2 → Instances → Launch instances*

| Setting | Value |
|---|---|
| Name | `kongsi-api-1` |
| AMI | **Amazon Linux 2023** (Free tier eligible) |
| Instance type | **t3.micro** (marked Free tier eligible) |
| Key pair | Create one (`kongsi-key`, .pem) and keep it safe, or proceed without if you only use Instance Connect |
| Network | Default VPC, **Auto-assign public IP: Enable** |
| Security group | Select existing **`kongsi-api-sg`** |
| Storage | 8 GiB gp3 |
| Advanced details → **IAM instance profile** | **`kongsi-ec2-role`** |

Launch. If you get *"You have requested more vCPU capacity than your current vCPU limit"*, open *Service Quotas → Amazon EC2 → Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances* and request **4** vCPUs (enough for the optional second server), then try again once approved.

### Give it a fixed address (recommended)
*EC2 → Elastic IPs → Allocate Elastic IP address → Allocate*, then *Actions → Associate* with `kongsi-api-1`. Now the address stays the same even if you stop and start the server. Note it as `<API-IP>`. (Public IPv4 addresses are billed hourly while allocated; release it in Part 12.)

---

## Part 6 — Install and start the API on EC2 (20 min)

1. *EC2 → select `kongsi-api-1` → Connect → EC2 Instance Connect → Connect*. A terminal opens in your browser.
2. Get the code. If your GitHub repository is **private**, create a token: GitHub → *Settings → Developer settings → Fine-grained personal access tokens* → access to this repo only, *Contents: Read-only*.
   ```bash
   sudo dnf install -y git
   git clone https://<github-username>:<token>@github.com/<github-username>/<repo-name>.git kongsi
   cd kongsi
   ```
3. Install everything:
   ```bash
   bash deploy/ec2-setup.sh
   ```
4. Create the tables in RDS (enter the master password when asked):
   ```bash
   psql "host=<RDS-endpoint> port=5432 dbname=kongsi user=postgres sslmode=require" -f database/schema.sql
   ```
   This connection works only because `kongsi-db-sg` allows `kongsi-api-sg`. Try the same command from your laptop and it will time out, which proves the database is private. (Screenshot both for the report.)
5. Edit the settings:
   ```bash
   nano backend/.env
   ```
   ```ini
   PORT=3000
   PUBLIC_API_URL=http://<API-IP>
   CORS_ORIGIN=http://<website-bucket>.s3-website-ap-southeast-1.amazonaws.com
   DATABASE_URL=postgres://postgres:<db-password>@<RDS-endpoint>:5432/kongsi
   DB_SSL=true
   DB_POOL_MAX=10
   JWT_SECRET=<paste output of: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
   JWT_EXPIRES_IN=12h
   AUTH_RATE_LIMIT=300
   STORAGE_MODE=s3
   MAX_UPLOAD_MB=5
   AWS_REGION=ap-southeast-1
   S3_BUCKET=<photo-bucket-name>
   S3_URL_EXPIRES=3600
   ```
   (If your DB password contains `@ : / ? #`, choose another password; those characters break the URL.)
   You will fill in the real `CORS_ORIGIN` after Part 8. Save with `Ctrl+O`, `Enter`, exit with `Ctrl+X`.
6. Start the API:
   ```bash
   bash deploy/start-api.sh
   ```
   You should see `{"status":"ok", ... "storage":"s3" ...}`.
7. From your own browser open `http://<API-IP>/api/health`. Seeing the same JSON means Tier 2 is live on the internet.

**Updating later:** after pushing new code to GitHub, connect again and run `bash deploy/update-api.sh`.
**Logs:** `pm2 logs kongsi-api` (shows every request with its response time; useful screenshots for testing).

---

## Part 7 — Point the frontend at the API (2 min)

On your laptop, edit `frontend/js/config.js`:
```js
window.APP_CONFIG = {
  API_BASE_URL: 'http://<API-IP>/api',
};
```

---

## Part 8 — S3 static website for the frontend (15 min)

1. *S3 → Create bucket*: name `kongsi-web-<groupname>-<random digits>`, Singapore region.
   **Untick "Block all public access"** and tick the acknowledgement (a website must be readable by everyone; this bucket contains no private data). Create.
2. Open the bucket → *Properties* → **Static website hosting → Edit → Enable**, Index document `index.html` → Save. Copy the **Bucket website endpoint** (`http://kongsi-web-...s3-website-ap-southeast-1.amazonaws.com`).
3. *Permissions → Bucket policy → Edit*: paste `deploy/s3-website-bucket-policy.json`, replacing `REPLACE-WITH-WEBSITE-BUCKET-NAME`. Save.
4. *Objects → Upload*: drag **the contents of** the `frontend` folder (`index.html`, `groups.html`, `group.html`, `photo.html`, `css/`, `js/`) — not the `frontend` folder itself. Upload.
5. Back on EC2, set `CORS_ORIGIN` in `backend/.env` to the website endpoint **exactly** (no trailing slash), then `bash deploy/start-api.sh`.
6. Open the website endpoint. Register, create a group, upload a photo, comment. **This URL is what you submit.**

If the page loads but every action says *Cannot reach the server*: check `config.js` points to `http://<API-IP>/api`, `CORS_ORIGIN` matches the website address exactly, and `http://<API-IP>/api/health` works.

---

## Part 9 (optional, recommended) — HTTPS with CloudFront (20 min)

Without this, passwords and tokens travel unencrypted over HTTP. CloudFront gives one `https://` address for both the website and the API, so it is a strong security point for the report.

1. *CloudFront → Create distribution*.
2. **Origin 1:** choose the **S3 website endpoint** (paste `kongsi-web-...s3-website-ap-southeast-1.amazonaws.com`; protocol HTTP only).
   Viewer protocol policy: **Redirect HTTP to HTTPS**. Cache policy: *CachingOptimized*.
   If asked about AWS WAF security protections, choose **do not enable** (WAF is charged separately).
   Create the distribution and note its domain `<dxxxx>.cloudfront.net`.
3. *Origins → Create origin*: origin domain = the EC2 **public IPv4 DNS** of your Elastic IP (e.g. `ec2-13-250-1-2.ap-southeast-1.compute.amazonaws.com`; CloudFront needs a name, not an IP), protocol **HTTP only**, port 80.
4. *Behaviors → Create behavior*: path pattern `/api/*`, origin = the EC2 origin, viewer protocol **Redirect HTTP to HTTPS**, allowed methods **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**, cache policy **CachingDisabled**, origin request policy **AllViewerExceptHostHeader**. Save.
5. Change `frontend/js/config.js` to `API_BASE_URL: '/api'` and re-upload `js/config.js` to the website bucket.
6. Set `CORS_ORIGIN=https://<dxxxx>.cloudfront.net` in `.env` and `bash deploy/start-api.sh`.
7. After deploying (~5–10 min) open `https://<dxxxx>.cloudfront.net`. Submit this URL instead.

Extra hardening: in `kongsi-api-sg`, replace the HTTP `0.0.0.0/0` rule with the prefix list `com.amazonaws.global.cloudfront.origin-facing`, so the API only accepts traffic that came through CloudFront.

---

## Part 10 (optional) — Two API servers behind a load balancer (30 min)

This demonstrates **horizontal scaling**, the most "distributed" feature you can show. It works because the API is stateless (JWT login, files in S3, data in RDS). The load balancer is billed hourly from your credits, so create it only for testing and the demo, then delete it.

1. *EC2 → select `kongsi-api-1` → Actions → Image and templates → Create image* (`kongsi-api-image`). Wait until the AMI is *Available*.
2. Launch `kongsi-api-2` from that AMI (*AMIs → Launch instance from AMI*), same type, `kongsi-api-sg`, same IAM role. PM2 restarts the API automatically on boot.
3. *EC2 → Target groups → Create*: Instances, HTTP 80, health check path **`/api/health`**. Register both instances.
4. *EC2 → Load balancers → Create → Application Load Balancer*: internet-facing, at least two subnets, a new security group allowing HTTP 80 from anywhere, listener HTTP 80 → your target group.
5. In `kongsi-api-sg`, allow HTTP 80 from the load balancer's security group.
6. Point `config.js` (or the CloudFront `/api/*` origin) at the load balancer's DNS name.
7. Proof for the report: call `/api/health` several times (or look at the `X-Served-By` header in the browser's Network tab) and show the `instance` value alternating between the two servers. Run the k6 load test against one instance vs two and compare.

---

## Part 11 — Monitoring and evidence for the report

- **EC2 → instance → Monitoring:** CPU utilisation, network in/out during the k6 run.
- **RDS → kongsi-db → Monitoring:** CPU, *DatabaseConnections* (shows the connection pool at work).
- **`pm2 logs kongsi-api`:** live request log with response times.
- **k6 output:** run from a laptop against the real URL:
  ```bash
  k6 run -e API_URL=http://<API-IP>/api --summary-export=results-load.json load-testing/load-test.js
  k6 run -e API_URL=http://<API-IP>/api load-testing/concurrency-test.js
  ```

---

## Part 12 — Cost control and shutdown

**While working:**
- *RDS → kongsi-db → Actions → Stop temporarily* when nobody is working for a day or more (you pay only for storage while stopped). AWS starts it again automatically after 7 days.
- *EC2 → Stop instance* overnight if you like (the Elastic IP is still billed while allocated).
- Check *Billing → Credits* and *Bills* weekly; screenshot them for the cost section.

**After grading and the demo video (do all of these, in this order):**
1. CloudFront: *Disable* the distribution, wait, then *Delete*.
2. Load balancer and target group: delete.
3. EC2: terminate all instances; deregister the AMI and delete its snapshot.
4. Elastic IP: *Release*.
5. RDS: delete `kongsi-db` (untick *Create final snapshot*; tick the acknowledgement).
6. S3: *Empty* each bucket, then *Delete* it.
7. Security groups `kongsi-api-sg`, `kongsi-db-sg`, IAM role `kongsi-ec2-role`.
8. A day later, confirm *Billing → Bills* shows no running charges.

---

## Cost estimate (for Section 7 of the report)

Build the estimate in the **AWS Pricing Calculator** (calculator.aws), region Asia Pacific (Singapore), and export it as PDF or a share link. Add these services:

| Service | What to enter |
|---|---|
| Amazon EC2 | 1 (or 2) × t3.micro Linux, on-demand, 730 h/month, 8 GB gp3 |
| Public IPv4 address | 1 (or 2) addresses × 730 h |
| Amazon RDS for PostgreSQL | db.t4g.micro, Single-AZ, on-demand, 20 GB gp3, 1-day backups |
| Amazon S3 Standard | GB of photos stored, number of PUT and GET requests per month |
| Data transfer out | GB of photos viewed per month |
| CloudFront (if used) | data transfer out + requests |
| Application Load Balancer (if used) | hours + LCUs |

State your scenario and assumptions (for example: 50 friends, each uploading 20 photos of ~300 KB per month and viewing 500 photos per month), then compare three numbers: **estimated monthly cost at list price**, **actual cost during the project** (Billing → Bills), and **amount covered by Free Plan credits**. Convert to MYR and state the exchange rate and date you used. Always take unit prices from the calculator on the day you do it, not from tutorials.
