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

/* Google learns, per site, whether lastmod can be trusted, and once it
   decides the answer is no it stops using the field at all. A date in the
   future is the fastest way to earn that verdict; a date that never moves
   while pages change is the slower way. `npm run sitemap` derives these from
   git, and these two tests are what stop a hand-edit undoing it. */
test('every sitemap lastmod is a real, parseable, non-future timestamp', () => {
    const xml = read('sitemap.xml');
    const stamps = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    assert.equal(stamps.length, locs.length, 'every <url> needs a <lastmod>');

    // One day of slack: a build machine's clock may sit ahead of this one.
    const ceiling = Date.now() + 24 * 60 * 60 * 1000;

    for (const s of stamps) {
        const t = Date.parse(s);
        assert.ok(!Number.isNaN(t), `lastmod is not a valid date: ${s}`);
        assert.ok(t <= ceiling, `lastmod is in the future: ${s}`);
    }
});

test('sitemap lastmod is not older than the page it describes', () => {
    const xml = read('sitemap.xml');
    const pairs = [
        ...xml.matchAll(/<loc>([^<]+)<\/loc>[\s\S]*?<lastmod>([^<]+)<\/lastmod>/g),
    ];

    for (const [, loc, stamp] of pairs) {
        const rel = loc.replace(SITE + '/', '') || 'index.html';
        const file = path.join(ROOT, rel);
        if (!fs.existsSync(file)) continue;

        // Compared as instants, so a +05:30 stamp is never read as tomorrow.
        const claimed = Date.parse(stamp);
        const actual = fs.statSync(file).mtimeMs;

        // mtime moves on checkout, so only a claim that is WILDLY stale fails:
        // more than 30 days behind the file means someone stopped running
        // `npm run sitemap`.
        const monthMs = 30 * 24 * 60 * 60 * 1000;
        assert.ok(
            claimed >= actual - monthMs,
            `${rel}: sitemap says ${stamp} but the file is much newer. Run: npm run sitemap`
        );
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

/* The page never scrolls sideways, so every pixel of horizontal drift in a
   trackpad gesture is overscroll, and the browser's default action for that
   is swipe-to-go-back. Scrolling down would occasionally start navigating
   instead, landing the reader at the top of the page. Pinning the x axis is
   what stops it; the y axis must stay `auto` so pull to refresh survives. */
test('horizontal overscroll cannot turn into a back-navigation gesture', () => {
    // Comments stripped first: the rule above this one explains in prose why
    // `overflow-x: hidden` is wrong, and a naive search finds that sentence
    // and reports the declaration it warns against as present.
    const css = read('css/base.css').replace(/\/\*[\s\S]*?\*\//g, '');

    assert.match(css, /overscroll-behavior-x:\s*none/, 'x overscroll is not pinned');
    assert.ok(
        !/overscroll-behavior:\s*none/.test(css),
        'pinning both axes would also kill pull to refresh; pin x only'
    );
    // clip, not hidden: hidden makes the element its own scroll container.
    assert.match(css, /overflow-x:\s*clip/);
    assert.ok(!/overflow-x:\s*hidden/.test(css), 'overflow-x:hidden is back');
});

test('the custom cursor only hides the native pointer once it is live', () => {
    const css = read('css/components.css');
    assert.match(css, /body\.cursor-ready,\s*\n\s*body\.cursor-ready \* \{\s*\n\s*cursor: none/);
    assert.ok(!/^\s*body \* \{\s*cursor: none/m.test(css), 'cursor:none must be gated');
});

/* ------------------------------------------------------------- the offer

   The offer is: a free consultation, then a scope of work both sides sign,
   and only then an invoice. It used to be a $50 to $100 paid audit, and the
   price was written into 52 places across 18 pages including two FAQ answers
   that exist twice each, once in the DOM and once in JSON-LD. These tests
   exist because a half-finished pricing change is worse than either price:
   a visitor who reads "free" in the hero and a dollar figure in the FAQ
   trusts neither.
   ------------------------------------------------------------------------ */

test('no page names a price', () => {
    for (const p of PAGES) {
        const m = html[p].match(/\$\s?\d[\d,]*/);
        assert.equal(m, null, `${p} still names a price: ${m && m[0]}`);
        assert.ok(!/one-time setup/i.test(html[p]), p + ' still says one-time setup');
    }
});

test('the consultation is described as free, and the scope gates the invoice', () => {
    const home = html['index.html'];
    assert.match(home, /free consultation/i, 'the home page never says the consultation is free');
    assert.match(home, /scope of work/i, 'the home page never mentions the scope of work');

    // The promise that money comes after a signature, not before.
    assert.match(
        home,
        /nothing is invoiced until/i,
        'the home page does not say when the first invoice happens'
    );
});

test('every page sends people to the same offer', () => {
    for (const p of PAGES) {
        assert.match(
            html[p],
            /(Book a free consultation|Free consultation)/,
            p + ' has no consultation call to action'
        );
        assert.ok(!/Request an audit/.test(html[p]), p + ' still asks for an audit');
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
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
});

/* Fonts are served from this origin. If a stylesheet, font or any other
   subresource ever points at a third party again, the CSP will block it in
   the browser and this will fail first. */
test('the CSP names no external origin at all', () => {
    const v = JSON.parse(read('vercel.json'));
    const global = v.headers.find((h) => h.source === '/(.*)');
    const csp = global.headers.find((h) => h.key === 'Content-Security-Policy').value;
    assert.ok(!/https?:\/\//.test(csp), 'CSP still allows an external origin: ' + csp);
});

test('no page loads a stylesheet or font from a third party', () => {
    for (const p of PAGES) {
        for (const m of html[p].matchAll(/<link[^>]*\shref="([^"]+)"[^>]*>/g)) {
            const tag = m[0];
            if (!/rel="(stylesheet|preload|preconnect|dns-prefetch)"/.test(tag)) continue;
            assert.ok(!/^https?:\/\//.test(m[1]), `${p}: external resource ${m[1]}`);
        }
    }
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

/* -------------------------------------------------------------- deploy shape */

/* This site has no build step: the files in the repo are the files that get
   served. Vercel decides that for itself by looking for a "build" script in
   package.json, and the moment it finds one it runs it and then demands a
   `public/` directory that this project will never produce. Adding a `build`
   script as a local convenience broke a deploy exactly that way. Local
   helpers must be called anything else; `npm run prep` is the one that
   chains them. */
test('package.json declares no build script, which would break the deploy', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(
        !pkg.scripts || !pkg.scripts.build,
        'package.json has a "build" script. Vercel will run it and then look for a ' +
        'public/ directory that does not exist. Rename it (see "prep").'
    );
});

/* ---------------------------------------------------------------- favicon */

/* Google will only adopt a favicon whose raster is a multiple of 48px. The
   site declared 16 and 32 for a long time, neither of which qualifies, and
   search results showed the default globe instead of the mark. */
test('every page declares a favicon Google can actually use', () => {
    for (const p of PAGES) {
        const sizes = [...html[p].matchAll(/<link rel="icon"[^>]*sizes="(\d+)x\d+"/g)]
            .map((m) => Number(m[1]));
        const usable = sizes.filter((s) => s % 48 === 0);
        assert.ok(
            usable.length > 0,
            `${p}: declares ${sizes.join(', ') || 'no'} px icons, none a multiple of 48`
        );
    }
});

test('the root /favicon.ico exists and is a real icon file', () => {
    const file = path.join(ROOT, 'favicon.ico');
    assert.ok(fs.existsSync(file), 'no /favicon.ico — Google falls back to this URL');

    const buf = fs.readFileSync(file);
    // ICONDIR: reserved must be 0, type must be 1 (icon), count must be > 0.
    assert.equal(buf.readUInt16LE(0), 0, 'favicon.ico: bad reserved field');
    assert.equal(buf.readUInt16LE(2), 1, 'favicon.ico: not an icon file');

    const count = buf.readUInt16LE(4);
    assert.ok(count > 0, 'favicon.ico: no images inside');

    const declared = [];
    for (let i = 0; i < count; i++) {
        const e = 6 + i * 16;
        declared.push(buf.readUInt8(e) || 256);
        const len = buf.readUInt32LE(e + 8);
        const off = buf.readUInt32LE(e + 12);
        assert.ok(off + len <= buf.length, 'favicon.ico: entry points past the file');
    }
    assert.ok(declared.includes(48), `favicon.ico: no 48px entry, has ${declared.join(', ')}`);
});

test('nothing robots-blocks the icons Google needs to fetch', () => {
    const robots = read('robots.txt');
    const blocked = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1]);
    for (const dir of blocked) {
        assert.ok(
            !'/assets/'.startsWith(dir) && dir !== '/',
            `robots.txt blocks ${dir}, which covers the favicons`
        );
    }
});

test('robots.txt points at the sitemap and blocks the api', () => {
    const r = read('robots.txt');
    assert.match(r, /Sitemap: https:\/\/www\.naigrowth\.com\/sitemap\.xml/);
    assert.match(r, /Disallow: \/api\//);
});
