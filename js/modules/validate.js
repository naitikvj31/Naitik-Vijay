/* ==========================================================================
   NaiGrowth — Field rules
   The single source of truth for what each field accepts. The server applies
   the identical rules in api/_lib/validation.js; this module exists so the
   browser can say the same thing before a request is ever made.

   Every rule returns null when the value is fine, or the exact message the
   visitor should read.
   ========================================================================== */

/* A real address, not just "something with an @". Requires a label, a domain
   with at least one dot, and a TLD of two or more letters. */
export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/* Characters a person can legitimately type into a phone field. Letters are
   not among them, which is what "dfgdfg" was getting past. */
export const PHONE_ALLOWED_RE = /^[+()\-.\s0-9]+$/;

/* Rough URL/markup detection for the free-text fields. */
const LINKY_RE = /(https?:\/\/|www\.|<\/?[a-z]+>)/i;

export const LIMITS = {
    name: { min: 2, max: 100 },
    email: { min: 5, max: 254 },
    /* E.164 allows up to 15 digits. Seven is the shortest real subscriber
       number in general use, so anything below it is a typo. */
    phone: { minDigits: 7, maxDigits: 15, max: 30 },
    message: { min: 10, max: 3000 },
};

export const SERVICES = [
    'orm', 'paid-media', 'paid-pr', 'paid-reviews',
    'consultancy', 'seo', 'salesforce', 'web',
    // legacy values, so an older cached page still submits
    'reviews', 'ai',
];

const letters = (s) => (String(s).match(/\p{L}/gu) || []).length;

export function validateName(raw) {
    const v = String(raw ?? '').trim();
    if (!v) return 'Please tell us your name.';
    if (v.length < LIMITS.name.min) return 'That name looks too short.';
    if (v.length > LIMITS.name.max) return `Please keep your name under ${LIMITS.name.max} characters.`;
    // "..." or "12345" is not a name, and neither is a pasted link.
    if (letters(v) < 2) return 'Please enter your name using letters.';
    if (LINKY_RE.test(v)) return 'Please enter a name, not a link.';
    return null;
}

export function validateEmail(raw) {
    const v = String(raw ?? '').trim();
    if (!v) return 'Please add an email address so we can reply.';
    if (v.length > LIMITS.email.max) return 'That email address is too long.';
    if (/\s/.test(v)) return 'An email address cannot contain spaces.';
    if (!EMAIL_RE.test(v)) return 'That does not look like a complete email address.';
    // A trailing dot or a doubled dot passes the pattern but never delivers.
    if (v.includes('..')) return 'That email address has two dots in a row.';
    return null;
}

/* Optional: an empty value is valid. Anything present must be a phone number. */
export function validatePhone(raw) {
    const v = String(raw ?? '').trim();
    if (!v) return null;
    if (v.length > LIMITS.phone.max) return 'That phone number is too long.';
    if (!PHONE_ALLOWED_RE.test(v)) {
        return 'Phone can only contain numbers, spaces and + ( ) -';
    }
    const digits = v.replace(/\D/g, '').length;
    if (digits < LIMITS.phone.minDigits) return 'That phone number is too short.';
    if (digits > LIMITS.phone.maxDigits) return 'That phone number has too many digits.';
    return null;
}

export function validateMessage(raw) {
    const v = String(raw ?? '').trim();
    if (!v) return 'Tell us briefly what is happening.';
    if (v.length < LIMITS.message.min) return 'Please add a little more detail, at least a sentence.';
    if (v.length > LIMITS.message.max) return `Please keep this under ${LIMITS.message.max} characters.`;
    if (letters(v) < 5) return 'Please write your message in words.';
    return null;
}

export function validateService(raw) {
    const v = String(raw ?? '').trim();
    if (!v) return null;
    return SERVICES.includes(v) ? null : 'Please choose one of the listed services.';
}

export const RULES = {
    name: validateName,
    email: validateEmail,
    phone: validatePhone,
    message: validateMessage,
    service: validateService,
};

/* Returns { field: message } for everything that failed, empty when clean. */
export function validateAll(values = {}) {
    const errors = {};
    for (const [field, rule] of Object.entries(RULES)) {
        const message = rule(values[field]);
        if (message) errors[field] = message;
    }
    return errors;
}
