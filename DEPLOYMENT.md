# FFD Tracker — Production Deployment Guide

## Prerequisites
- OCI account created
- Project files on local machine
- SSH key pair (private `.key` file saved securely)

---

## 1. OCI Compute Instance

1. Log in to [cloud.oracle.com](https://cloud.oracle.com)
2. Switch region to **UAE East (Dubai)** — `me-dubai-1`
3. **Compute → Instances → Create Instance**
   - Name: `ffd-tracker-prod`
   - Image: **Canonical Ubuntu 22.04**
   - Shape: **VM.Standard.A1.Flex** (free) → 2 OCPUs, 12 GB RAM
     - If out of capacity: **VM.Standard.E4.Flex** (paid ~€22/month) → 1 OCPU, 4 GB RAM
   - Generate SSH key pair — download **both** files
4. **Open firewall ports** (Networking → Subnet → Security tab → Add Ingress Rules):
   - TCP port 22 (SSH)
   - TCP port 80 (HTTP)
5. Note the **Public IP address**

> **SSH username:** `ubuntu` (not `opc`, even on OCI)

---

## 2. OCI Object Storage

1. **Storage → Object Storage → Buckets → Create Bucket**
   - Name: `ffd-documents`
   - Tier: Standard, Visibility: Private
2. Get your **namespace**: Profile icon → Tenancy → Object Storage Namespace

### Instance Principals (authentication method used)

The backend authenticates to Object Storage using **Instance Principals** — the compute instance proves its own identity automatically, no credentials needed in `.env.prod`.

**One-time setup in OCI Console:**

**a) Create Dynamic Group** — Identity & Security → Domains → Default Domain → Dynamic Groups → Create
- Name: `ffd-tracker-instances`
- Rule: `ANY {instance.id = '<your-instance-ocid>'}`
- Find your instance OCID: Compute → Instances → click your instance

**b) Create Policy** — Identity & Security → Policies → Create Policy
- Name: `ffd-tracker-storage`
- Compartment: **root** (`hassanzia04 (root)`)
- Click **"Show manual editor"** and enter:
  ```
  Allow dynamic-group ffd-tracker-instances to manage objects in tenancy
  ```

> **Note:** Policy must be at root compartment level to work. Allow 1-2 minutes for propagation after creation.

---

## 3. Gmail Setup (email notifications)

The app uses Gmail OAuth2 to send emails (invitations, notifications).

### One-time token generation (run locally)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → Create project
2. Enable the **Gmail API**
3. Configure OAuth Consent Screen (External) → add your Gmail as a test user under **Audience**
4. Credentials → Create Credentials → OAuth 2.0 Client ID → Desktop App
5. Download the JSON → save as `backend/credentials/gmail_credentials.json`
   - Windows adds `.json` automatically — rename if it becomes `.json.json`
6. Run the token generator:
   ```powershell
   cd "d:\Professional Projects\The FFD Tracker\backend"
   pip install google-auth-oauthlib
   python generate_gmail_token.py
   ```
7. A browser window opens — log in and approve
8. Copy the full JSON output into `GMAIL_TOKEN_DATA` in `.env.prod`
9. Set `GMAIL_SENDER_EMAIL` to the Gmail address you authorized

---

## 4. Prepare Production Files (local machine)

Create `.env.prod` in the project root (never commit this file):

```
DB_USER=ffd
DB_PASSWORD=<strong password>

OCI_BUCKET_NAME=ffd-documents
OCI_REGION=me-dubai-1
OCI_NAMESPACE=<your object storage namespace>

SECRET_KEY=<run: openssl rand -hex 32>
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7

EMAIL_PROVIDER=gmail
GMAIL_SENDER_EMAIL=<your gmail address>
GMAIL_TOKEN_DATA=<full JSON from generate_gmail_token.py>

ANTHROPIC_API_KEY=<your Anthropic API key>

FRONTEND_URL=http://<your-server-ip>
ENVIRONMENT=development
```

> **Note:** Keep `ENVIRONMENT=development` while running on plain HTTP (no HTTPS/domain).
> The app uses `secure=True` cookies in production mode which requires HTTPS.
> Change to `ENVIRONMENT=production` only after setting up SSL.

> **Do NOT add** `OCI_ACCESS_KEY`, `OCI_SECRET_KEY`, or `OCI_ENDPOINT_URL` — those were the old
> S3-compatible credentials which are unreliable on new OCI accounts. Instance Principals are used instead.

---

## 5. Server Setup

### SSH in
```powershell
# Fix key permissions (Windows)
icacls "C:\path\to\key.key" /inheritance:r
icacls "C:\path\to\key.key" /grant:r "$($env:USERNAME):(R)"

ssh -i "C:\path\to\key.key" ubuntu@<SERVER_IP>
```

### Add swap space (critical for small VMs)
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Install Docker
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in, then verify:
```bash
docker --version
docker compose version
```

---

## 6. Transfer Files

From local PowerShell:
```powershell
$key = "C:\Users\hassa\Downloads\ssh-key-2026-06-05.key"
$server = "ubuntu@141.145.147.229"

scp -i $key -r "d:\Professional Projects\The FFD Tracker" "${server}:~/ffd-tracker"
scp -i $key "d:\Professional Projects\The FFD Tracker\.env.prod" "${server}:~/ffd-tracker/.env.prod"
```

Fix folder permissions on server:
```bash
chmod u+w ~/ffd-tracker
```

---

## 7. Deploy

```bash
cd ~/ffd-tracker
docker compose -f docker-compose.prod.yml up -d --build
```

First build takes 5–10 minutes (OCI SDK is large).

### Run database migrations
```bash
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
```

Verify:
```bash
docker compose -f docker-compose.prod.yml exec backend alembic current
# Should show: <hash> (head)
```

### Create first admin user
```bash
docker compose -f docker-compose.prod.yml exec backend python -c "
import asyncio
from app.database import AsyncSessionLocal
from app.auth.models import User
from app.auth.service import hash_password
import uuid

async def create_admin():
    async with AsyncSessionLocal() as db:
        user = User(
            id=uuid.uuid4(),
            email='admin@example.com',
            full_name='Admin',
            hashed_password=hash_password('YourPassword@123'),
            team='MANAGEMENT',
            is_active=True,
            is_admin=True
        )
        db.add(user)
        await db.commit()
        print('Admin created successfully')

asyncio.run(create_admin())
"
```

---

## 8. Verify

```bash
docker compose -f docker-compose.prod.yml ps
# All 6 containers should show as running/healthy:
# db, redis, backend, worker, beat, frontend
```

Test Instance Principals are working:
```bash
docker compose exec backend python -c "
import oci
signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
client = oci.object_storage.ObjectStorageClient(config={}, signer=signer)
print('Namespace:', client.get_namespace().data)
"
# Should print: Namespace: ax8ewlrggvoe
```

Open browser: `http://<SERVER_IP>`

---

## Known Gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| Login flashes then logs out | `ENVIRONMENT=production` sets secure cookies, requires HTTPS | Keep `ENVIRONMENT=development` until HTTPS is set up |
| 502 Bad Gateway after restart | Nginx caches backend container IP | Always restart frontend after restarting backend: `docker compose restart frontend` |
| `Permission denied` on .env.prod | Folder has no write permission | `chmod u+w ~/ffd-tracker` |
| SSH `Permission denied (publickey)` on Windows | Key file permissions too open | `icacls key.key /inheritance:r && icacls key.key /grant:r "$($env:USERNAME):(R)"` |
| A1.Flex out of capacity | OCI free tier exhausted | Try different AD, or use E4.Flex paid (~€22/month) |
| Document uploads fail with `SignatureDoesNotMatch` | Old S3-compatible credentials don't work on new OCI Identity Domain accounts | Use Instance Principals instead (current setup) |
| Instance Principals `401 authorization failed` | Dynamic Group or Policy not yet created / wrong compartment | Create policy at root tenancy level; wait 1-2 min for propagation |
| `nano: command not found` on server | Minimal Ubuntu image | Use `vi` or `sed` commands to edit files |
| `$host` variable error in PowerShell | `$host` is a reserved PowerShell variable | Use `$server` instead |
| App loads on port 3000 but not port 80 / nginx missing | Ran `docker compose up` without `-f docker-compose.prod.yml` — uses dev config | Always use `docker compose -f docker-compose.prod.yml up -d --build` on the server |

---

## Updating the App

After making changes locally:

```powershell
$key = "C:\Users\hassa\Downloads\ssh-key-2026-06-05.key"
$server = "ubuntu@141.145.147.229"

# Copy specific changed files
scp -i $key "d:\Professional Projects\The FFD Tracker\backend\app\some\file.py" "${server}:/home/ubuntu/ffd-tracker/backend/app/some/file.py"
```

On server:
```bash
cd ~/ffd-tracker
docker compose -f docker-compose.prod.yml up -d --build

# If database schema changed:
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
```

> **Tip:** Set up a GitHub private repo and use `git pull` on the server instead of scp — much faster for updates.

---

## Still To Do

- [x] Gmail API setup (email notifications)
- [x] Document uploads via OCI Instance Principals
- [ ] Domain name + HTTPS/SSL (Let's Encrypt)
- [ ] Set `ENVIRONMENT=production` after HTTPS is live
- [ ] Set up GitHub repo for easier deployments
- [ ] Remove port 8000 from OCI security list (backend should not be publicly accessible)
- [ ] Upgrade VM from VM.Standard.E2.1.Micro (1GB RAM) to larger shape
