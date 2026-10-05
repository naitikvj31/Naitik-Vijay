/* ==========================================================================
   Unit tests — field rules
   These are the rules the browser and the endpoint both run, so a case that
   passes here must behave identically in each.
   ========================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    validateName,
    validateEmail,
    validatePhone,
    validateMessage,
    validateService,
    validateAll,
    LIMITS,
} from '../js/modules/validate.js';

const ok = (v, msg) => assert.equal(v, null, msg);
const bad = (v, label) => assert.ok(typeof v === 'string' && v.length > 0, label + ' should fail');

/* ------------------------------------------------------------------- phone */

test('phone rejects letters', () => {
    // The reported bug: type="tel" validates nothing, so this used to submit.
    bad(validatePhone('dfgdfg'), 'dfgdfg');
    bad(validatePhone('call me'), 'call me');
    bad(validatePhone('+91 abcd efgh'), 'mixed');
});

test('phone accepts the formats people actually type', () => {
    for (const v of [
        '+91 88908 19966',
        '8890819966',
        '+1 (415) 555-0132',
        '020-7946-0958',
        '+44 20 7946 0958',
    ]) ok(validatePhone(v), v);
});

test('phone is optional', () => {
    ok(validatePhone(''));
    ok(validatePhone('   '));
    ok(validatePhone(undefined));
    ok(validatePhone(null));
});

test('phone enforces a digit count, not a character count', () => {
    bad(validatePhone('123'), 'too short');
    bad(validatePhone('1234567890123456'), 'too many digits');
    // Punctuation must not count toward the minimum.
    bad(validatePhone('+-- () .'), 'punctuation only');
    ok(validatePhone('+1 (415) 555-0132'));
});

test('phone rejects injection characters', () => {
    bad(validatePhone('1234567<script>'), 'markup');
    bad(validatePhone('1234567\nBcc: x@y.z'), 'newline');
});

/* ------------------------------------------------------------------- email */

test('email requires a real domain and TLD', () => {
    for (const v of ['nope', 'a@b', 'a@b.c', '@example.com', 'a@.com', 'a@b.', 'a b@example.com']) {
        bad(validateEmail(v), v);
    }
});

test('email accepts normal and plus-tagged addresses', () => {
    for (const v of [
        'naitik@example.com',
        'a.b+tag@sub.example.co.uk',
        'admin@naigrowth.com',
        'first_last@example-host.io',
    ]) ok(validateEmail(v), v);
});

test('email rejects doubled dots and spaces', () => {
    bad(validateEmail('a..b@example.com'), 'double dot');
    bad(validateEmail('a@ example.com'), 'space');
});

test('email is required', () => {
    bad(validateEmail(''), 'empty');
    bad(validateEmail('   '), 'whitespace');
});

test('email respects the length cap', () => {
    const long = 'a'.repeat(LIMITS.email.max) + '@example.com';
    bad(validateEmail(long), 'over cap');
});

/* -------------------------------------------------------------------- name */

test('name must contain letters', () => {
    bad(validateName('12345'), 'digits only');
    bad(validateName('...'), 'punctuation only');
    bad(validateName('a'), 'single character');
    bad(validateName(''), 'empty');
});

test('name accepts real names including non-Latin scripts', () => {
    for (const v of ['Naitik Vijayvargiya', "O'Brien", 'Jean-Luc', 'नैतिक', '李雷']) {
        ok(validateName(v), v);
    }
});

test('name rejects pasted links', () => {
    bad(validateName('https://spam.io'), 'url');
    bad(validateName('www.spam.io'), 'bare domain');
});

/* ----------------------------------------------------------------- message */

test('message needs real content', () => {
    bad(validateMessage(''), 'empty');
    bad(validateMessage('hi'), 'too short');
    bad(validateMessage('.........'), 'no words');
});

test('message accepts a normal enquiry and respects the cap', () => {
    ok(validateMessage('A competitor outranks us on our own brand name.'));
    ok(validateMessage('words here ' + 'a'.repeat(LIMITS.message.max - 11)));
    bad(validateMessage('a'.repeat(LIMITS.message.max + 1)), 'over cap');
});

/* ----------------------------------------------------------------- service */

test('service is optional but allow-listed when present', () => {
    ok(validateService(''));
    ok(validateService('orm'));
    ok(validateService('paid-media'));
    bad(validateService('drop-table'), 'unknown value');
});

/* --------------------------------------------------------------- validateAll */

test('validateAll reports every failing field at once', () => {
    const errors = validateAll({ name: '1', email: 'nope', phone: 'abc', message: 'hi' });
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'message', 'name', 'phone']);
});

test('validateAll returns nothing for a clean submission', () => {
    const errors = validateAll({
        name: 'Naitik Vijayvargiya',
        email: 'naitik@example.com',
        phone: '+91 88908 19966',
        service: 'orm',
        message: 'A competitor outranks us on our own brand name.',
    });
    assert.deepEqual(errors, {});
});

test('the browser rules and the endpoint rules are the same module', async () => {
    // Guards against the two drifting back into separate copies.
    const server = await import('../api/_lib/validation.js');
    const client = await import('../js/modules/validate.js');
    assert.equal(server.RULES, client.RULES);
});
