# PulseWatch — Confirmed-Failure Uptime & API Monitoring

> Production-grade, zero-false-alarm uptime and API monitoring with tenant-isolated, write-only cryptography.
>
> 🌐 **Live Application:** [https://pulse-watch-frkc.onrender.com](https://pulse-watch-frkc.onrender.com)  
> 📹 **Project Demo Video:** [Watch on Google Drive](https://drive.google.com/file/d/1ipGOW05jMtICzXHwd5my_yWZTb7r8u19/view?usp=sharing)
>
> [![Demo Video](https://img.shields.io/badge/Demo_Video-Google_Drive-4285F4?style=for-the-badge&logo=googledrive&logoColor=white)](https://drive.google.com/file/d/1ipGOW05jMtICzXHwd5my_yWZTb7r8u19/view?usp=sharing)

> [![Live App](https://img.shields.io/badge/Live_App-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://pulse-watch-frkc.onrender.com)

---

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Target Users & Personas](#2-target-users--personas)
- [3. Solution & Core Innovations](#3-solution--core-innovations)
- [4. Plain-English Concept Guide & Terminology](#4-plain-english-concept-guide--terminology)
- [5. Getting Started & User Journey](#5-getting-started--user-journey)
- [6. Key Features & Workflows](#6-key-features--workflows)
- [7. System Architecture & Data Flow](#7-system-architecture--data-flow)
- [8. Deep Security Model & Cryptography](#8-deep-security-model--cryptography)
- [9. Confirmed-Failure Ping Engine](#9-confirmed-failure-ping-engine)
- [10. Strict Domain Ownership Proof System](#10-strict-domain-ownership-proof-system)
- [11. Multi-Channel Alert Dispatcher](#11-multi-channel-alert-dispatcher)
- [12. High-Availability Scheduler & Leader Election](#12-high-availability-scheduler--leader-election)
- [13. Billing & Subscription Management (Razorpay)](#13-billing--subscription-management-razorpay)
- [14. Public Status Pages](#14-public-status-pages)
- [15. Complete API Reference](#15-complete-api-reference)
- [16. Tech Stack & Engineering Rationale](#16-tech-stack--engineering-rationale)
- [17. Local Setup & Configuration](#17-local-setup--configuration)
- [18. Production Deployment](#18-production-deployment)
- [19. Automated Testing & Verification](#19-automated-testing--verification)
- [20. Frequently Asked Questions (FAQ)](#20-frequently-asked-questions-faq)

---

## 1. Problem Statement

Modern microservices, APIs, and web applications experience transient network glitches, socket resets, and short load-balancer restarts. Conventional monitoring tools frequently trigger immediate alerts on a single dropped packet, waking on-call engineers at 3:00 AM for non-issues and inducing **alert fatigue**. When genuine outages occur, teams are often desensitized to notifications.

Moreover, traditional monitoring platforms store sensitive customer secrets—such as authorization tokens, API keys, basic authentication credentials, and private webhook endpoints—in plaintext or reversibly encrypted formats in their databases. A compromised database or backup immediately exposes live production credentials across all monitored systems.

---

## 2. Target Users & Personas

- **SRE & DevOps Engineers**: Require deterministic, noise-free monitoring for mission-critical infrastructure, background microservices, and databases without false alarms.
- **SaaS Founders & CTOs**: Need transparent, branded status pages (`/status/<slug>`) to communicate operational health to customers while guaranteeing internal endpoints and tokens remain completely private.
- **On-Call Engineering Teams**: Rely on actionable multi-channel notifications (Slack, Discord, Email, Webhooks) that trigger only when an incident is verified and provide instant downtime duration upon recovery.

---

## 3. Solution & Core Innovations

1. **The 3-Knock Confirmed Failure Rule**: PulseWatch never alerts on a single failed check. A target is marked `DOWN` only after three consecutive failed attempts, spaced 5 seconds apart. A transient packet drop is logged and ignored.
2. **Write-Only Zero-Knowledge Secrets**: Monitor URLs, custom HTTP headers, and request bodies are encrypted with **AES-256-GCM** using keys derived via **HKDF** uniquely per tenant, record, and field (`ws:<workspace>:monitor:<id>:<field>`). Even database administrators cannot view stored secrets; they can only be replaced.
3. **Strict Domain Ownership Verification**: Outbound pings are strictly restricted to domains proven to belong to the workspace via DNS TXT records (`_pulsewatch.<domain>`) or HTTP `.well-known` proof files. Redirects hopping outside verified domains are immediately intercepted and blocked.
4. **Socket-Level SSRF Guard**: Outbound HTTP agents enforce connect-time DNS validation on the initial request and every subsequent redirect, rejecting private, loopback, link-local, carrier-grade NAT, or reserved IPv4/IPv6 ranges to prevent SSRF and internal port scanning.
5. **Distributed Leader Lease**: Multiple backend instances can be deployed in high-availability clusters. A distributed MongoDB lease guarantees exactly one instance executes scheduled checks and rollups, with automated ~30-second failover.

---

## 4. Plain-English Concept Guide & Terminology

### The Shop Analogy
Think of your website or API like a **shop**:
- Customers can only buy things when the front door is unlocked and open.
- Sometimes the door gets stuck—the server crashes, an upstream database times out, or a bad deploy breaks routing. Often **you don't even know it happened** until customers complain.
- PulseWatch acts like a **vigilant guard** who visits your shop's door every minute, knocks, and checks that it opens. The moment the door is stuck, the guard calls you so you can fix it immediately.
- It also watches hidden back-end **APIs**—which are like the kitchen behind a restaurant. Customers never see the kitchen, but if it stops running, nobody gets served.

```
🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🔴🔴🔴🔴🟢🟢🟢🟢🟢🟢
 each dot = one check · green = healthy (200 OK) · red = confirmed outage
```

### Core Terminology

| Term | What It Means |
| :--- | :--- |
| **Monitor** | A single watched target (e.g. `https://api.myshop.com/health`). |
| **Check** | A single inspection. PulseWatch sends a request, verifies response headers/body, and records latency. |
| 🟢 **Up** | Working normally. Target answered within timeout and satisfied all assertions. |
| 🔴 **Down** | Confirmed broken. Three consecutive checks failed 5 seconds apart. |
| 🟡 **Checking** | Newly added monitor undergoing its initial background verification. |
| ⚪ **Paused** | Temporarily deactivated during planned maintenance. Checks and alerts are suspended. |
| **Incident** | The duration from when a service is confirmed down until it recovers (e.g., "Down for 4m 12s"). |
| **Alert Channel** | A notification destination: Slack webhook, Discord webhook, Email, or generic JSON Webhook. |
| **Uptime %** | Percentage of operational time over a period. `99.9%` equals roughly 43 minutes of total downtime in a month. |
| **Response Time** | Time taken for the target to respond in milliseconds (`1,000 ms = 1 second`). Lower is faster. |
| **Status Page** | A public, customer-facing web page showing operational health without exposing internal URLs. |
| **Workspace** | A dedicated multi-tenant space containing monitors, team members, alert channels, and billing. |

---

## 5. Getting Started & User Journey

### Step 1: Account & Workspace Creation
1. Navigate to the web application at `http://localhost:5173` (or your deployed URL).
2. Click **"Start free"** and enter your name, company name, work email, and a strong password.
3. PulseWatch automatically provisions a multi-tenant workspace for your organization.
4. *(Optional)* Click **"Explore the demo"** on the landing page for instant one-click access with pre-configured monitors.

### Step 2: Email Confirmation
Confirm your email address via the link delivered to your inbox (in development, all verification links are printed directly to the server log).

### Step 3: Domain Ownership Proof
Before monitoring a website, prove ownership under the **Domains** tab:
- **DNS TXT Option**: Add a TXT record to your DNS zone:
  - Host: `_pulsewatch.yourdomain.com`
  - Value: `pulsewatch-verify=<your-unique-token>`
- **HTTP File Option**: Upload a file to:
  - `https://yourdomain.com/.well-known/pulsewatch-verify.txt` containing your token.
- Click **"Verify now"**. Once green, click **"Test connection"** to verify firewall reachability.

### Step 4: Add Your First Monitor
1. On the Dashboard, click **"New monitor"**.
2. Enter the target URL (e.g. `https://yourdomain.com/api/health`).
3. Select an interval (`30s`, `60s`, `5 min`, `15 min`).
4. *(Optional)* Configure HTTP Method (`GET`, `POST`, `PUT`, `HEAD`), custom headers, JSON payload, and status code / body keyword assertions.
5. Click **"Start monitoring"**. The initial check runs immediately.

### Step 5: Configure Alert Channels
1. Open **Alerts → Add channel**.
2. Select your provider (**Slack**, **Discord**, **Email**, or **Webhook**).
3. Paste the destination address and click **"Save & send test"**.
4. Edit your monitor and check the box to link the alert channel.

---

## 6. Key Features & Workflows

### Multi-Protocol HTTP/HTTPS Assertions
- Supports `GET`, `POST`, `PUT`, and `HEAD` requests.
- Custom payload delivery with automatic `application/json` detection.
- Configurable expected HTTP status codes (e.g., `200`, `201`, `204`, `301`, `302`).
- Case-sensitive response body keyword validation.
- Configurable per-request timeouts (1 to 30 seconds).

### Real-Time Dashboard & Visualizations
- Real-time operational banner (*"All systems operational"* or active incident callouts).
- 4 key health indicators: **Overall Uptime**, **Average Response Time**, **Active Incidents**, and **Monitored Services**.
- **24-Hour Sparklines**: Latency micro-charts plotted across 24 hourly buckets.
- **30-Day Uptime Bars**: Daily interactive color-coded bars indicating uptime percentages.

### Team Collaboration & RBAC
### Enterprise Authentication & Verification Gate
- **Google OAuth 2.0 Integration**: One-click "Continue with Google" sign-in with instant email pre-verification and profile synchronization (just like Supabase/Firebase Auth).
- **Mandatory 6-Digit OTP Email Verification Gate**: Strictly blocks unverified or arbitrary email signups from entering the dashboard or using workspace features until their 6-digit code or link is confirmed.
- **Two-Factor Authentication (TOTP)**: RFC 6238-compliant authenticator app setup with QR code and single-use hashed recovery backup codes.
- **Rate-Limiting & Account Lockout**: Exponential backoff lockout defense against brute-force credential stuffing.

---

## 7. System Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client Browser (SPA)                          │
│        React 19 · Vite · Tailwind v4 · GSAP · Recharts · Lucide         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ /api (Vite Proxy in Dev / Same-Origin in Prod)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Express API Server                             │
│   - Helmet CSP & Headers     - Origin CSRF Guard    - Rate Limiter      │
│   - HttpOnly Session JWT     - Input Sanitization   - RBAC Middleware   │
└──────────────────┬─────────────────────────────────┬────────────────────┘
                   │                                 │
                   ▼                                 ▼
       ┌───────────────────────┐         ┌────────────────────────┐
       │   Controllers & API   │         │   Background Engine    │
       │  - Auth & TOTP 2FA    │         │  - Leader Election     │
       │  - Workspace Manager  │         │  - Dynamic Scheduler   │
       │  - Domain Verifier    │         │  - 24h & 30d Rollups   │
       │  - Billing (Razorpay) │         │  - Plan Enforcer       │
       └───────────┬───────────┘         └───────────┬────────────┘
                   │                                 │
                   ▼                                 ▼
       ┌──────────────────────────────────────────────────────────┐
       │                  Core Services Layer                     │
       │  - PingEngine (3-knock confirmed retry state machine)    │
       │  - SSRF Socket Guard (blocks non-unicast IP ranges)      │
       │  - Secrets Service (AES-256-GCM HKDF tenant encryption)  │
       │  - Alert Dispatcher (Slack, Discord, Email, Webhooks)    │
       └────────────────────────────┬─────────────────────────────┘
                                    │
                                    ▼
       ┌──────────────────────────────────────────────────────────┐
       │                  MongoDB Atlas Cluster                   │
       │  - Users & Workspaces        - Monitors & Incidents      │
       │  - Domains & Proofs          - CheckLogs & DailyStats    │
       │  - Alert Channels            - Distributed Leases        │
       └──────────────────────────────────────────────────────────┘
```

### Complete Monitor Check Lifecycle

```text
Scheduler identifies due monitor (nextCheckAt <= now)
   ↓
Decrypt secrets in-memory (HKDF AES-256-GCM context: ws:<id>:monitor:<id>:<field>)
   ↓
Connect-time SSRF socket check & DNS resolution (verify public unicast IP)
   ↓
Knock 1 (Outbound HTTP request via guarded agent)
   ├─── Healthy? ──> Log CheckLog, update nextCheckAt, resolve any open incident.
   └─── Failed (Timeout, Error, Keyword Mismatch)?
           ↓
        Wait 5,000 ms ──> Knock 2 (Attempt 2)
           ├─── Healthy? ──> Transient blip ignored, no incident opened.
           └─── Failed?
                   ↓
                Wait 5,000 ms ──> Knock 3 (Attempt 3: Final Confirmation)
                   ├─── Healthy? ──> Recovered.
                   └─── Failed?
                           ↓
                        Confirmed Real Outage!
                           ↓
                        Open Incident Record (Monitor status -> DOWN)
                           ↓
                        Dispatch Alerts (Slack, Discord, Email, Webhook)
```

---

## 8. Deep Security Model & Cryptography

### Write-Only Authenticated Encryption (AES-256-GCM)
- Every customer secret (URLs with query tokens, custom authorization headers, basic auth passwords, request bodies, webhook endpoints) is encrypted prior to database insertion.
- Individual fields derive unique 256-bit keys using **HKDF-SHA256** with an authenticated context string: `ws:<workspaceId>:monitor:<monitorId>:<fieldName>`.
- Plaintext cannot be deserialized outside the runtime check execution. Stored values are masked in all API responses (`https://api.example.com?token=••••••`).
- Key rotation is supported via `ENCRYPTION_KEY_PREVIOUS`.

### Defense-in-Depth Measures
- **Socket-Level SSRF Guard**: The outbound HTTP agent binds to low-level socket connections (`guardedLookup`), re-resolving DNS on every redirect hop to prevent DNS rebinding attacks against loopback (`127.0.0.1`), private LANs (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), or link-local metadata services (`169.254.169.254`).
- **Origin-Checked CSRF Defense**: Non-GET/HEAD API requests reject unknown `Origin` headers, preventing cross-site state manipulation.
- **Account Lockout Protection**: 5 consecutive failed sign-in attempts lock the account exponentially (15m, 30m, 1h, doubling up to 24h).
- **Two-Factor Authentication (TOTP)**: RFC 6238 TOTP with encrypted secret seeds and single-use hashed recovery codes.
- **Session Security**: HS256 JWT sessions stored in `HttpOnly`, `SameSite=Lax`, `Secure` cookies with pinned algorithms and audience validation.

---

## 9. Confirmed-Failure Ping Engine

The engine identifies failures with high-resolution classification:
- `TIMEOUT`: Request exceeded timeout limit (`ECONNABORTED`, `ETIMEDOUT`).
- `DNS`: Host resolution failure (`ENOTFOUND`, `EAI_AGAIN`).
- `CONNECTION_REFUSED`: Host refused TCP connection (`ECONNREFUSED`).
- `CONNECTION_RESET`: Upstream firewall or server reset connection (`ECONNRESET`, `EPIPE`).
- `TLS`: SSL/TLS certificate invalid, self-signed, or expired.
- `STATUS_MISMATCH`: Target returned an unexpected status code (e.g. `500 Internal Server Error`).
- `KEYWORD_MISSING`: Expected substring missing from the response body.
- `BLOCKED_TARGET`: Host resolved to a prohibited private/reserved IP address.

---

## 10. Strict Domain Ownership Proof System

To prevent monitoring engines from being misused as distributed load generators or port scanners against third parties, PulseWatch requires domain proof before any monitor can be scheduled:

1. **DNS TXT Proof**: A TXT record placed at `_pulsewatch.<domain>` containing `pulsewatch-verify=<token>`.
2. **HTTP File Proof**: A plain text file uploaded to `https://<domain>/.well-known/pulsewatch-verify.txt`.
3. **Subdomain Coverage**: Proving `example.com` automatically covers `api.example.com` and `staging.example.com`.
4. **Automated Daily Re-Checks**: Domains are verified daily in the background. If a record is removed, monitors are paused automatically after 3 failures (`pausedByOwnership: true`) and re-activated upon re-verification.

---

## 11. Multi-Channel Alert Dispatcher

Alerts are dispatched simultaneously to configured workspace channels with automated retries and delivery idempotency:

- **Slack Provider**: Formats rich Slack Block Kit notifications with monitor status, failure reason, and downtime duration.
- **Discord Provider**: Sends color-coded Discord webhook embeds (Red for `DOWN`, Green for `RECOVERED`).
- **Email Provider**: Sends clean, transactional alerts via Nodemailer / Resend.
- **Generic Webhook Provider**: Dispatches JSON payloads containing monitor IDs, timestamps, event types, and incident duration to external automation pipelines (Zapier, n8n, PagerDuty).

---

## 12. High-Availability Scheduler & Leader Election

- **Distributed Lease**: MongoDB-backed atomic lease (`Lease` collection) ensures that across N instances, exactly one instance acts as the scheduler leader.
- **Heartbeat & Failover**: The active leader renews its lease every 10 seconds. If the leader crashes, standby nodes elect a new leader within ~30 seconds without double-checking targets.
- **Dynamic Worker Sweeps**: Due monitors are queried every 10 seconds (`nextCheckAt <= now`), prioritized, and executed concurrently using concurrency limiters (`p-limit`).

---

## 13. Billing & Subscription Management (Razorpay)

| Plan | Price (INR) | Monitors | Fastest Check | Alert Channels | Team Members |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Hobby** | Free | 5 | 60s | 5 | 2 |
| **Pro** | ₹999 / month · ₹9,588 / year | 50 | 30s | 25 | 10 |
| **Team** | ₹2,999 / month · ₹28,788 / year | 200 | 30s | 50 | 50 |

- **Security Verification**: Orders are generated server-side. Payment confirmation validates the `HMAC_SHA256(order_id|payment_id, secret)` signature.
- **Webhook Settle**: Webhooks at `/api/v1/billing/webhook` ensure subscriptions activate even if the buyer closes the checkout tab.
- **Prorated Upgrades & Stacking**: Renewing stacks time onto the existing period; upgrades credit unused time proportionally.

---

## 14. Public Status Pages

Each workspace includes a customizable public status page at `/status/<slug>`:
- **Zero-Secret Exposure**: Renders overall health, monitor names, status pills, and 24-hour latency curves without revealing URLs, headers, or internal network topology.
- **Individual Monitor Visibility**: Any monitor can be hidden from the status page via `showOnStatusPage: false`.
- **Auto-Polling**: The status page refreshes in the background every 30 seconds.

---

## 15. Complete API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Register new user, organization workspace, and trigger verification email |
| `POST` | `/api/v1/auth/login` | Authenticate credentials and receive HttpOnly session cookie |
| `POST` | `/api/v1/auth/logout` | Revoke session cookie |
| `POST` | `/api/v1/auth/demo` | Instant 1-click evaluation demo session (development mode) |
| `GET` | `/api/v1/auth/me` | Fetch active user session, workspace details, and permission roles |
| `GET` | `/api/v1/workspaces` | List member workspaces |
| `POST` | `/api/v1/domains` | Add domain for ownership verification |
| `POST` | `/api/v1/domains/:id/verify` | Verify domain via DNS TXT or HTTP `.well-known` proof |
| `GET` | `/api/v1/domains/:id/reachability` | Test domain reachability and firewall compatibility |
| `GET` | `/api/v1/monitors` | List workspace monitors |
| `POST` | `/api/v1/monitors` | Create encrypted monitor under verified domain |
| `GET` | `/api/v1/monitors/:id` | Fetch single monitor details |
| `PATCH` | `/api/v1/monitors/:id` | Update monitor settings |
| `POST` | `/api/v1/monitors/:id/toggle-pause` | Pause or resume monitoring |
| `POST` | `/api/v1/monitors/:id/check` | Trigger immediate manual check |
| `DELETE`| `/api/v1/monitors/:id` | Delete monitor and associated check history |
| `GET` | `/api/v1/alert-channels` | List configured notification channels |
| `POST` | `/api/v1/alert-channels` | Add Slack, Discord, Email, or Webhook target |
| `POST` | `/api/v1/alert-channels/:id/test` | Dispatch test notification to channel |
| `DELETE`| `/api/v1/alert-channels/:id` | Remove alert channel |
| `GET` | `/api/v1/dashboard/summary` | Real-time totals, latency sparklines, and active incidents |
| `GET` | `/api/v1/billing/plans` | Fetch available plans and pricing |
| `POST` | `/api/v1/billing/order` | Create Razorpay checkout order |
| `POST` | `/api/v1/billing/verify` | Verify payment HMAC-SHA256 signature and activate subscription |
| `POST` | `/api/v1/billing/webhook` | Raw byte webhook handler for asynchronous Razorpay events |
| `GET` | `/api/v1/public/status/:slug` | Public status page data |
| `GET` | `/health` | Server health check |

---

## 16. Tech Stack & Engineering Rationale

| Layer | Technology | Engineering Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | **React 19** | Latest React features, fine-grained state management, concurrent transitions. |
| **Bundler & Tooling** | **Vite 8** | Sub-second HMR, optimized production chunking, clean ES module output. |
| **Styling** | **Tailwind CSS v4** | Modern CSS theme tokens, zero-runtime overhead, responsive utility design. |
| **Animations** | **GSAP & Lenis** | Hardware-accelerated timeline animations and smooth scroll scrubbing. |
| **Backend Runtime** | **Node.js (ESM)** | Native ES Modules, non-blocking asynchronous event loop, fast HTTP processing. |
| **Server Framework** | **Express.js** | Battle-tested routing, robust middleware chaining, raw byte stream support. |
| **Database** | **MongoDB Atlas** | Document schema flexibility for varied check logs and compound indexing. |
| **Object Modeling** | **Mongoose** | Strict schema validation, middleware hooks, and lean query performance. |
| **Validation** | **Zod** | End-to-end type safety, runtime schema validation for API payloads. |
| **Cryptography** | **Node Crypto** | Hardware-accelerated AES-256-GCM authenticated cipher and HKDF key derivation. |
| **Payment Gateway** | **Razorpay REST API** | Direct REST integration avoiding bulky packages, native Indian UPI & card support. |

---

## 17. Local Setup & Configuration

### Prerequisites
- **Node.js**: `>= 20.0.0`
- **npm**: `>= 10.0.0`
- **MongoDB**: MongoDB Atlas connection string or local MongoDB instance

### Installation Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/pulse-watch.git
   cd pulse-watch
   ```

2. **Install all dependencies:**
   ```bash
   npm run install:all
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the `server/` directory:
   ```bash
   # server/.env
   PORT=5000
   NODE_ENV=development
   MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/pulse-watch
   JWT_SECRET=super_secret_jwt_key_replace_me_in_prod_must_be_32_chars
   ENCRYPTION_KEY=super_secret_encryption_key_replace_me_32_chars
   FRONTEND_URL=http://localhost:5173
   
   # SMTP Configuration (Resend or Ethereal)
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_USER=resend
   SMTP_PASS=your_resend_api_key
   SMTP_FROM=onboarding@resend.dev
   
   # Razorpay Test Mode Keys (Optional for local testing)
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   ```

4. **Start the Development Servers:**
   Open two terminal windows:
   ```bash
   # Terminal 1: Backend API Server
   npm run dev:server
   # Runs on http://localhost:5000
   
   # Terminal 2: Frontend Client
   npm run dev:client
   # Runs on http://localhost:5173
   ```

5. **Open the Application:**
   Visit `http://localhost:5173` in your browser. Click **"Explore the demo"** for immediate access.

---

## 18. Production Deployment

### Recommended: Single-Origin Deployment
In production, the Express backend serves the built React client directly from `client/dist`. This avoids cross-origin requests, eliminates CORS preflight overhead, and enables `__Host-` prefixed secure cookies.

```bash
# 1. Build client and install server dependencies
npm run build

# 2. Start production server
npm start
```

### Production Environment Settings
```ini
NODE_ENV=production
SERVE_CLIENT=true
PORT=5000
MONGO_URI=mongodb+srv://...
JWT_SECRET=...
ENCRYPTION_KEY=...
FRONTEND_URL=https://your-domain.com
```

- **Docker**: Build and run using the included production [`Dockerfile`](Dockerfile):
  ```bash
  docker build -t pulse-watch .
  docker run -p 5000:5000 --env-file server/.env pulse-watch
  ```
- **Render / Cloud**: Pre-configured blueprint included in [`render.yaml`](render.yaml).

---

## 19. Automated Testing & Verification

The repository includes a comprehensive 28-point integration test suite validating:
- MongoDB connection and multi-tenant schema isolation.
- AES-256-GCM write-only secret encryption and runtime decryption.
- PingEngine 3-knock confirmed-failure retry logic.
- Connect-time SSRF socket blocking on private IP ranges.
- Razorpay order creation and HMAC-SHA256 signature verification.
- Monitor CRUD, pausing, resumption, and instant checks.
- CSRF protection against unauthorized cross-origin POSTs.
- Public status page rendering without leaking secrets.

---

## 20. Frequently Asked Questions (FAQ)

#### Do I need to install software on my monitored servers?
No. PulseWatch monitors externally over HTTP/HTTPS, exactly like a real user visiting your site.

#### Will checks impact my website's performance?
No. A lightweight HTTP check every minute consumes virtually zero bandwidth or server capacity.

#### Why does PulseWatch report my site as down when it opens in my browser?
Some sites sit behind bot mitigation firewalls (Cloudflare, Akamai) that challenge automated requests. Add an allow-list rule for requests with the User-Agent starting with `PulseWatch/`.

#### Can PulseWatch monitor authenticated APIs?
Yes. On verified domains, select *"Does this API need a key?"* to provide Bearer tokens, custom API key headers, or Basic Auth credentials. All values are stored encrypted and write-only.

#### Can I monitor a website I don't own?
No. PulseWatch strictly requires domain ownership proof (DNS TXT or HTTP `.well-known` token) before checks can be scheduled.

---

## License

Distributed under the **MIT License**. See `LICENSE` for details.
