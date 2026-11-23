# EMORI

Premium franchise landing experience for EMORI — luxury lab-grown diamond jewellery.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
npm run preview
```

## Cloudflare Workers preview

This repository is a Vite single-page app. Cloudflare serves the Vite `dist/` output as Worker Static Assets and routes unknown paths to `index.html` for React Router. The `/invitation` to `/contact` permanent redirect is defined in `public/_redirects`.

```bash
npm run preview:cloudflare
npm run deploy:cloudflare:preview
```

The first command builds the site and starts Wrangler's local Workers runtime. The second builds and deploys a separate `emori-landing-page-preview` Worker to its `workers.dev` URL. It does not attach `emori.ifranchise.in` or modify DNS.

### Build-time configuration

- `VITE_GOOGLE_SCRIPT_URL` is the public Google Apps Script web-app endpoint used by the browser form. Vite embeds `VITE_` values in the public client bundle. Set it in the build environment; do not use it for private credentials.
- Resend credentials and email settings remain in Google Apps Script **Script Properties** (`RESEND_API_KEY`, and optional `RESEND_FROM_EMAIL`, `LEAD_NOTIFICATION_EMAIL`, `SITE_URL`). They are not Cloudflare Worker secrets because the Worker does not send email or write to Sheets.
- Form submissions from a preview will reach whichever Apps Script URL was included at build time. Use a test Apps Script deployment and test sheet for end-to-end submissions; the production endpoint writes a lead and can send a real email.

### Production cutover (pending explicit approval)

After preview verification, deploy the production Worker with `wrangler deploy` and attach `emori.ifranchise.in` under the Worker’s **Settings → Domains & Routes → Add → Custom Domain**. Cloudflare will configure the required DNS routing when the custom domain is attached. Do not make this change until production cutover is approved. Keep the Vercel project and its DNS target available during validation; retire neither as part of preview setup.
