/* ==========================================================================
   NaiGrowth — Contact endpoint: pure logic
   Everything here is side-effect free so it can be unit tested without a
   network, a mailer or a request object. api/contact.js is the thin wrapper.
   Files under api/ beginning with "_" are not routed by Vercel.
   ========================================================================== */

/* The field rules are shared with the browser, imported rather than copied.
   Two parallel definitions drift, and the one that drifts is always the one
   that lets bad data through. */
export { RULES, LIMITS, validateAll, EMAIL_RE as SHARED_EMAIL_RE } from '../../js/modules/validate.js';
import { RULES, validateAll } from '../../js/modules/validate.js';

export const MAX_LEN = {
    name: 100,
    email: 254,
    phone: 30,
    service: 40,
    message: 3000,
};

/* Must stay in sync with the <select name="service"> options in index.html.
   Legacy values are kept so an older cached page keeps submitting. */
export const ALLOWED_SERVICES = [
    'orm',
    'paid-media',
    'paid-pr',
    'paid-reviews',
    'consultancy',
    'seo',
    'salesforce',
    'web',
    // legacy
    'reviews',
    'ai',
];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Conservative signatures only — a false positive here silently drops a real
   lead, which costs more than the spam it prevents. */
const SPAM_PATTERNS = [
    /\[url=/i,
    /<a\s+href/i,
    /viagra|cialis|casino|xxx|porn/i,
    /\bcrypto\s*(wallet|invest|profit)/i,
];
const MAX_LINKS_IN_MESSAGE = 2;

/* A form submitted faster than this was not typed by a person. One submitted
   longer ago than the ceiling is a replayed capture, not a live visitor. */
export const FORM_MIN_MS = 2000;
export const FORM_MAX_MS = 12 * 60 * 60 * 1000;

/* ==========================================================================
   Origin
   The previous check was `/naigrowth\.com$/`, which the whole origin string
   was tested against — so "https://evil-naigrowth.com" passed, and so did
   any attacker's "*.vercel.app" preview. Hosts are now matched exactly, with
   subdomains allowed only under the real apex.
   ========================================================================== */

const APEX = 'naigrowth.com';

export function isAllowedOrigin(origin, { allowLocalhost = false, extra = [] } = {}) {
    if (!origin) return false;

    let url;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

    const host = url.hostname.toLowerCase();

    if (host === APEX || host.endsWith('.' + APEX)) {
        return url.protocol === 'https:';
    }

    if (allowLocalhost && (host === 'localhost' || host === '127.0.0.1')) return true;

    return extra.some((e) => e.toLowerCase() === origin.toLowerCase());
}

/* Browsers send Sec-Fetch-Site on every fetch. "cross-site" is never our own
   form, whatever the Origin header claims. */
export function isCrossSite(secFetchSite) {
    return secFetchSite === 'cross-site';
}

/* A cross-origin HTML form can POST urlencoded or text/plain without a
   preflight. Requiring JSON means any such request is rejected outright. */
export function isJsonContentType(contentType) {
    if (!contentType) return false;
    return String(contentType).split(';')[0].trim().toLowerCase() === 'application/json';
}

/* ==========================================================================
   Sanitising
   ========================================================================== */

export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* Strips CR/LF so a value can never inject extra SMTP headers. */
export function singleLine(str) {
    return String(str).replace(/[\r\n]+/g, ' ').trim();
}

export function looksLikeSpam(message) {
    const text = String(message);
    if (SPAM_PATTERNS.some((re) => re.test(text))) return true;
    return (text.match(/https?:\/\//gi) || []).length > MAX_LINKS_IN_MESSAGE;
}

/* ==========================================================================
   Body validation
   Returns { ok: true, value } or { ok: false, status, message, silent }.
   `silent` means answer 200 so a bot learns nothing from the response.
   ========================================================================== */

export function validateSubmission(body = {}, now = Date.now()) {
    // Honeypot: a field no human sees.
    if (body.company_website) {
        return { ok: false, status: 200, silent: true, reason: 'honeypot' };
    }

    const stamp = parseInt(body.fts, 10);
    const elapsed = now - stamp;
    if (!Number.isFinite(stamp) || elapsed < FORM_MIN_MS || elapsed > FORM_MAX_MS) {
        return { ok: false, status: 200, silent: true, reason: 'timing' };
    }

    /* Exactly the rules the browser ran. A client that skipped them, or a
       direct POST that never loaded the page, is held to the same standard. */
    const errors = validateAll(body);
    const failed = Object.keys(errors);
    if (failed.length) {
        return {
            ok: false,
            status: 400,
            message: errors[failed[0]],
            reason: failed[0],
            errors,
        };
    }

    if (service_allowed(body.service) === false) {
        return { ok: false, status: 400, message: 'Invalid service selected.', reason: 'service' };
    }

    if (looksLikeSpam(body.message)) {
        return { ok: false, status: 200, silent: true, reason: 'spam' };
    }

    const { name, email, phone, service, message } = body;
    return {
        ok: true,
        value: {
            name: singleLine(name),
            email: singleLine(email).toLowerCase(),
            phone: phone ? singleLine(phone) : 'Not provided',
            service: service || 'Not specified',
            message: String(message).trim(),
        },
    };
}

function service_allowed(value) {
    if (!value) return true;
    return ALLOWED_SERVICES.includes(value);
}

/* ==========================================================================
   Rate limiting
   In-memory and therefore per-instance: it resets on a cold start and does
   not coordinate across regions. It is a cost ceiling, not an access control
   — the honeypot, timing trap and origin check carry that job.
   ========================================================================== */

export function createRateLimiter({ windowMs = 10 * 60 * 1000, max = 3, maxKeys = 5000 } = {}) {
    const hits = new Map();

    return {
        check(key, now = Date.now()) {
            const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);

            if (recent.length >= max) {
                hits.set(key, recent);
                return true;
            }

            recent.push(now);
            hits.set(key, recent);

            // Bound memory: drop keys whose whole window has expired.
            if (hits.size > maxKeys) {
                for (const [k, times] of hits) {
                    if (times.every((t) => now - t >= windowMs)) hits.delete(k);
                }
            }

            return false;
        },
        get size() {
            return hits.size;
        },
    };
}

export function clientIp(headers = {}) {
    const fwd = headers['x-forwarded-for'] || '';
    return String(fwd).split(',')[0].trim() || 'unknown';
}
