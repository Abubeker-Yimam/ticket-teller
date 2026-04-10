# Setting Up the Google Sheets Partner Registry

This guide walks you through creating a Google Cloud service account so your
notification server can securely read the partner registry from Google Sheets.

---

## Step 1 — Create a Google Cloud Project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project** → **New Project**
3. Name it `referral-notifier` and click **Create**

---

## Step 2 — Enable the Google Sheets API

1. In your new project, go to **APIs & Services → Library**
2. Search for **Google Sheets API**
3. Click **Enable**

---

## Step 3 — Create a Service Account

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → Service Account**
3. Name: `referral-notifier-reader`
4. Role: **Viewer** (read-only access is sufficient)
5. Click **Done**

---

## Step 4 — Download the JSON Key

1. Click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key → Create new key → JSON**
4. The file downloads automatically — rename it to `service-account.json`
5. Move it into the root of this project (same folder as `server.js`)

> ⚠️ `service-account.json` is already listed in `.gitignore`. Never commit this file.

---

## Step 5 — Create the Google Sheet

1. Open [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Rename the first sheet tab to **`Partners`** (exact name — the API uses this)
3. Set up the headers in **row 1**:

| A | B | C | D | E |
|---|---|---|---|---|
| partner_id | name | email | commission_rate | active |

4. Add your partners starting from **row 2**:

| A | B | C | D | E |
|---|---|---|---|---|
| PARTNER_001 | Kwame Digital | kwame@example.com | 10% | TRUE |
| PARTNER_002 | Ama Events | ama@example.com | 12% | TRUE |
| PARTNER_003 | Kofi Media | kofi@example.com | 8% | FALSE |

**Column notes:**
- `partner_id`: Must match the `?ref=` value in the Ticket Tailor link exactly (case-insensitive at runtime)
- `commission_rate`: Enter as percentage string e.g. `10%` — the server converts to decimal
- `active`: Must be exactly `TRUE` or `FALSE`. Set `FALSE` to pause a partner without deleting them.

---

## Step 6 — Share the Sheet with the Service Account

1. In your Google Sheet, click the **Share** button (top right)
2. Paste the service account email — it looks like:
   ```
   referral-notifier-reader@your-project-id.iam.gserviceaccount.com
   ```
   (You can find this in `service-account.json` under the `client_email` field)
3. Set permission to **Viewer**
4. Click **Share**

---

## Step 7 — Get the Sheet ID

The Sheet ID is in the URL:
```
https://docs.google.com/spreadsheets/d/SHEET_ID_IS_HERE/edit
```

Copy that value and paste it into your `.env`:
```env
SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
REGISTRY_MODE=sheets
```

---

## Step 8 — Test the Connection

Start the server and watch the logs:

```bash
npm run dev
```

When the first webhook fires, you should see:
```
[INFO] Partner registry: fetching from Google Sheets
[INFO] Partner registry loaded: 3 partners
```

Subsequent webhooks within 5 minutes will show:
```
[DEBUG] Partner registry: serving from cache
```

---

## Adding a New Partner (Ongoing)

1. Open the `Partners` sheet
2. Add a new row with their `partner_id`, `name`, `email`, `commission_rate`, `TRUE`
3. Send them the referral link: `https://buytickets.at/sunbolonsa?ref=PARTNER_ID`
4. The server picks up the change within **5 minutes** (next cache refresh)

No code changes. No redeployment. ✅
