/**
 * EMORI Franchise Application → Google Sheets + Resend lead email
 *
 * Setup:
 * 1. Create a new Google Sheet.
 * 2. Extensions → Apps Script → paste this file → Save.
 * 3. Run `setupSheet` once (authorize when prompted). It updates headers on the
 *    existing **Leads** tab, including Submission ID, and does not change
 *    Sheet1, Config, or any existing lead rows.
 * 4. Project Settings (gear icon) → Script Properties → Add script property:
 *      RESEND_API_KEY = re_…
 *    Optional overrides: RESEND_FROM_EMAIL, LEAD_NOTIFICATION_EMAIL, SITE_URL.
 * 5. Run `testLeadEmail` once to verify email delivery.
 * 6. Deploy → New deployment → Web app.
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the /exec URL. Full steps: google-apps-script/README.md
 * 7. After later edits: Deploy → Manage deployments → Edit → New version
 *    (same URL). The live site keeps serving the previous version until you do this.
 *
 * Secrets live only in Script Properties — never in this file, the sheet, or the website .env.
 * Do not prefix Resend settings with VITE_. The browser cannot read them.
 */

// Canonical tab in the bound spreadsheet "Emori Landing Page Leads".
// Sheet1 and Config are never read, written, renamed, or deleted.
var SHEET_NAME = 'Leads'
var TIMEZONE = 'Asia/Kolkata'

var HEADERS = [
  'Submitted At',
  'Full Name',
  'Country ISO',
  'Country Code',
  'Phone',
  'Email',
  'State',
  'City',
  'Investment Budget',
  'Preferred Location',
  'Source',
  'UTM Parameters',
  'Email Status',
  'Submission ID',
]

/** Non-secret defaults, overridable via Script Properties. */
var EMAIL_DEFAULTS = {
  RESEND_FROM_EMAIL: 'EMORI Franchise <contact@ifranchise.in>',
  LEAD_NOTIFICATION_EMAIL: 'contact@ifranchise.in',
  SITE_URL: '',
}

function getBoundSpreadsheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  if (!spreadsheet) {
    throw new Error(
      'Bind this script to the leads spreadsheet (open Emori Landing Page Leads → Extensions → Apps Script). A standalone script cannot see the Leads tab.',
    )
  }
  return spreadsheet
}

function getLeadsSheet() {
  var spreadsheet = getBoundSpreadsheet()
  // Name lookup only. Never getActiveSheet(): that would follow whichever tab
  // is open and could write to Sheet1.
  var sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME)
  }
  assertLeadsSheet(sheet)
  return sheet
}

function assertLeadsSheet(sheet) {
  if (!sheet || sheet.getName() !== SHEET_NAME) {
    throw new Error('Refusing to read or write leads outside the Leads tab.')
  }
}

function setupSheet() {
  var spreadsheet = getBoundSpreadsheet()
  var sheet = getLeadsSheet()
  var before = getHeaderMap(sheet)
  var headerMap = ensureLeadHeaders(sheet)
  var added = []

  HEADERS.forEach(function (header) {
    if (!headerColumn(before, header) && headerColumn(headerMap, header)) added.push(header)
  })

  var preserved = Math.max(sheet.getLastRow() - 1, 0)
  var untouched = spreadsheet
    .getSheets()
    .map(function (item) {
      return item.getName()
    })
    .filter(function (name) {
      return name !== SHEET_NAME
    })

  var summary = [
    'Spreadsheet: ' + spreadsheet.getName(),
    'Updated tab: ' + sheet.getName(),
    'Existing lead rows preserved: ' + preserved,
    'Headers added: ' + (added.length ? added.join(', ') : '(none)'),
    'Tabs not modified: ' + (untouched.length ? untouched.join(', ') : '(none)'),
  ].join('\n')

  Logger.log(summary)

  try {
    SpreadsheetApp.getUi().alert(summary)
  } catch (error) {
    Logger.log('UI alert unavailable: ' + error)
  }
}

function getHeaderMap(sheet) {
  var lastColumn = sheet.getLastColumn()
  if (lastColumn < 1) return {}

  var headerRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
  var headerMap = {}

  headerRow.forEach(function (header, index) {
    var name = String(header || '').trim()
    if (name && !headerMap[name]) headerMap[name] = index + 1
  })

  return headerMap
}

function headerColumn(headerMap, header) {
  if (!headerMap) return 0
  if (headerMap[header]) return headerMap[header]

  var target = String(header || '').toLowerCase()
  var match = 0
  Object.keys(headerMap).forEach(function (name) {
    if (!match && String(name).toLowerCase() === target) match = headerMap[name]
  })
  return match
}

function ensureLeadHeaders(sheet) {
  assertLeadsSheet(sheet)

  // A completely empty Leads tab gets the header row once. A tab that already
  // has a header row or lead records is never cleared, rewritten, or deleted.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS)
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold')
    sheet.setFrozenRows(1)
    return getHeaderMap(sheet)
  }

  var headerMap = getHeaderMap(sheet)

  HEADERS.forEach(function (header) {
    if (headerColumn(headerMap, header)) return
    var nextColumn = Math.max(sheet.getLastColumn(), 0) + 1
    sheet.getRange(1, nextColumn).setValue(header).setFontWeight('bold')
    headerMap[header] = nextColumn
  })

  return headerMap
}

function getEmailSettings() {
  var props = PropertiesService.getScriptProperties()

  return {
    apiKey: String(props.getProperty('RESEND_API_KEY') || '').trim(),
    from: String(props.getProperty('RESEND_FROM_EMAIL') || EMAIL_DEFAULTS.RESEND_FROM_EMAIL).trim(),
    to: String(props.getProperty('LEAD_NOTIFICATION_EMAIL') || EMAIL_DEFAULTS.LEAD_NOTIFICATION_EMAIL).trim(),
    siteUrl: String(props.getProperty('SITE_URL') || EMAIL_DEFAULTS.SITE_URL || '')
      .trim()
      .replace(/\/$/, ''),
  }
}

function getEmailConfigReport() {
  var settings = getEmailSettings()

  var configError = validateEmailSettings(settings)

  // Served publicly via doGet(?check=email) — never include any part of the API key.
  return {
    configured: !configError,
    configError: configError || null,
    from: settings.from,
    to: settings.to,
    siteUrl: settings.siteUrl || null,
    apiKeyPresent: Boolean(settings.apiKey),
  }
}

var EMAIL_PATTERN = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/

/** Accepts `name@domain.tld` or `Display Name <name@domain.tld>`. */
function isValidSender(value) {
  var match = String(value).match(/^[^<>]*<([^<>]+)>$/)
  return EMAIL_PATTERN.test(match ? match[1].trim() : String(value).trim())
}

function parseRecipients(value) {
  return String(value)
    .split(',')
    .map(function (item) {
      return item.trim()
    })
    .filter(Boolean)
}

/** Returns an error message, or '' when settings are usable. */
function validateEmailSettings(settings) {
  if (!settings.apiKey) return 'RESEND_API_KEY is not set'
  if (!/^re_\S+$/.test(settings.apiKey)) return 'RESEND_API_KEY does not look like a Resend key (re_…)'
  if (!isValidSender(settings.from)) return 'RESEND_FROM_EMAIL is not a valid sender address'
  var recipients = parseRecipients(settings.to)
  if (!recipients.length || !recipients.every(function (r) { return EMAIL_PATTERN.test(r) })) {
    return 'LEAD_NOTIFICATION_EMAIL is not a valid email address'
  }
  return ''
}

/** Run from Apps Script editor to verify Resend is working. */
function testLeadEmail() {
  Logger.log('Spreadsheet: ' + SpreadsheetApp.getActiveSpreadsheet().getName())
  Logger.log('Email config: ' + JSON.stringify(getEmailConfigReport()))

  var result = sendLeadNotificationEmail({
    submittedAt: formatLeadDateTime(new Date()),
    fullName: 'Test Lead',
    countryIso: 'IN',
    countryCode: '91',
    phone: '9129130303',
    email: 'test@example.com',
    state: 'Delhi',
    city: 'New Delhi',
    budget: '₹1 Cr – ₹2 Cr',
    location: 'Metro / Tier-1',
  })

  var message = result.ok
    ? 'Test email sent to ' + getEmailSettings().to
    : 'Email failed: ' + result.message

  Logger.log(message)

  try {
    SpreadsheetApp.getUi().alert(message)
  } catch (error) {
    Logger.log('UI alert unavailable: ' + error)
  }
}

function doGet(e) {
  var params = (e && e.parameter) || {}

  if (params.check === 'email') {
    return jsonResponse(getEmailConfigReport())
  }

  // Visiting /exec in a browser should show this — if you see 404, redeploy the Web App.
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:24px;color:#111;">' +
      '<h2 style="margin:0 0 8px;">EMORI form endpoint is live</h2>' +
      '<p style="margin:0;color:#555;">You can submit franchise leads to this URL.</p>' +
      '</body></html>',
  )
}

var PHONE_RULES = {
  IN: { code: '91', pattern: /^[6-9]\d{9}$/ },
  US: { code: '1', pattern: /^\d{10}$/ },
  AE: { code: '971', pattern: /^\d{9}$/ },
  GB: { code: '44', pattern: /^\d{10}$/ },
  SG: { code: '65', pattern: /^\d{8}$/ },
  AU: { code: '61', pattern: /^\d{9}$/ },
  CA: { code: '1', pattern: /^\d{10}$/ },
}

function doPost(e) {
  try {
    if (!e) {
      return jsonResponse({ success: false, error: 'Invalid submission.' })
    }

    // Direct posts that fill the hidden autofill trap are dropped. The website
    // strips this field before sending, so a real browser submission is unaffected.
    if (isHoneypot(e)) {
      return jsonResponse({ success: true, message: 'Application received' })
    }

    var parsed
    try {
      parsed = readPayload(e)
    } catch (parseError) {
      Logger.log('Invalid lead payload: ' + parseError)
      return jsonResponse({ success: false, error: 'Invalid submission.' })
    }

    if (parsed.error) {
      Logger.log('Rejected lead: ' + parsed.error)
      return jsonResponse({ success: false, error: parsed.error })
    }

    var data = parsed.data
    var lock = LockService.getScriptLock()
    var locked = false

    try {
      lock.waitLock(20000)
      locked = true
    } catch (lockError) {
      Logger.log('Could not lock leads sheet: ' + lockError)
      return jsonResponse({ success: false, error: 'Server is busy. Please try again.' })
    }

    var sheet
    var rowNumber

    try {
      sheet = getLeadsSheet()
      ensureLeadHeaders(sheet)

      if (isDuplicateSubmission(sheet, data.submissionId)) {
        return jsonResponse({
          success: true,
          message: 'Application already received',
          duplicate: true,
        })
      }

      rowNumber = appendLeadRow(sheet, data, 'Pending')
      rememberSubmission(data.submissionId)
      SpreadsheetApp.flush()
    } finally {
      if (locked) {
        try {
          lock.releaseLock()
        } catch (releaseError) {
          Logger.log('Could not release lock: ' + releaseError)
        }
      }
    }

    // Save the row before emailing. A Resend failure must not drop the lead.
    var emailResult
    try {
      emailResult = sendLeadNotificationEmail(data)
    } catch (emailError) {
      Logger.log('Lead email failed: ' + emailError)
      emailResult = { ok: false, message: 'Failed: email provider error' }
    }

    try {
      setEmailStatus(sheet, rowNumber, emailStatusText(emailResult))
    } catch (statusError) {
      Logger.log('Could not update email status: ' + statusError)
    }

    var redirectUrl = getSafeRedirectUrl(e)
    if (redirectUrl) {
      return redirectHtml(redirectUrl)
    }

    // The website posts with no-cors and cannot read this body. Keep it free of
    // provider errors and the API key. Email detail stays on the Leads sheet.
    return jsonResponse({
      success: true,
      message: 'Application received',
      emailSent: emailResult.ok === true,
    })
  } catch (error) {
    Logger.log(error && error.stack ? error.stack : error)
    return jsonResponse({ success: false, error: 'Unable to save the application.' })
  }
}

function isHoneypot(e) {
  var params = (e && e.parameter) || {}
  if (String(params['fake-address'] || '').trim()) return true

  if (!e || !e.postData || e.postData.type !== 'application/json' || !e.postData.contents) {
    return false
  }

  try {
    var json = JSON.parse(e.postData.contents)
    return Boolean(json && String(json['fake-address'] || json.fakeAddress || '').trim())
  } catch (error) {
    return false
  }
}

function submissionCacheKey(submissionId) {
  return 'submission:' + submissionId
}

function rememberSubmission(submissionId) {
  if (!submissionId) return
  CacheService.getScriptCache().put(submissionCacheKey(submissionId), '1', 21600)
}

function isDuplicateSubmission(sheet, submissionId) {
  if (!submissionId) return false
  if (CacheService.getScriptCache().get(submissionCacheKey(submissionId))) return true
  return findSubmissionRow(sheet, submissionId) > 0
}

function findSubmissionRow(sheet, submissionId) {
  assertLeadsSheet(sheet)
  var col = headerColumn(getHeaderMap(sheet), 'Submission ID')
  if (!col) return 0

  var last = sheet.getLastRow()
  if (last < 2) return 0

  var values = sheet.getRange(2, col, last - 1, 1).getValues()
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === submissionId) return i + 2
  }
  return 0
}

function appendLeadRow(sheet, data, emailStatus) {
  assertLeadsSheet(sheet)
  var headerMap = ensureLeadHeaders(sheet)

  HEADERS.forEach(function (header) {
    if (!headerColumn(headerMap, header)) {
      throw new Error('Missing Leads column: ' + header)
    }
  })

  var width = Math.max(sheet.getLastColumn(), HEADERS.length)
  var row = []
  var values = {
    'Submitted At': data.submittedAt,
    'Full Name': data.fullName,
    'Country ISO': data.countryIso,
    'Country Code': data.countryCode,
    Phone: data.phone,
    Email: data.email,
    State: data.state,
    City: data.city,
    'Investment Budget': data.budget,
    'Preferred Location': data.location,
    Source: data.source,
    'UTM Parameters': data.utmParameters,
    'Email Status': emailStatus,
    'Submission ID': data.submissionId,
  }

  for (var i = 0; i < width; i++) row.push('')

  Object.keys(values).forEach(function (header) {
    var col = headerColumn(headerMap, header)
    if (col) row[col - 1] = safeSheetValue(values[header])
  })

  sheet.appendRow(row)
  return sheet.getLastRow()
}

function setEmailStatus(sheet, rowNumber, status) {
  if (!rowNumber) return
  assertLeadsSheet(sheet)
  var col = headerColumn(getHeaderMap(sheet), 'Email Status')
  if (!col) return
  sheet.getRange(rowNumber, col).setValue(safeSheetValue(status))
}

function emailStatusText(emailResult) {
  if (!emailResult) return 'Failed: email provider error'
  if (emailResult.ok) return emailResult.message || 'Sent'
  if (emailResult.skipped) return ''
  return String(emailResult.message || 'Failed').slice(0, 500)
}

/** Sheets treats values that start with =, +, -, or @ as formulas. */
function safeSheetValue(value) {
  var text = String(value == null ? '' : value)
  if (/^[=+\-@]/.test(text)) return "'" + text
  return text
}

function getSafeRedirectUrl(e) {
  var redirectUrl = String(((e && e.parameter) || {}).redirect_url || '').trim()
  if (!redirectUrl || redirectUrl.indexOf('@') !== -1 || redirectUrl.indexOf('\\') !== -1) return ''

  var match = redirectUrl.match(/^(https?):\/\/([^\/?#]+)(\/[^?#]*)?(\?[^#]*)?$/i)
  if (!match) return ''

  var protocol = match[1].toLowerCase()
  var host = match[2]
  var hostname = host.split(':')[0].toLowerCase()
  var pathname = match[3] || '/'
  var search = match[4] || ''
  var isLocal = hostname === 'localhost' || hostname === '127.0.0.1'

  if (protocol !== 'https' && !(protocol === 'http' && isLocal)) return ''
  if (pathname !== '/thank-you' && pathname !== '/thank-you/') return ''

  // Only redirect back to the configured public site. The website itself does not
  // send redirect_url; this guards manual posts against an open redirect.
  var siteMatch = String(getEmailSettings().siteUrl || '').match(/^https?:\/\/([^\/?#]+)/i)
  if (!siteMatch) return ''
  if (host.toLowerCase() !== siteMatch[1].toLowerCase() && !isLocal) return ''

  return protocol + '://' + host + pathname + search
}

function redirectHtml(url) {
  var safeUrl = String(url).replace(/"/g, '')
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="refresh" content="0;url=' +
      escapeHtml(safeUrl) +
      '">' +
      '<script>window.top.location.replace(' +
      JSON.stringify(safeUrl) +
      ');</script>' +
      '</head><body style="font-family:Arial,sans-serif;padding:24px;color:#111;">Redirecting…</body></html>',
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
}

function sendLeadNotificationEmail(data) {
  var settings = getEmailSettings()

  if (!settings.apiKey) {
    return {
      ok: false,
      message:
        'RESEND_API_KEY is not set. Add it in Apps Script → Project Settings → Script Properties.',
      skipped: true,
    }
  }

  var configError = validateEmailSettings(settings)
  if (configError) {
    Logger.log('Lead email not sent: ' + configError)
    return { ok: false, message: 'Config error: ' + configError }
  }

  var payload = {
    from: settings.from,
    to: parseRecipients(settings.to),
    reply_to: EMAIL_PATTERN.test(data.email) ? data.email : parseRecipients(settings.to)[0],
    subject: 'New EMORI Franchise Lead — ' + (data.fullName || 'Unknown'),
    html: buildLeadEmailHtml(data, false),
  }

  var withLogo = tryBuildLogoAttachment(settings.siteUrl)
  if (withLogo) {
    payload.html = buildLeadEmailHtml(data, true)
    payload.attachments = [withLogo]
  }

  var response = UrlFetchApp.fetch('https://api.resend.com/emails', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + settings.apiKey,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  })

  var code = response.getResponseCode()
  var body = response.getContentText()

  if (code < 300) {
    return { ok: true, message: 'Sent' }
  }

  if (withLogo) {
    delete payload.attachments
    payload.html = buildLeadEmailHtml(data, false)

    var retry = UrlFetchApp.fetch('https://api.resend.com/emails', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + settings.apiKey,
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    })

    if (retry.getResponseCode() < 300) {
      return { ok: true, message: 'Sent (no logo)' }
    }

    body = retry.getContentText()
    code = retry.getResponseCode()
  }

  return {
    ok: false,
    message: 'Failed (' + code + '): ' + parseResendError(body),
  }
}

function parseResendError(body) {
  try {
    var json = JSON.parse(body)
    if (json.message) return json.message
  } catch (error) {
    // ignore parse errors
  }

  return body || 'Unknown Resend error'
}

function tryBuildLogoAttachment(siteUrl) {
  if (!siteUrl) {
    return null
  }

  var logoUrl = siteUrl + '/brand/emori-logo.webp'

  try {
    var response = UrlFetchApp.fetch(logoUrl, { muteHttpExceptions: true })
    if (response.getResponseCode() >= 300) {
      Logger.log('Logo fetch failed: ' + logoUrl)
      return null
    }

    return {
      filename: 'emori-logo.webp',
      content: Utilities.base64Encode(response.getBlob().getBytes()),
      content_id: 'emori-logo',
    }
  } catch (error) {
    Logger.log('Logo fetch error: ' + error)
    return null
  }
}

function buildLeadEmailHtml(data, hasLogo) {
  var submitted = formatLeadDate(data.submittedAt)
  var logoBlock = hasLogo
    ? '<img src="cid:emori-logo" alt="EMORI" width="168" style="display:block;width:168px;max-width:168px;height:auto;border:0;margin:0 auto;" />'
    : '<p style="margin:0;font-family:Georgia,\'Times New Roman\',serif;font-size:28px;letter-spacing:0.22em;color:#f7f2ee;">EMORI</p>' +
      '<p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#d4af37;">Lab Grown Diamonds</p>'

  var rows = [
    ['Full Name', data.fullName],
    ['Phone', data.phone],
    ['Email', data.email],
    ['State', data.state],
    ['City / District', data.city],
    ['Investment Budget', data.budget],
    ['Preferred Location', data.location],
    ['Source', data.source],
    ['UTM Parameters', data.utmParameters],
    ['Country', data.countryIso + (data.countryCode ? ' (+' + data.countryCode + ')' : '')],
    ['Submitted', submitted],
  ]

  var tableRows = rows
    .map(function (row) {
      return (
        '<tr>' +
        '<td style="padding:12px 16px;border-bottom:1px solid #ece7e2;color:#6b6560;font-family:Arial,Helvetica,sans-serif;font-size:13px;width:38%;vertical-align:top;">' +
        escapeHtml(row[0]) +
        '</td>' +
        '<td style="padding:12px 16px;border-bottom:1px solid #ece7e2;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;vertical-align:top;">' +
        escapeHtml(row[1] || '—') +
        '</td>' +
        '</tr>'
      )
    })
    .join('')

  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f7f2ee;">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f2ee;padding:32px 16px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ece7e2;box-shadow:0 12px 32px rgba(17,17,17,0.08);">' +
    '<tr><td style="background:#111111;padding:28px 32px 24px;text-align:center;">' +
    logoBlock +
    '</td></tr>' +
    '<tr><td style="padding:32px 32px 12px;">' +
    '<p style="margin:0 0 8px;font-family:Georgia,\'Times New Roman\',serif;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a8024;">New Lead</p>' +
    '<h1 style="margin:0 0 10px;font-family:Georgia,\'Times New Roman\',serif;font-size:28px;line-height:1.2;font-weight:500;color:#111111;">Franchise Inquiry Received</h1>' +
    '<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#5c5752;">A new franchise eligibility form was submitted on the EMORI website.</p>' +
    '</td></tr>' +
    '<tr><td style="padding:8px 32px 28px;">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #ece7e2;border-radius:12px;overflow:hidden;background:#faf8f6;">' +
    tableRows +
    '</table>' +
    '</td></tr>' +
    '<tr><td style="padding:0 32px 28px;">' +
    '<table role="presentation" cellspacing="0" cellpadding="0"><tr>' +
    '<td style="border-radius:999px;background:#111111;">' +
    '<a href="mailto:' +
    escapeHtml(data.email || '') +
    '" style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffffff;text-decoration:none;">Reply to Lead</a>' +
    '</td></tr></table>' +
    '</td></tr>' +
    '<tr><td style="padding:18px 32px 24px;border-top:1px solid #ece7e2;background:#faf8f6;">' +
    '<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8a847d;">This notification was sent automatically from the EMORI franchise website. The lead was also saved to the Leads sheet.</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>'
  )
}

function formatLeadDateTime(value) {
  var date = value ? new Date(value) : new Date()
  if (isNaN(date.getTime())) {
    date = new Date()
  }
  return Utilities.formatDate(date, TIMEZONE, 'dd/MM/yyyy hh:mm a')
}

function formatLeadDate(value) {
  return formatLeadDateTime(value)
}

function readPayload(e) {
  if (e.postData && e.postData.contents && e.postData.type === 'application/json') {
    var json
    try {
      json = JSON.parse(e.postData.contents)
    } catch (error) {
      throw new Error('Invalid JSON')
    }
    if (!json || typeof json !== 'object') throw new Error('Invalid JSON')
    return buildLead(json)
  }

  var p = (e && e.parameter) || {}
  return buildLead({
    submittedAt: p.submittedAt,
    fullName: p.applicant_full_name,
    countryIso: p.applicant_country_iso,
    countryCode: p.applicant_country_code,
    phone: p.applicant_phone,
    email: p.applicant_email,
    state: p.applicant_state,
    city: p.applicant_city,
    budget: p.applicant_budget,
    location: p.applicant_location,
    source: p.applicant_source,
    utmParameters: p.applicant_utm_parameters,
    submissionId: p.submission_id,
  })
}

function buildLead(raw) {
  raw = raw || {}

  var data = {
    submittedAt: formatLeadDateTime(raw.submittedAt),
    fullName: cleanText(raw.fullName || raw.applicant_full_name),
    countryIso: String(raw.countryIso || raw.applicant_country_iso || '')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase(),
    countryCode: String(raw.countryCode || raw.applicant_country_code || '').replace(/\D/g, ''),
    phone: String(raw.phone || raw.applicant_phone || '').replace(/\D/g, ''),
    email: cleanText(raw.email || raw.applicant_email),
    state: cleanText(raw.state || raw.applicant_state),
    city: cleanText(raw.city || raw.applicant_city),
    budget: cleanText(raw.budget || raw.applicant_budget),
    location: cleanText(raw.location || raw.applicant_location),
    source: cleanText(raw.source || raw.applicant_source).slice(0, 120),
    utmParameters: cleanText(raw.utmParameters || raw.applicant_utm_parameters).slice(0, 500),
    submissionId: normalizeSubmissionId(raw.submissionId || raw.submission_id),
  }

  return { data: data, error: validateLead(data) }
}

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function normalizeSubmissionId(value) {
  var id = cleanText(value)
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return ''
  return id
}

function validateLead(data) {
  var errors = []

  if (!data.fullName) errors.push('Full name is required.')
  else if (data.fullName.length > 120) errors.push('Full name is too long.')

  if (!data.email) errors.push('Email is required.')
  else if (data.email.length > 254 || !EMAIL_PATTERN.test(data.email)) errors.push('Email is not valid.')

  if (data.countryIso && !/^[A-Z]{2}$/.test(data.countryIso)) errors.push('Country is not valid.')
  if (data.countryCode && !/^\d{1,4}$/.test(data.countryCode)) errors.push('Country code is not valid.')

  var phoneError = validatePhone(data)
  if (phoneError) errors.push(phoneError)

  if (!data.state) errors.push('State is required.')
  else if (data.state.length > 80) errors.push('State is too long.')

  if (!data.city) errors.push('City is required.')
  else if (data.city.length > 80) errors.push('City is too long.')

  if (!data.budget) errors.push('Investment budget is required.')
  else if (data.budget.length > 80) errors.push('Investment budget is too long.')

  if (!data.location) errors.push('Preferred location is required.')
  else if (data.location.length > 80) errors.push('Preferred location is too long.')

  return errors.join(' ')
}

function validatePhone(data) {
  var rule = PHONE_RULES[data.countryIso]

  if (rule) {
    if (data.countryCode && data.countryCode !== rule.code) {
      return 'Country code does not match the selected country.'
    }
    if (!rule.pattern.test(data.phone)) return 'Phone number is not valid.'
    return ''
  }

  if (!/^\d{8,15}$/.test(data.phone)) return 'Phone number is not valid.'
  return ''
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function jsonResponse(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON
  )
}
