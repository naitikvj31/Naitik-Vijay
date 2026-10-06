/* ==========================================================================
   NaiGrowth — Sitemap lastmod

   Rewrites every <lastmod> in sitemap.xml from the date its page was last
   actually committed.

   A hand-typed lastmod goes stale the moment someone forgets to update it,
   and a sitemap that claims a page is older than it is tells Google not to
   bother recrawling it. Worse, Google learns over time whether a site's
   lastmod can be trusted, and once it decides the answer is no it stops
   using the field at all. So the date is derived, never typed: git already
   knows exactly when each page last changed.

   Falls back to the file's mtime outside a git checkout, and refuses to
   write a date in the future, which is the one value that is always a bug.

   Run:  npm run sitemap
   ========================================================================== */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const ORIGIN = 'https://www.naigrowth.com';

/** The page a sitemap URL refers to, as a repo-relative path. */
function fileFor(loc) {
  const rel = loc.replace(ORIGIN, '').replace(/^\//, '');
  return rel === '' ? 'index.html' : rel;
}

/* Full ISO 8601 with offset, not a bare date. The sitemap protocol takes
   either, but a bare date has to be interpreted in SOME timezone, and the
   first version of this script compared git's local-time date against a UTC
   "today" and clamped every page back a day. A timestamp that carries its
   own offset cannot be read two ways, and it also tells Google the page
   changed an hour ago rather than merely today. */

/** Last commit time for a file, as an ISO 8601 string, or null outside git. */
function committedOn(file) {
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', file],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return out && !Number.isNaN(Date.parse(out)) ? out : null;
  } catch {
    return null;
  }
}

function modifiedOn(file) {
  try {
    return statSync(path.join(ROOT, file)).mtime.toISOString();
  } catch {
    return null;
  }
}

const now = new Date();
let xml = readFileSync(SITEMAP, 'utf8');

let changed = 0;
let missing = [];

/* Each <url> block carries exactly one <loc> and one <lastmod>, so they can
   be rewritten as a pair without parsing the whole document. */
xml = xml.replace(
  /(<loc>)(.*?)(<\/loc>)([\s\S]*?)(<lastmod>)(.*?)(<\/lastmod>)/g,
  (whole, o1, loc, c1, between, o2, was, c2) => {
    const file = fileFor(loc.trim());
    const found = committedOn(file) || modifiedOn(file);

    if (!found) {
      missing.push(loc.trim());
      return whole;
    }

    /* A timestamp in the future is always a bug, whatever produced it, and
       Google ignores a sitemap entry that claims one. Compared as instants,
       so a +05:30 commit stamp is never mistaken for tomorrow. */
    const stamp = Date.parse(found) > now.getTime() ? now.toISOString() : found;

    if (stamp !== was) changed++;
    return `${o1}${loc}${c1}${between}${o2}${stamp}${c2}`;
  }
);

writeFileSync(SITEMAP, xml);

const total = (xml.match(/<loc>/g) || []).length;
console.log(`sitemap: ${changed} of ${total} lastmod dates updated`);
if (missing.length) {
  console.error('sitemap: no file behind these URLs:\n  ' + missing.join('\n  '));
  process.exitCode = 1;
}
