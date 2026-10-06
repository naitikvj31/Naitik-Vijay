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

/* Named hosts only, not "anything under the apex". A wildcard means that the
   day any subdomain is pointed somewhere and later abandoned — a stale CNAME
   to a parked service, a one-off landing page on a host someone else can
   claim — whoever picks it up can post to this endpoint from a page we do not
   control. The site lives on exactly two hosts, so those are the two. Preview
   deployments opt in explicitly through ALLOWED_ORIGINS. */
export const ALLOWED_HOSTS = [APEX, 'www.' + APEX];

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

    if (ALLOWED_HOSTS.includes(host)) return url.protocol === 'https:';

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

/* Every field this endpoint reads is a text field, so anything that is not a
   string is not a submission. Without this, `{"message": [...10k strings]}`
   gets concatenated by String() into one enormous value BEFORE any length
   rule can look at it, and `{"name": {}}` quietly validates as the literal
   text "[object Object]". Types are checked before sizes, sizes before
   patterns: no regex ever sees an unbounded string. */
const TEXT_FIELDS = ['name', 'email', 'phone', 'service', 'message'];

/* Comfortably above the longest real enquiry (3000 characters plus the other
   fields) and far below anything worth spending CPU on. */
export const MAX_FIELD_CHARS = 4000;

export function checkShape(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return 'Malformed request.';
    }
    for (const field of TEXT_FIELDS) {
        const value = body[field];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'string') return 'Malformed request.';
        if (value.length > MAX_FIELD_CHARS) return 'That submission is too long.';
    }
    return null;
}

export function validateSubmission(body = {}, now = Date.now()) {
    const malformed = checkShape(body);
    if (malformed) {
        return { ok: false, status: 400, message: malformed, reason: 'shape' };
    }

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

/* ==========================================================================
   Client IP

   This used to read the FIRST entry of X-Forwarded-For, which is the one
   value in the whole request an attacker gets to choose. A proxy appends the
   peer it saw to the end of that header, so a request carrying
   `X-Forwarded-For: 10.0.0.1` arrives as "10.0.0.1, <real client>" — read
   left to right you get the attacker's string, a fresh one per request, and
   the rate limiter never fires twice on the same key. It also meant the
   "Sender IP" line in the notification email was whatever the sender typed.

   Trusted sources first. X-Real-Ip and X-Vercel-Forwarded-For are written by
   the platform edge and are single-valued, so there is nothing to append to.
   Only if neither is present do we fall back to X-Forwarded-For, and then to
   its LAST entry: the hop nearest us, which is the only one our own
   infrastructure wrote. Anything that is not a plausible IP is discarded
   rather than used as a limiter key.
   ========================================================================== */

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE = /^[0-9a-f:]{2,45}$/i;

export function isIpish(value) {
    const v = String(value || '').trim();
    if (!v) return false;
    // ::ffff:203.0.113.4 and [2001:db8::1]:443 both turn up in the wild.
    const bare = v.replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '');
    return IPV4_RE.test(bare) || (v.includes(':') && IPV6_RE.test(bare));
}

export function clientIp(headers = {}) {
    const single = [headers['x-real-ip'], headers['x-vercel-forwarded-for']];
    for (const candidate of single) {
        const v = String(candidate || '').trim();
        if (isIpish(v)) return v;
    }

    const chain = String(headers['x-forwarded-for'] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const nearest = chain[chain.length - 1];
    if (isIpish(nearest)) return nearest;

    return 'unknown';
}
