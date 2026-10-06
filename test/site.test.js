/* ==========================================================================
   Regression tests — every shipped page
   node --test test/
   These assert the invariants that have actually broken before: schema that
   stops parsing, FAQ markup drifting out of sync with FAQPage, dead internal
   links, duplicate titles, content hidden without JS, and copy regressions.
   ========================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/* The apex 307-redirects to www, so www is the host every absolute URL on the
   site must use. Kept in one constant: if the primary domain ever changes,
   this is the only line to edit. */
const SITE = 'https://www.naigrowth.com';

const PAGES = [
    'index.html',
    '404.html',
    ...fs.readdirSync(path.join(ROOT, 'services')).map((f) => 'services/' + f),
    ...fs.readdirSync(path.join(ROOT, 'platforms')).map((f) => 'platforms/' + f),
];

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = Object.fromEntries(PAGES.map((p) => [p, read(p)]));

const INDEXED = PAGES.filter((p) => p !== '404.html');

function jsonLd(src) {
    const m = src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1]) : null;
}

const count = (s, re) => (s.match(re) || []).length;

/* ------------------------------------------------------------- structure */

test('every page has exactly one h1', () => {
    for (const p of PAGES) {
        assert.equal(count(html[p], /<h1[\s>]/g), 1, p);
    }
});

test('every page has the landmark elements', () => {
    for (const p of PAGES) {
        assert.ok(html[p].includes('<main id="main"'), p + ' main');
        assert.ok(count(html[p], /<footer/g) >= 1, p + ' footer');
        assert.ok(html[p].includes('class="skip-link"'), p + ' skip link');
    }
});

test('tags balance on every page', () => {
    for (const p of PAGES) {
        for (const tag of ['div', 'section', 'a', 'ul', 'li', 'p']) {
            const open = count(html[p], new RegExp('<' + tag + '[\\s>]', 'g'));
            const close = count(html[p], new RegExp('</' + tag + '>', 'g'));
            assert.equal(open, close, `${p}: <${tag}> ${open} open / ${close} close`);
        }
    }
});

/* ----------------------------------------------------------------- schema */

test('JSON-LD parses on every indexed page', () => {
    for (const p of INDEXED) {
        assert.doesNotThrow(() => jsonLd(html[p]), p);
        assert.ok(jsonLd(html[p]), p + ' has no JSON-LD block');
    }
});

test('FAQPage entry count matches the FAQ items in the DOM', () => {
    // This drifted twice: answers added to one and not the other.
    for (const p of INDEXED) {
        const graph = jsonLd(html[p])['@graph'];
        const faq = graph.find((n) => n['@type'] === 'FAQPage');
        const dom = count(html[p], /data-faq-item/g);
        if (!faq) {
            assert.equal(dom, 0, p + ' has FAQ markup but no FAQPage schema');
            continue;
        }
        assert.equal(faq.mainEntity.length, dom, p + ' schema/DOM FAQ mismatch');
    }
});

test('no page declares aggregateRating', () => {
    // Rating markup without verifiable on-page reviews is spam to Google.
    // Checked against the parsed graph, not the source: the head carries a
    // comment explaining the omission, and that is not a declaration.
    for (const p of INDEXED) {
        assert.ok(!JSON.stringify(jsonLd(html[p])).includes('aggregateRating'), p);
    }
});

test('every FAQ answer in schema also appears in the DOM', () => {
    for (const p of INDEXED) {
        const faq = jsonLd(html[p])['@graph'].find((n) => n['@type'] === 'FAQPage');
        if (!faq) continue;
        for (const q of faq.mainEntity) {
            // Compare on a distinctive slice, since the DOM wraps and escapes.
            const probe = q.name.slice(0, 40).replace(/&/g, '&amp;');
            assert.ok(html[p].includes(probe), `${p}: question missing from DOM: ${probe}`);
        }
    }
});

test('breadcrumbs on sub-pages point at a real file', () => {
    for (const p of INDEXED.filter((x) => x !== 'index.html')) {
        const bc = jsonLd(html[p])['@graph'].find((n) => n['@type'] === 'BreadcrumbList');
        assert.ok(bc, p + ' has no BreadcrumbList');
        const last = bc.itemListElement.at(-1).item;
        const rel = last.replace(SITE + '/', '');
        assert.ok(fs.existsSync(path.join(ROOT, rel)), `${p}: breadcrumb target ${rel} missing`);
    }
});

/* -------------------------------------------------------------- metadata */

test('titles are unique and inside the truncation limit', () => {
    const seen = new Map();
    for (const p of INDEXED) {
        // Entities are one glyph to Google, so measure the decoded length.
        const t = html[p]
            .match(/<title>([\s\S]*?)<\/title>/)[1]
            .trim()
            .replace(/&amp;/g, '&');
        assert.ok(t.length > 10, p + ' title too short');
        assert.ok(t.length <= 62, `${p}: title ${t.length} chars`);
        assert.ok(!seen.has(t), `duplicate title on ${p} and ${seen.get(t)}`);
        seen.set(t, p);
    }
});

test('descriptions are unique and inside the truncation limit', () => {
    const seen = new Map();
    for (const p of INDEXED) {
        const m = html[p].match(/<meta name="description"\s+content="([^"]*)"/);
        assert.ok(m, p + ' has no description');
        const d = m[1].trim();
        assert.ok(d.length >= 70 && d.length <= 175, `${p}: description ${d.length} chars`);
        assert.ok(!seen.has(d), `duplicate description on ${p} and ${seen.get(d)}`);
        seen.set(d, p);
    }
});

test('every indexed page is canonical and indexable', () => {
    for (const p of INDEXED) {
        assert.ok(html[p].includes('rel="canonical"'), p + ' has no canonical');
        const robots = html[p].match(/<meta name="robots"\s+content="([^"]*)"/);
        assert.ok(robots, p + ' has no robots meta');
        assert.ok(!/noindex/.test(robots[1]), p + ' is noindex');
    }
});

test('the 404 page is noindex', () => {
    assert.match(html['404.html'], /<meta name="robots" content="noindex/);
});

/* ----------------------------------------------------------------- links */

test('no internal link points at a missing file', () => {
    for (const p of PAGES) {
        const dir = path.dirname(path.join(ROOT, p));
        for (const m of html[p].matchAll(/href="([^"#?:]+\.html)(?:#[^"]*)?"/g)) {
            const target = path.resolve(m[1].startsWith('/') ? ROOT : dir, '.' + path.sep + m[1].replace(/^\//, ''));
            assert.ok(fs.existsSync(target), `${p}: dead link ${m[1]}`);
        }
    }
});

test('every referenced local asset exists', () => {
    for (const p of PAGES) {
        const dir = path.dirname(path.join(ROOT, p));
        const attrs = [...html[p].matchAll(/(?:src|href)="((?:\.\.\/|\/)?(?:assets|css|js)\/[^"]+)"/g)];
        assert.ok(attrs.length > 0, p + ' references no local assets');
        for (const m of attrs) {
            // Strip the cache-busting ?v=<hash> before resolving to a file.
            const rel = m[1].split('?')[0];
            const target = path.resolve(rel.startsWith('/') ? ROOT : dir, '.' + path.sep + rel.replace(/^\//, ''));
            assert.ok(fs.existsSync(target), `${p}: missing asset ${m[1]}`);
        }
    }
});

test('every external link opens safely', () => {
    for (const p of PAGES) {
        for (const m of html[p].matchAll(/<a\s[^>]*href="https?:\/\/(?!(www\.)?naigrowth\.com)[^"]*"[^>]*>/g)) {
            if (!/target="_blank"/.test(m[0])) continue;
            assert.match(m[0], /rel="[^"]*noopener/, `${p}: ${m[0].slice(0, 90)}`);
        }
    }
});

test('every service and platform page is linked from the home page', () => {
    for (const p of PAGES.filter((x) => x.includes('/'))) {
        assert.ok(html['index.html'].includes(p), 'orphan page: ' + p);
    }
});

/* --------------------------------------------------------------- sitemap */

test('the sitemap lists every indexed page and nothing that is missing', () => {
    const xml = read('sitemap.xml');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    for (const p of INDEXED) {
        const url = p === 'index.html' ? SITE + '/' : SITE + '/' + p;
        assert.ok(locs.includes(url), 'sitemap is missing ' + url);
    }

    for (const loc of locs) {
        const rel = loc.replace(SITE + '/', '') || 'index.html';
        assert.ok(fs.existsSync(path.join(ROOT, rel)), 'sitemap points at missing ' + rel);
    }
});

test('canonical URLs and sitemap entries agree', () => {
    const locs = read('sitemap.xml');
    for (const p of INDEXED) {
        const c = html[p].match(/rel="canonical" href="([^"]+)"/)[1];
        assert.ok(locs.includes('<loc>' + c + '</loc>'), `${p}: canonical ${c} not in sitemap`);
    }
});

/* ----------------------------------------------- accessibility and copy */

test('every img has an alt attribute', () => {
    for (const p of PAGES) {
        for (const m of html[p].matchAll(/<img\s[^>]*>/g)) {
            assert.match(m[0], /\salt="/, `${p}: ${m[0].slice(0, 80)}`);
        }
    }
});

test('decorative svgs are hidden from assistive tech', () => {
    for (const p of PAGES) {
        for (const m of html[p].matchAll(/<svg\s[^>]*>/g)) {
            assert.match(m[0], /aria-hidden="true"/, `${p}: ${m[0].slice(0, 80)}`);
        }
    }
});

test('content is visible without JavaScript', () => {
    // Regression: [data-reveal] used to set opacity:0 unconditionally, which
    // hid 49 sections from any client that did not run the script.
    const css = read('css/components.css');
    const gate = css.indexOf('@media (scripting: enabled)');
    assert.ok(gate > 0, 'reveal styles are not gated on scripting support');
    const base = css.slice(css.indexOf('[data-reveal] {'), gate);
    assert.match(base, /opacity:\s*1/, 'default reveal state must be visible');
});

test('the custom cursor only hides the native pointer once it is live', () => {
    const css = read('css/components.css');
    assert.match(css, /body\.cursor-ready,\s*\n\s*body\.cursor-ready \* \{\s*\n\s*cursor: none/);
    assert.ok(!/^\s*body \* \{\s*cursor: none/m.test(css), 'cursor:none must be gated');
});

test('no page promises a free audit', () => {
    // The audit is a $50 to $100 one-time setup.
    for (const p of PAGES) {
        assert.ok(!/free (reputation )?audit/i.test(html[p]), p + ' still says free audit');
        assert.ok(!/no charge/i.test(html[p]), p + ' still says no charge');
    }
});

test('visible copy contains no em dashes', () => {
    for (const p of PAGES) {
        const visible = html[p]
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<script[\s\S]*?<\/script>/g, '');
        assert.ok(!visible.includes('—'), p + ' has an em dash in visible copy');
        assert.ok(!visible.includes('&mdash;'), p + ' has an &mdash; in visible copy');
    }
});

test('contact details are consistent everywhere they appear', () => {
    for (const p of PAGES) {
        if (html[p].includes('mailto:')) {
            assert.ok(html[p].includes('mailto:admin@naigrowth.com'), p + ' wrong email');
        }
        if (html[p].includes('tel:')) {
            assert.ok(html[p].includes('tel:+918890819966'), p + ' wrong phone');
        }
    }
});

/* ----------------------------------------------------------- deployment */

test('security headers are declared and the CSP allows no inline script', () => {
    const v = JSON.parse(read('vercel.json'));
    const global = v.headers.find((h) => h.source === '/(.*)');
    const byKey = Object.fromEntries(global.headers.map((h) => [h.key, h.value]));

    for (const key of [
        'Content-Security-Policy',
        'Strict-Transport-Security',
        'X-Content-Type-Options',
        'X-Frame-Options',
        'Referrer-Policy',
        'Permissions-Policy',
    ]) {
        assert.ok(byKey[key], 'missing header ' + key);
    }

    const csp = byKey['Content-Security-Policy'];
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'CSP allows inline script');
    assert.ok(!/script-src[^;]*unsafe-eval/.test(csp), 'CSP allows eval');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
});

test('no page loads a script from a third-party origin', () => {
    // The CSP is script-src 'self'; a CDN tag would silently fail to load.
    for (const p of PAGES) {
        for (const m of html[p].matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
            assert.ok(!/^https?:\/\//.test(m[1]), `${p}: external script ${m[1]}`);
        }
    }
});

test('no page carries an inline script block', () => {
    for (const p of PAGES) {
        for (const m of html[p].matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)) {
            assert.match(m[0], /type="application\/ld\+json"/, `${p}: inline script ${m[0]}`);
        }
    }
});

test('billing material is excluded from the deployment', () => {
    const ignore = read('.vercelignore');
    for (const line of ['invoices/', 'ads/*invoice*', '*.docx']) {
        assert.ok(ignore.includes(line), '.vercelignore is missing ' + line);
    }
});

test('unversioned CSS and JS are never cached beyond a revalidation', () => {
    // A long max-age on an asset whose URL never changes means a deploy
    // cannot reach anyone who already has it: fresh markup, stale stylesheet.
    const v = JSON.parse(read('vercel.json'));
    for (const source of ['/css/(.*)', '/js/(.*)']) {
        const block = v.headers.find((h) => h.source === source);
        assert.ok(block, 'no header block for ' + source);
        const cc = block.headers.find((h) => h.key === 'Cache-Control').value;
        assert.match(cc, /max-age=0/, source + ' may go stale: ' + cc);
        assert.match(cc, /must-revalidate/, source);
    }
});

test('every page links its assets with a content hash', () => {
    for (const p of PAGES) {
        for (const m of html[p].matchAll(/(?:href|src)="((?:\.\.\/)?(?:css|js)\/[^"]+\.(?:css|js))(\?v=[a-f0-9]+)?"/g)) {
            assert.ok(m[2], `${p}: ${m[1]} has no ?v= stamp — run npm run version`);
        }
    }
});

test('robots.txt points at the sitemap and blocks the api', () => {
    const r = read('robots.txt');
    assert.match(r, /Sitemap: https:\/\/www\.naigrowth\.com\/sitemap\.xml/);
    assert.match(r, /Disallow: \/api\//);
});
