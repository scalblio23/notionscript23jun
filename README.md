# Notion Focus View Sync

Automatically assigns **Focus Slot 1–7** to the top 7 highest-priority open tasks in your Notion Task Database. Runs every 15 minutes via a Vercel cron job.

---

## How it works

1. Queries all tasks where `Status ≠ Done`, sorted by `Priority Score` ascending (lower = higher priority).
2. Clears `Focus Slot` on any task that shouldn't have one.
3. Assigns `Focus Slot 1` through `Focus Slot 7` to the top 7 tasks.
4. Skips API updates if a task's slot is already correct (minimises API calls).

---

## Project structure

```
notion-focus-view/
├── api/
│   ├── sync.js      # Core syncFocusSlots() logic
│   └── cron.js      # Vercel serverless function (cron endpoint)
├── .env.example     # Environment variable template
├── .gitignore
├── package.json
├── vercel.json      # Cron schedule (every 15 minutes)
└── README.md
```

---

## Step 1 — Create a Notion integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Click **+ New integration**.
3. Give it a name (e.g. "Focus View Sync") and select your workspace.
4. Under **Capabilities**, enable **Read content** and **Update content**.
5. Click **Submit** and copy the **Internal Integration Token** — this is your `NOTION_TOKEN`.

---

## Step 2 — Connect the integration to your Task Database

1. Open your **Task Database** in Notion.
2. Click the **`···`** menu (top-right of the page) → **Connections** → **Connect to** → find and select your integration.
3. The integration can now read and update that database.

---

## Step 3 — Find your Database ID

Your database URL looks like:

```
https://www.notion.so/myworkspace/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...
```

The 32-character string between the last `/` and the `?v=` is your `NOTION_DATABASE_ID`.

---

## Step 4 — Verify your Notion database properties

Ensure your Task Database has exactly these property names (case-sensitive):

| Property name  | Type   | Notes                          |
|----------------|--------|--------------------------------|
| `Priority Score` | Number | Lower value = higher priority |
| `Focus Slot`   | Number | Managed by this script        |
| `Status`       | Status | Completed tasks set to `Done` |

---

## Step 5 — Deploy to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

---

## Step 6 — Deploy to Vercel

### Via Vercel dashboard

1. Go to [https://vercel.com/new](https://vercel.com/new) and import your GitHub repository.
2. In the **Environment Variables** section, add:

   | Key | Value |
   |-----|-------|
   | `NOTION_TOKEN` | `secret_xxx...` from Step 1 |
   | `NOTION_DATABASE_ID` | 32-char ID from Step 3 |
   | `CRON_SECRET` | A random string — generate with `openssl rand -hex 32` |

3. Click **Deploy**.

### Via Vercel CLI

```bash
npm i -g vercel
vercel --prod
# Follow prompts, then add env vars:
vercel env add NOTION_TOKEN
vercel env add NOTION_DATABASE_ID
vercel env add CRON_SECRET
```

The cron job is defined in `vercel.json` and will run automatically every 15 minutes once deployed. Cron jobs require a **Vercel Pro** plan or higher.

---

## Running locally

```bash
cp .env.example .env
# Fill in your values in .env

npm install
npm run sync
```

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `NOTION_TOKEN` | Notion internal integration token |
| `NOTION_DATABASE_ID` | ID of your Task Database |
| `CRON_SECRET` | Bearer token that protects the `/api/cron` endpoint |
