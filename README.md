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

The first command builds the site and starts Wrangler's local Workers runtime. The second builds and deploys a separate `emori-landing-page-preview` Worker to its `workers.dev` URL. It does not attach `emori.ifranchise.in` or modify DNS. Preview builds leave form submissions disabled by default so they cannot write to the production lead sheet. For end-to-end testing, set `VITE_PREVIEW_GOOGLE_SCRIPT_URL` to a test Apps Script deployment before building; never point a preview at the production endpoint.

### Build-time configuration

- `VITE_GOOGLE_SCRIPT_URL` is the public Google Apps Script web-app endpoint used by the production browser form. Vite embeds `VITE_` values in the public client bundle via committed `.env.production`; do not use it for private credentials.
- `VITE_PREVIEW_GOOGLE_SCRIPT_URL` is optional and should point only to a test Apps Script deployment and test sheet. Leave it unset to keep preview submissions disabled.
- Resend credentials and email settings remain in Google Apps Script **Script Properties** (`RESEND_API_KEY`, and optional `RESEND_FROM_EMAIL`, `LEAD_NOTIFICATION_EMAIL`, `SITE_URL`). They are not Cloudflare Worker secrets because the Worker does not send email or write to Sheets.

### Production deployment

Deploy the production Worker with `wrangler deploy` and attach `emori.ifranchise.in` under the Worker’s **Settings → Domains & Routes → Add → Custom Domain**. Keep the existing Vercel DNS target available as a rollback path until production validation is complete.
