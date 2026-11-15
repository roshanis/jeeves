/* eslint-disable @typescript-eslint/no-require-imports -- Plain CommonJS Node script. */
/* Guard for the deployable artifact: .next/standalone is what the container
 * image ships, so it must hold only the traced server, the agent prompts and
 * the policy corpus, never the source tree (tests, scripts, planning notes).
 * Run after a build:
 *   node scripts/check-standalone-output.cjs [path/to/.next/standalone]
 * Plain Node, no dependencies, read-only.
 */
const fs = require("node:fs");
const path = require("node:path");

const TOP_LEVEL = new Set([".next", "node_modules", "package.json", "server.js", "agents", "docs"]);

/** Returns the relative paths (POSIX separators) that are not on the allowlist. */
function findUnexpectedEntries(relativePaths) {
  const bad = [];
  for (const raw of relativePaths) {
    const rel = raw.split(path.sep).join("/").replace(/^\.\//, "");
    const parts = rel.split("/");
    const top = parts[0];
    let ok = TOP_LEVEL.has(top);
    if (ok && top === "agents") {
      ok = parts.length === 1 || rel.endsWith(".md");
    } else if (ok && top === "docs") {
      ok = parts.length === 1 || (parts[1] === "policies" && (parts.length === 2 || rel.endsWith(".md")));
    }
    if (!ok) bad.push(rel);
  }
  return bad;
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs);
    // Files are what ship; list a directory only so an empty or top-level one is judged too.
    if (entry.isDirectory()) {
      out.push(rel);
      if (rel.split(path.sep)[0] === ".next" || rel.split(path.sep)[0] === "node_modules") continue;
      walk(abs, base, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

function main() {
  const dir = path.resolve(process.argv[2] || path.join(process.cwd(), ".next", "standalone"));
  if (!fs.existsSync(path.join(dir, "server.js"))) {
    console.error(`check-standalone-output: ${dir}/server.js is missing. Wrong directory, or build first: npm run build`);
    process.exit(1);
  }
  const entries = walk(dir, dir, []);
  // Directories are only judged by their position; a file check covers content.
  const bad = findUnexpectedEntries(entries).filter((p) => {
    const abs = path.join(dir, p);
    return !(fs.statSync(abs).isDirectory() && /^(agents|docs)(\/|$)/.test(p));
  });
  if (bad.length > 0) {
    console.error(`check-standalone-output: ${bad.length} unexpected path(s) in ${dir}:`);
    for (const p of bad.slice(0, 30)) console.error(`  ${p}`);
    if (bad.length > 30) console.error(`  ... and ${bad.length - 30} more`);
    console.error("Only .next, node_modules, package.json, server.js, agents/**/*.md and docs/policies/**/*.md may ship.");
    process.exit(1);
  }
  console.log(`check-standalone-output: OK (${entries.length} entries, allowlist respected)`);
}

module.exports = { findUnexpectedEntries };
if (require.main === module) main();
