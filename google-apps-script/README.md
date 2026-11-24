# EMORI lead capture (Google Apps Script + Resend)

The website posts franchise applications to a Google Apps Script Web App. The script validates the lead, appends it to the **Leads** tab of the spreadsheet **Emori Landing Page Leads**, then sends a notification through [Resend](https://resend.com). The Resend API key stays in Apps Script **Script Properties**. The browser never receives it.

The Web App URL is public. It is not a secret. Do not invent one — deploy the script, then paste the `/exec` URL you are given.

Placeholder until that URL exists:

```text
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

## What you configure manually

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| `VITE_GOOGLE_SCRIPT_URL` | Website `.env` (local) or host env (production) | Yes, for the form to submit | Public Web App `/exec` URL |
| `RESEND_API_KEY` | Apps Script → Project Settings → Script Properties | Yes, to send email | Resend secret. Never put this in a `VITE_` variable |
| `RESEND_FROM_EMAIL` | Script Properties | No | Verified sender. Default: `EMORI Franchise <contact@ifranchise.in>` |
| `LEAD_NOTIFICATION_EMAIL` | Script Properties | No | Inbox for new leads. Comma-separated is allowed. Default: `contact@ifranchise.in` |
| `SITE_URL` | Script Properties | No | Public site origin, no trailing slash. Used to fetch `/brand/emori-logo.webp` and to allow a `/thank-you` redirect |

`Code.gs` reads the Resend values with `PropertiesService.getScriptProperties()`. The Vite app does not read `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `LEAD_NOTIFICATION_EMAIL`, or `SITE_URL`.

## Spreadsheet structure

Bind the script to **Emori Landing Page Leads** (**Extensions → Apps Script** from that file). The script looks up a tab by the exact name `Leads`. It does not use the active tab, so an open `Sheet1` cannot receive new leads.

| Tab | What the script does |
| --- | --- |
| `Leads` | Canonical lead storage. Existing rows and extra columns stay. `setupSheet()` adds only missing headers, including `Submission ID`, in new columns to the right. Every new submission is appended here. |
| `Config` | Not read or written. Email settings come from Script Properties, not from this tab. Leave it in place. |
| `Sheet1` | Not read or written, and not deleted. It is safe for you to remove later only if you have checked that it contains no lead records you need. This script will not remove it. |

`setupSheet()` does not clear cells, delete rows, delete columns, or rename tabs. Historical leads remain on `Leads`. Older rows with a blank `Submission ID` are not backfilled. A later retry is ignored only when the same `submission_id` is already in that column, or in the 6-hour script cache.

## 1. Spreadsheet and script

1. Open **Emori Landing Page Leads**.
2. **Extensions → Apps Script**. This binds the script to that spreadsheet. A standalone script cannot see the **Leads** tab.
3. Replace `Code.gs` with `google-apps-script/Code.gs` from this repo. Save.
4. Optional: **Project Settings → Show "appsscript.json" manifest file**, then match `google-apps-script/appsscript.json` (timezone `Asia/Kolkata`, runtime V8). The Deploy dialog below is what actually publishes access.
5. Select `setupSheet` and click **Run**. Approve the spreadsheet permission. The dialog reports the tab it updated, how many existing lead rows were preserved, which headers were added, and which other tabs were left alone. Expect `Updated tab: Leads` and `Tabs not modified` to include `Sheet1` and `Config`.

## 2. Resend

1. In Resend, create an API key and verify the sender domain used by `RESEND_FROM_EMAIL`. Unverified domains only work with Resend’s onboarding sender (`onboarding@resend.dev`) and can only mail the Resend account owner.
2. In Apps Script, open **Project Settings** (gear) → **Script Properties** → **Add script property**.
3. Add `RESEND_API_KEY`. Add `RESEND_FROM_EMAIL`, `LEAD_NOTIFICATION_EMAIL`, and `SITE_URL` only when you want to override the defaults.
4. Select `testLeadEmail` and click **Run**. Approve the external-request permission. The Apps Script execution log (and a popup, when the editor can show one) reports success or the Resend error. This sends one test message and does not write a sheet row.

## 3. Deploy the Web App

1. **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. **Execute as:** Me (the account that owns the sheet).
4. **Who has access:** Anyone.
   "Only myself" or "Anyone with a Google account" makes the public form fail, because visitors are not signed in.
5. **Deploy**, authorize, and copy the Web App URL. It must end in `/exec`.
6. Open that URL in a browser. You should see **EMORI form endpoint is live**. A 404 means this version is not published.
7. Open `YOUR_EXEC_URL?check=email`. `configured` should be `true`. `apiKeyPresent` is `true` or `false`. The JSON must not contain the key itself.

Deployments do not track the editor automatically. After every change to `Code.gs`:

**Deploy → Manage deployments → pencil → Version → New version → Deploy.**

The `/exec` URL stays the same. Production keeps running the previous version until you do this.

## 4. Connect the website

Local development, in `.env`:

```bash
VITE_GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Replace `YOUR_DEPLOYMENT_ID` with the id from the URL you copied. Leave the placeholder in place until then — the form treats it as not configured and will not post.

Do not put the Resend key in `.env` as `VITE_RESEND_API_KEY` or any other `VITE_` name. Vite copies `VITE_` values into the public JavaScript bundle.

`.env.production` is the committed production URL. This setup does not change it. Publishing a **new version** of the deployment that URL already points at is what updates production behavior. Pointing production at a different deployment is a separate change — do that only when you intend to switch endpoints.

Preview builds (`npm run build:preview`) ignore the production URL. Set `VITE_PREVIEW_GOOGLE_SCRIPT_URL` to a **test** Web App before building a preview you want to submit from. Leave it unset to keep preview submissions disabled.

## What the script does on each submission

1. Drops the post when the hidden `fake-address` field is filled. The website removes that field before sending, so browser autofill does not block a real application.
2. Accepts `application/x-www-form-urlencoded` fields from the site (`applicant_full_name`, `applicant_email`, `applicant_phone`, `applicant_country_iso`, `applicant_country_code`, `applicant_state`, `applicant_city`, `applicant_budget`, `applicant_location`, `applicant_source`, `applicant_utm_parameters`, `submission_id`). A JSON body with the same camelCase names is also accepted.
3. Rejects missing or invalid name, email, phone, state, city, budget, or location. Phone rules match the website’s country list (India must be a 10-digit mobile starting 6–9). Other unknown country codes must be 8–15 digits. Values that start with `=`, `+`, `-`, or `@` are stored as text so they cannot run as sheet formulas.
4. Ignores a retry that sends the same `submission_id` (cache for 6 hours, and the **Submission ID** column after that). Two different submissions from the same person are kept.
5. Appends the row on **Leads** only, with **Email Status** `Pending`, then calls Resend. `Sheet1` and `Config` are not modified. If Resend fails, the row stays and **Email Status** records the error. The lead is not discarded because email failed.
6. Returns JSON. Validation failures return `{ "success": false, "error": "..." }`. Unexpected failures return a generic error and write the detail to the Apps Script execution log, not to the browser.

## CORS

Google’s Web App responds to `doPost` with a redirect and does not return CORS headers the browser can read. The site therefore posts `application/x-www-form-urlencoded` with `fetch` mode `no-cors` (see `src/lib/formSubmit.ts`).

That means:

- Network failures and the 45-second timeout are visible to the form.
- A saved lead, a duplicate, and a validation rejection all look the same to the browser once the request is sent. The form then opens `/thank-you`.
- The website already checks the same required fields before posting. Server validation still blocks empty or forged posts from being stored.
- Do not switch the client to `mode: "cors"` or to a JSON `Content-Type`. The preflight or the redirect will fail even when the lead was saved.

`redirect_url` is optional and unused by the website. It is honored only for `http://localhost` or the origin in `SITE_URL`, and only when the path is `/thank-you`.

## Logo

If `SITE_URL` is set, the script tries `{SITE_URL}/brand/emori-logo.webp`. This repo does not currently publish that file under `public/brand/`, so the fetch fails and the email uses the text wordmark. A logo failure does not fail the email. Add the file to the site and set `SITE_URL` when you want the image.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Form says it is not connected | `VITE_GOOGLE_SCRIPT_URL` is empty or still contains `YOUR_DEPLOYMENT_ID` |
| Browser shows a Google sign-in page, or the request fails | Redeploy with **Who has access: Anyone** and **Execute as: Me** |
| Sheet has no new row | Apps Script → Executions. Validation errors are logged as `Rejected lead:` |
| Row saved, **Email Status** empty | `RESEND_API_KEY` is missing. `?check=email` shows `apiKeyPresent: false` |
| Row saved, **Email Status** starts with `Failed` or `Config error` | Resend sender domain, from address, or recipient. Run `testLeadEmail` |
| Row saved, **Email Status** stays `Pending` | The execution stopped after the save and before the status update. Check Executions |
| Two rows for one click | The second post used a different `submission_id`. Retries from the form reuse the same id |
| Email has no logo | `SITE_URL` unset, or `/brand/emori-logo.webp` is not publicly reachable |
