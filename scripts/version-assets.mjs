/* ==========================================================================
   Stamp every stylesheet and script link with a hash of its own contents.

   Why this exists: the site has no build step, so css/components.css keeps
   the same URL forever. A deploy that changes it cannot reach anyone whose
   browser already cached that URL, and a cached stylesheet against fresh
   markup renders the page unstyled. Putting the content hash in the query
   string means a changed file gets a URL nobody has cached.

   Run before every deploy:  npm run version
   ========================================================================== */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const PAGES = [
    "index.html",
    "404.html",
    ...readdirSync(path.join(ROOT, "services")).map((f) => "services/" + f),
    ...readdirSync(path.join(ROOT, "platforms")).map((f) => "platforms/" + f),
];

const hashes = new Map();

function hashOf(assetPath) {
    if (hashes.has(assetPath)) return hashes.get(assetPath);
    const file = path.join(ROOT, assetPath);
    if (!existsSync(file)) return null;
    const h = createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 8);
    hashes.set(assetPath, h);
    return h;
}

let changed = 0;

for (const page of PAGES) {
    const file = path.join(ROOT, page);
    const src = readFileSync(file, "utf8");

    /* Matches href="css/base.css" and src="../js/main.js", with or without an
       existing ?v= stamp, and leaves every other URL alone. */
    const out = src.replace(
        /((?:href|src)=")((?:\.\.\/)?(?:css|js)\/[A-Za-z0-9._\-/]+\.(?:css|js))(?:\?v=[a-f0-9]+)?(")/g,
        (whole, lead, url, tail) => {
            const resolved = url.replace(/^\.\.\//, "");
            const h = hashOf(resolved);
            if (!h) {
                console.warn("  missing asset, left unstamped:", url);
                return whole;
            }
            return lead + url + "?v=" + h + tail;
        }
    );

    if (out !== src) {
        writeFileSync(file, out);
        changed += 1;
    }
}

console.log(`stamped ${hashes.size} assets across ${changed} pages`);
for (const [asset, h] of hashes) console.log(`  ${h}  ${asset}`);
