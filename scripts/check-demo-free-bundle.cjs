/* eslint-disable @typescript-eslint/no-require-imports -- Plain CommonJS Node script. */
/* Guard for a demo-disabled build (JEEVES_DEMO_ENABLED=0): the JavaScript it
 * serves before sign-in, .next/static, must not carry the demo's company name
 * or its persona roster. Run after such a build:
 *   node scripts/check-demo-free-bundle.cjs [path/to/.next/static]
 * It fails on a demo-capable build by design, so run it only on the build that
 * a production image ships. Plain Node, no dependencies, read-only.
 */
const fs = require("node:fs");
const path = require("node:path");

const COMPANY = "Meridian";

/**
 * The company name plus every persona id and display name, read from the
 * roster's own source (lib/demo/personas.ts) so a new persona is covered
 * without editing this script. An unreadable roster is an error: an empty
 * list would pass every build.
 */
function forbiddenStrings(personasSource) {
  const found = new Set();
  for (const match of personasSource.matchAll(/\bid:\s*"([^"]+)"\s*,\s*name:\s*"([^"]+)"/g)) {
    found.add(match[1]);
    found.add(match[2]);
  }
  if (found.size === 0) throw new Error("no persona found in the roster source; cannot build the forbidden list");
  found.add(COMPANY);
  return [...found];
}

/** Which of `forbidden` each file contains; files with none are left out. */
function findLeaks(files, forbidden) {
  const leaks = [];
  for (const [file, text] of Object.entries(files)) {
    const hits = forbidden.filter((needle) => text.includes(needle));
    if (hits.length > 0) leaks.push({ file, found: hits });
  }
  return leaks;
}

function readTextFiles(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) readTextFiles(abs, base, out);
    else if (/\.(js|css|html|json|txt|map)$/.test(entry.name)) out[path.relative(base, abs).split(path.sep).join("/")] = fs.readFileSync(abs, "utf8");
  }
  return out;
}

function main() {
  const dir = path.resolve(process.argv[2] || path.join(process.cwd(), ".next", "static"));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`check-demo-free-bundle: ${dir} is missing. Wrong directory, or build first: JEEVES_DEMO_ENABLED=0 npm run build`);
    process.exit(1);
  }
  let forbidden;
  try {
    forbidden = forbiddenStrings(fs.readFileSync(path.resolve(__dirname, "..", "lib", "demo", "personas.ts"), "utf8"));
  } catch (error) {
    console.error(`check-demo-free-bundle: ${error.message}`);
    process.exit(1);
  }
  const files = readTextFiles(dir, dir, {});
  const leaks = findLeaks(files, forbidden);
  if (leaks.length > 0) {
    console.error(`check-demo-free-bundle: ${leaks.length} file(s) in ${dir} carry demo strings:`);
    for (const leak of leaks.slice(0, 30)) console.error(`  ${leak.file}: ${leak.found.join(", ")}`);
    if (leaks.length > 30) console.error(`  ... and ${leaks.length - 30} more`);
    console.error("A build with JEEVES_DEMO_ENABLED=0 must not ship the company name or the persona roster; gate the code behind the build-time JEEVES_DEMO_ENABLED switch (see lib/client/personas.ts and lib/client/demo-copy.ts).");
    process.exit(1);
  }
  console.log(`check-demo-free-bundle: OK (${Object.keys(files).length} files, ${forbidden.length} strings absent)`);
}

module.exports = { forbiddenStrings, findLeaks };
if (require.main === module) main();
