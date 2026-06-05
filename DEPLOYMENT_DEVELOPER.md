# FFD Tracker — Developer Deployment Guide

This guide is for deploying the FFD Tracker to a fresh OCI compute instance using
**Outlook / Office 365 SMTP** for email. It assumes familiarity with Linux, Docker,
and cloud infrastructure.

---

## Architecture Overview

```
Internet → nginx (port 80) → FastAPI backend (port 8000)
                           → Vite frontend (port 3000, served via nginx in prod)
FastAPI → PostgreSQL 16
        → Redis 7 (Celery broker + cache)
        → OCI Object Storage (document storage, via Instance Principals)
        → SMTP relay (email notifications)
```

**Docker services:** `db`, `redis`, `backend`, `worker`, `beat`, `frontend`

---

## 1. OCI Compute Instance

1. Region: **UAE East (Dubai)** — `me-dubai-1`
2. **Compute → Instances → Create Instance**
   - Image: Canonical Ubuntu 22.04
   - Shape: VM.Standard.A1.Flex (free tier) — 2 OCPUs, 12 GB RAM
   - Generate SSH key pair and download both files
3. **Security List ingress rules** (Networking → VCN → Subnet → Security Lists):
   - TCP 22 — SSH
   - TCP 80 — HTTP
4. Note the **Public IP**

> SSH user is `ubuntu`, not `opc`.

---

## 2. OCI Object Storage

### Create bucket

**Storage → Object Storage → Buckets → Create Bucket**
- Name: `ffd-documents`
- Tier: Standard
- Visibility: **Private**

Get your **namespace**: Profile → Tenancy → Object Storage Namespace (e.g. `ax8ewlrggvoe`)

### Instance Principals (no credentials in .env)

The app authenticates to OCI using the compute instance's own identity — no access keys needed.

**a) Create Dynamic Group**
Identity & Security → Domains → Default Domain → Dynamic Groups → Create
- Name: `ffd-tracker-instances`
- Rule: `ANY {instance.id = '<your-instance-ocid>'}`
  - Find OCID: Compute → Instances → click instance → copy OCID

**b) Create Policy** — must be at **root tenancy** level
Identity & Security → Policies → Create Policy
- Name: `ffd-tracker-storage`
- Compartment: root (`<tenancy-name> (root)`)
- Click **Show manual editor**, enter:
  ```
  Allow dynamic-group ffd-tracker-instances to manage objects in tenancy
  ```

Allow 1–2 minutes for IAM propagation after creation.

---

## 3. Email — Outlook / Office 365 SMTP

The app uses `EMAIL_PROVIDER=smtp` with standard SMTP. No OAuth setup required.

### Office 365 SMTP settings

| Setting | Value |
|---------|-------|
| `SMTP_HOST` | `smtp.office365.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USE_TLS` | `true` (STARTTLS) |
| `SMTP_USERNAME` | Full email address (e.g. `notifications@yourcompany.com`) |
| `SMTP_PASSWORD` | Account password or App Password |
| `SMTP_SENDER_EMAIL` | Same as `SMTP_USERNAME` (or a display address if relay allows) |

> **App Password:** If the account has MFA enabled, generate an App Password in
> Microsoft 365 Admin → Users → Active Users → the account → Manage mail apps →
> toggle SMTP AUTH on, then use the App Password here.

> **SMTP AUTH must be enabled** on the mailbox. In Exchange Admin Center:
> Settings → Mail flow → SMTP AUTH → enable per-mailbox if disabled globally.

### On-premise Exchange

If using an on-premise Exchange server, use your internal SMTP relay host and port.
Set `SMTP_USE_TLS=false` if the relay doesn't require TLS (internal only).

---

## 4. Environment File

Create `.env.prod` in the project root — **never commit this file**.

```env
# ── Database ──────────────────────────────────────────────────────────────────
DB_USER=ffd
DB_PASSWORD=<strong random password>

# ── Auth ──────────────────────────────────────────────────────────────────────
SECRET_KEY=<output of: openssl rand -hex 32>
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7

# ── OCI Object Storage ────────────────────────────────────────────────────────
OCI_BUCKET_NAME=ffd-documents
OCI_REGION=me-dubai-1
OCI_NAMESPACE=<your object storage namespace>

# ── Email (Outlook / Office 365) ──────────────────────────────────────────────
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USE_TLS=true
SMTP_USERNAME=notifications@yourcompany.com
SMTP_PASSWORD=<password or app password>
SMTP_SENDER_EMAIL=notifications@yourcompany.com

# ── AI (daily report summary) ─────────────────────────────────────
ANTHROPIC_API_KEY=<anthropic api key>

# ── App ───────────────────────────────────────────────────────────────────────
FRONTEND_URL=http://<server-ip>
ENVIRONMENT=development
```

> Keep `ENVIRONMENT=development` until HTTPS is configured. Production mode sets
> `Secure` cookies which require HTTPS — the app will break on plain HTTP.

> Do **not** add `OCI_ACCESS_KEY`, `OCI_SECRET_KEY`, or `OCI_ENDPOINT_URL`.
> These are the old S3-compatible credentials — they are unreliable on new OCI
> Identity Domain accounts. Instance Principals are used instead.

---

## 5. Server Setup

### SSH

```bash
# Fix key permissions (Linux/macOS)
chmod 400 /path/to/key.key

# Windows
icacls "C:\path\to\key.key" /inheritance:r
icacls "C:\path\to\key.key" /grant:r "%USERNAME%:(R)"

ssh -i /path/to/key.key ubuntu@<SERVER_IP>
```

### Swap (important on small VMs)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Docker

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

Verify: `docker compose version`

---

## 6. Transfer Files

```bash
# From local machine
scp -i /path/to/key.key -r /path/to/ffd-tracker ubuntu@<SERVER_IP>:~/ffd-tracker
scp -i /path/to/key.key /path/to/.env.prod ubuntu@<SERVER_IP>:~/ffd-tracker/.env.prod

# Fix permissions
ssh -i /path/to/key.key ubuntu@<SERVER_IP> "chmod u+w ~/ffd-tracker"
```

---

## 7. Deploy

```bash
cd ~/ffd-tracker
docker compose -f docker-compose.prod.yml up -d --build
```

First build: 5–10 minutes (OCI SDK is ~150 MB).

### Database migrations

```bash
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
docker compose -f docker-compose.prod.yml exec backend alembic current
# Expected output: <revision hash> (head)
```

### Create first admin user

```bash
docker compose -f docker-compose.prod.yml exec backend python -c "
import asyncio, uuid
from app.database import AsyncSessionLocal
from app.auth.models import User
from app.auth.service import hash_password

async def run():
    async with AsyncSessionLocal() as db:
        db.add(User(
            id=uuid.uuid4(),
            email='admin@yourcompany.com',
            full_name='Admin',
            hashed_password=hash_password('ChangeMe@123'),
            team='MANAGEMENT',
            is_active=True,
            is_admin=True,
        ))
        await db.commit()
        print('Admin created')

asyncio.run(run())
"
```

---

## 8. Verify

```bash
# All 6 containers healthy
docker compose -f docker-compose.prod.yml ps

# Instance Principals working
docker compose -f docker-compose.prod.yml exec backend python -c "
import oci
signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
client = oci.object_storage.ObjectStorageClient(config={}, signer=signer)
print('OCI namespace:', client.get_namespace().data)
"

# Test email (replace address)
docker compose -f docker-compose.prod.yml exec backend python -c "
import asyncio
from app.notifications.providers.smtp import SmtpProvider
asyncio.run(SmtpProvider().send('you@yourcompany.com', 'Test', '<p>Test email from FFD Tracker</p>'))
print('Email sent')
"
```

Open browser: `http://<SERVER_IP>`

---

## 9. Updating the App

```bash
# Copy changed files
scp -i /path/to/key.key /local/path/to/file.py ubuntu@<SERVER_IP>:/home/ubuntu/ffd-tracker/path/to/file.py

# On server — rebuild only changed service
cd ~/ffd-tracker
docker compose -f docker-compose.prod.yml up -d --build backend worker beat
# OR rebuild frontend if frontend files changed:
docker compose -f docker-compose.prod.yml up -d --build frontend

# If DB schema changed
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
```

> **Important:** After rebuilding the backend, always restart the frontend to clear
> nginx's cached IP for the backend container:
> ```bash
> docker compose -f docker-compose.prod.yml restart frontend
> ```

---

## 10. Gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| Login flashes then logs out | `ENVIRONMENT=production` requires HTTPS for secure cookies | Keep `ENVIRONMENT=development` until SSL is set up |
| 502 Bad Gateway after backend restart | nginx caches the backend container's IP | `docker compose -f docker-compose.prod.yml restart frontend` |
| Instance Principals `401` | Dynamic Group or Policy not created, or wrong compartment level | Policy must be at root tenancy; wait 2 min after creation |
| App loads on :3000 but not :80 | Wrong compose file used | Always use `-f docker-compose.prod.yml` |
| SMTP `SMTPAuthenticationError` | SMTP AUTH disabled on the mailbox | Enable SMTP AUTH in Exchange Admin Center for that mailbox |
| SMTP `SMTPConnectError` | Wrong host/port or firewall blocking outbound 587 | Check OCI security list allows outbound 587; verify `SMTP_HOST` |
| OCI SDK not found | `oci` package not installed | Ensure `oci>=2.0.0` is in `requirements.txt` and image was rebuilt |

---

## 11. Other notes


- [ ] Set `ENVIRONMENT=production` after HTTPS is live

- [ ] Remove port 8000 from OCI security list (backend must not be publicly accessible)
