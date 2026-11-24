/** Google Apps Script Web App URL (`.env`, `.env.production`, or hosting env vars) */
import { getMarketingAttributionFields } from './marketingAttribution'

const SUBMIT_TIMEOUT_MS = 45_000

export type SubmissionErrorKind = 'config' | 'network' | 'timeout' | 'server'

export class SubmissionError extends Error {
  readonly kind: SubmissionErrorKind

  constructor(message: string, kind: SubmissionErrorKind) {
    super(message)
    this.name = 'SubmissionError'
    this.kind = kind
  }
}

const SCRIPT_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec\/?$/

/**
 * Public Web App URL. Placeholder values from `.env.example` are treated as unset
 * so the form does not post to a deployment that does not exist yet.
 */
export function getGoogleScriptUrl() {
  const url = (import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined)?.trim() || ''
  if (!url || url.includes('YOUR_DEPLOYMENT_ID') || url.includes('YOUR_TEST_DEPLOYMENT_ID')) {
    return ''
  }
  if (!SCRIPT_URL_PATTERN.test(url)) return ''
  return url.replace(/\/$/, '')
}

export function isFormConfigured() {
  return Boolean(getGoogleScriptUrl())
}

export function getThankYouRedirectUrl() {
  if (typeof window === 'undefined') return '/thank-you'
  return `${window.location.origin}/thank-you`
}

export function createSubmissionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Submit lead to Google Apps Script, then the app navigates to /thank-you.
 * Uses form-urlencoded POST (same payload as a normal form submit).
 * `no-cors` is required: the deployed script's POST response is not CORS-readable, so a
 * normal fetch rejects even after the lead is saved. The response is therefore opaque —
 * only network failures and timeouts can be detected here.
 * `submissionId` lets the script ignore retries of a lead it already saved.
 */
export async function submitApplication(form: HTMLFormElement, submissionId: string): Promise<void> {
  const scriptUrl = getGoogleScriptUrl()
  if (!scriptUrl) {
    throw new SubmissionError('Form endpoint is not configured.', 'config')
  }

  const params = new URLSearchParams()
  new FormData(form).forEach((value, key) => {
    if (key === 'redirect_url' || key === 'fake-address') return
    params.append(key, String(value))
  })

  const attribution = getMarketingAttributionFields()
  params.set('applicant_source', attribution.source)
  params.set('applicant_utm_parameters', attribution.utmParameters)
  params.set('submission_id', submissionId)

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)

  try {
    await fetch(scriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params.toString(),
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SubmissionError('Request timed out.', 'timeout')
    }
    throw new SubmissionError(error instanceof Error ? error.message : 'Network error', 'network')
  } finally {
    window.clearTimeout(timeout)
  }
}
