/* ==========================================================================
   Unit tests — contact endpoint logic
   node --test test/
   Pure functions only: no network, no mailer, no request objects.
   ========================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    isAllowedOrigin,
    isCrossSite,
    isJsonContentType,
    escapeHtml,
    singleLine,
    looksLikeSpam,
    validateSubmission,
    createRateLimiter,
    clientIp,
    ALLOWED_SERVICES,
    MAX_LEN,
    FORM_MIN_MS,
    FORM_MAX_MS,
} from '../api/_lib/validation.js';

/* ---------------------------------------------------------------- origin */

test('isAllowedOrigin accepts the two hosts the site actually runs on', () => {
    assert.equal(isAllowedOrigin('https://naigrowth.com'), true);
    assert.equal(isAllowedOrigin('https://www.naigrowth.com'), true);
});

/* Not a wildcard: a subdomain that is later abandoned or taken over must not
   inherit permission to post here. Anything else opts in via ALLOWED_ORIGINS. */
test('isAllowedOrigin does not trust arbitrary subdomains', () => {
    assert.equal(isAllowedOrigin('https://staging.naigrowth.com'), false);
    assert.equal(isAllowedOrigin('https://abandoned.naigrowth.com'), false);
    assert.equal(
        isAllowedOrigin('https://staging.naigrowth.com', {
            extra: ['https://staging.naigrowth.com'],
        }),
        true
    );
});

test('isAllowedOrigin rejects look-alike hosts', () => {
    // Regression: the previous /naigrowth\.com$/ test matched all of these.
    assert.equal(isAllowedOrigin('https://evil-naigrowth.com'), false);
    assert.equal(isAllowedOrigin('https://notnaigrowth.com'), false);
    assert.equal(isAllowedOrigin('https://naigrowth.com.attacker.io'), false);
    assert.equal(isAllowedOrigin('https://attacker.vercel.app'), false);
});

test('isAllowedOrigin rejects plaintext http on the real domain', () => {
    assert.equal(isAllowedOrigin('http://naigrowth.com'), false);
});

test('isAllowedOrigin rejects empty, malformed and non-http schemes', () => {
    assert.equal(isAllowedOrigin(''), false);
    assert.equal(isAllowedOrigin(undefined), false);
    assert.equal(isAllowedOrigin('null'), false);
    assert.equal(isAllowedOrigin('not a url'), false);
    assert.equal(isAllowedOrigin('javascript:alert(1)'), false);
    assert.equal(isAllowedOrigin('file:///etc/passwd'), false);
});

test('isAllowedOrigin gates localhost behind the flag', () => {
    assert.equal(isAllowedOrigin('http://localhost:8777'), false);
    assert.equal(isAllowedOrigin('http://localhost:8777', { allowLocalhost: true }), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:3000', { allowLocalhost: true }), true);
});

test('isAllowedOrigin honours an explicit extra allow-list', () => {
    const extra = ['https://naigrowth-preview.vercel.app'];
    assert.equal(isAllowedOrigin('https://naigrowth-preview.vercel.app', { extra }), true);
    assert.equal(isAllowedOrigin('https://someone-else.vercel.app', { extra }), false);
});

/* ------------------------------------------------------- request shaping */

test('isCrossSite only flags the cross-site value', () => {
    assert.equal(isCrossSite('cross-site'), true);
    assert.equal(isCrossSite('same-origin'), false);
    assert.equal(isCrossSite('same-site'), false);
    assert.equal(isCrossSite('none'), false);
    assert.equal(isCrossSite(undefined), false);
});

test('isJsonContentType requires application/json', () => {
    assert.equal(isJsonContentType('application/json'), true);
    assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
    assert.equal(isJsonContentType('APPLICATION/JSON'), true);
    // These three are exactly the cross-origin form posts that need no preflight.
    assert.equal(isJsonContentType('application/x-www-form-urlencoded'), false);
    assert.equal(isJsonContentType('multipart/form-data'), false);
    assert.equal(isJsonContentType('text/plain'), false);
    assert.equal(isJsonContentType(undefined), false);
});

/* ----------------------------------------------------------- sanitising */

test('escapeHtml neutralises every injection character', () => {
    assert.equal(
        escapeHtml('<script>alert("x")</script>'),
        '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
    assert.equal(escapeHtml("it's"), 'it&#39;s');
    // Ampersand must be escaped first or the others double-encode.
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('singleLine strips CR and LF so SMTP headers cannot be injected', () => {
    assert.equal(
        singleLine('Naitik\r\nBcc: attacker@example.com'),
        'Naitik Bcc: attacker@example.com'
    );
    assert.equal(singleLine('  padded  '), 'padded');
    assert.ok(!singleLine('a\nb\r\nc').includes('\n'));
});

test('looksLikeSpam catches signatures and link floods, not normal text', () => {
    assert.equal(looksLikeSpam('[url=http://x.com]buy[/url]'), true);
    assert.equal(looksLikeSpam('<a href="http://x.com">click</a>'), true);
    assert.equal(looksLikeSpam('cheap VIAGRA here'), true);
    assert.equal(looksLikeSpam('https://a.com https://b.com https://c.com'), true);
    // A genuine lead often cites one or two URLs.
    assert.equal(looksLikeSpam('Our G2 page is https://g2.com/x and site https://x.com'), false);
    assert.equal(looksLikeSpam('A competitor outranks us on our own brand name.'), false);
});

/* ------------------------------------------------------------ validation */

const NOW = 1_770_000_000_000;

function body(over = {}) {
    return {
        name: 'Naitik Vijayvargiya',
        email: 'naitik@example.com',
        phone: '+91 88908 19966',
        service: 'orm',
        message: 'A competitor outranks us on our own brand name.',
        fts: NOW - 30_000,
        ...over,
    };
}

test('validateSubmission accepts a well-formed enquiry', () => {
    const r = validateSubmission(body(), NOW);
    assert.equal(r.ok, true);
    assert.equal(r.value.name, 'Naitik Vijayvargiya');
    assert.equal(r.value.service, 'orm');
});

test('validateSubmission fills the phone placeholder when omitted', () => {
    const r = validateSubmission(body({ phone: '' }), NOW);
    assert.equal(r.ok, true);
    assert.equal(r.value.phone, 'Not provided');
});

test('honeypot is rejected silently with a 200', () => {
    const r = validateSubmission(body({ company_website: 'http://spam.io' }), NOW);
    assert.equal(r.ok, false);
    assert.equal(r.silent, true);
    assert.equal(r.status, 200);
    assert.equal(r.reason, 'honeypot');
});

test('a form submitted faster than a human can type is rejected', () => {
    const r = validateSubmission(body({ fts: NOW - (FORM_MIN_MS - 1) }), NOW);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timing');
});

test('a replayed, very old timestamp is rejected', () => {
    const r = validateSubmission(body({ fts: NOW - (FORM_MAX_MS + 1) }), NOW);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timing');
});

test('a missing or non-numeric timestamp is rejected', () => {
    assert.equal(validateSubmission(body({ fts: undefined }), NOW).reason, 'timing');
    assert.equal(validateSubmission(body({ fts: 'abc' }), NOW).reason, 'timing');
});

test('required fields are enforced', () => {
    for (const field of ['name', 'email', 'message']) {
        const r = validateSubmission(body({ [field]: '' }), NOW);
        assert.equal(r.ok, false, field + ' should be required');
        assert.equal(r.status, 400);
        // The reason names the field that failed, so the client can mark it.
        assert.equal(r.reason, field);
        assert.ok(r.message.length > 0);
    }
});

test('field length caps are enforced', () => {
    const r = validateSubmission(body({ name: 'a'.repeat(MAX_LEN.name + 1) }), NOW);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.equal(r.reason, 'name');
    assert.match(r.message, /under 100 characters/);
});

test('a message at exactly the cap is accepted', () => {
    const r = validateSubmission(body({ message: 'a'.repeat(MAX_LEN.message) }), NOW);
    assert.equal(r.ok, true);
});

test('invalid email addresses are rejected', () => {
    for (const email of ['nope', 'a@b', 'a@b.c', '@example.com', 'a b@example.com']) {
        assert.equal(validateSubmission(body({ email }), NOW).ok, false, email);
    }
    assert.equal(validateSubmission(body({ email: 'a.b+tag@sub.example.co' }), NOW).ok, true);
});

test('only allow-listed service values pass', () => {
    for (const service of ALLOWED_SERVICES) {
        assert.equal(validateSubmission(body({ service }), NOW).ok, true, service);
    }
    const r = validateSubmission(body({ service: 'drop-table' }), NOW);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'service');
});

test('spam messages are rejected silently', () => {
    const r = validateSubmission(body({ message: '[url=http://x.io]casino[/url]' }), NOW);
    assert.equal(r.silent, true);
    assert.equal(r.status, 200);
});

test('every failing field is reported, not just the first', () => {
    const r = validateSubmission(body({ email: 'nope', phone: 'dfgdfg' }), NOW);
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'phone']);
});

test('a phone number of letters is rejected', () => {
    const r = validateSubmission(body({ phone: 'dfgdfg' }), NOW);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'phone');
});

test('header injection in a name is neutralised in the accepted value', () => {
    const r = validateSubmission(body({ name: 'Eve\r\nBcc: attacker@evil.io' }), NOW);
    assert.equal(r.ok, true);
    assert.ok(!r.value.name.includes('\n'));
    assert.ok(!r.value.name.includes('\r'));
});

/* ---------------------------------------------------------- rate limiter */

test('rate limiter allows up to max then blocks inside the window', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 3 });
    assert.equal(rl.check('1.1.1.1', 0), false);
    assert.equal(rl.check('1.1.1.1', 10), false);
    assert.equal(rl.check('1.1.1.1', 20), false);
    assert.equal(rl.check('1.1.1.1', 30), true);
});

test('rate limiter buckets are per key', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 });
    assert.equal(rl.check('a', 0), false);
    assert.equal(rl.check('b', 0), false);
    assert.equal(rl.check('a', 1), true);
});

test('rate limiter forgets hits once the window passes', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 });
    assert.equal(rl.check('a', 0), false);
    assert.equal(rl.check('a', 500), true);
    assert.equal(rl.check('a', 1001), false);
});

test('rate limiter prunes expired keys instead of growing without bound', () => {
    const rl = createRateLimiter({ windowMs: 100, max: 5, maxKeys: 10 });
    for (let i = 0; i < 20; i += 1) rl.check('ip-' + i, 0);
    rl.check('fresh', 10_000);
    assert.ok(rl.size <= 11, 'expected pruning, got ' + rl.size);
});

/* ------------------------------------------------------------------- ip */

test('clientIp prefers the headers the platform writes', () => {
    assert.equal(
        clientIp({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1, 198.51.100.7' }),
        '198.51.100.7'
    );
    assert.equal(clientIp({ 'x-vercel-forwarded-for': '198.51.100.7' }), '198.51.100.7');
});

/* The whole point of the rewrite: a sender who supplies their own
   X-Forwarded-For gets it prepended to the chain, so reading left to right
   handed them a fresh rate-limit key on every request. */
test('clientIp cannot be spoofed by a client-supplied forwarded-for', () => {
    const spoofed = { 'x-forwarded-for': '10.0.0.1, 203.0.113.9' };
    assert.equal(clientIp(spoofed), '203.0.113.9');

    // A long forged chain still resolves to the hop nearest us.
    assert.equal(
        clientIp({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9' }),
        '203.0.113.9'
    );

    // Two different forgeries must land on the SAME limiter key.
    const a = clientIp({ 'x-forwarded-for': 'aaaa, 203.0.113.9' });
    const b = clientIp({ 'x-forwarded-for': 'bbbb, 203.0.113.9' });
    assert.equal(a, b);
});

test('clientIp discards anything that is not an address', () => {
    assert.equal(clientIp({}), 'unknown');
    assert.equal(clientIp({ 'x-forwarded-for': '' }), 'unknown');
    assert.equal(clientIp({ 'x-forwarded-for': 'not-an-ip' }), 'unknown');
    assert.equal(clientIp({ 'x-real-ip': '<script>alert(1)</script>' }), 'unknown');
    assert.equal(clientIp({ 'x-forwarded-for': '999.999.999.999' }), 'unknown');
    assert.equal(clientIp({ 'x-forwarded-for': '2001:db8::1' }), '2001:db8::1');
});

/* ------------------------------------------------------------ body shape */

test('a non-string field is rejected before any rule runs', () => {
    const base = {
        name: 'Rahul Shah',
        email: 'rahul@example.com',
        message: 'We need help with our G2 page before a funding round.',
        fts: Date.now() - 5000,
    };
    const bad = [
        { name: {} },
        { name: ['a', 'b'] },
        { message: 42 },
        { email: true },
        { phone: ['9', '1'] },
        { service: { toString: 'orm' } },
    ];
    for (const patch of bad) {
        const result = validateSubmission({ ...base, ...patch });
        assert.equal(result.ok, false, JSON.stringify(patch));
        assert.equal(result.reason, 'shape', JSON.stringify(patch));
    }
});

test('an oversized field is rejected without running a regex over it', () => {
    const result = validateSubmission({
        name: 'Rahul Shah',
        email: 'rahul@example.com',
        message: 'x'.repeat(200000),
        fts: Date.now() - 5000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'shape');
});

test('an array or null body is rejected outright', () => {
    assert.equal(validateSubmission([]).reason, 'shape');
    assert.equal(validateSubmission(null).reason, 'shape');
    assert.equal(validateSubmission('string').reason, 'shape');
});
