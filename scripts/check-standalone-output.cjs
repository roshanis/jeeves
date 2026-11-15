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
    if (ok && top === "node_modules") {
      // The app never calls sharp (images are unoptimized); keep its LGPL libvips binaries out of the image.
      ok = parts[1] !== "sharp" && parts[1] !== "@img";
    } else if (ok && top === "agents") {
      ok = parts.length === 1 || rel.endsWith(".md");
    } else if (ok && top === "docs") {
      ok = parts.length === 1 || (parts[1] === "policies" && (parts.length === 2 || rel.endsWith(".md")));
    }
    if (!ok) bad.push(rel);
  }
  return bad;
}

/** Returns the required paths that are absent from the standalone entry list. */
function findMissingRequired(relativePaths, required) {
  const present = new Set(relativePaths.map((raw) => raw.split(path.sep).join("/").replace(/^\.\//, "")));
  return required.filter((rel) => !present.has(rel));
}

/**
 * The files the app reads at run time (lib/agents/adapter-shared.ts and
 * policy-corpus.ts), derived from the source tree: every .md under
 * agents/<agent>/ (instructions, reviewer schema and tracks; not
 * agents/README.md) and every docs/policies/*.md.
 */
function deriveRequired(repoRoot) {
  const out = [];
  const addMd = (rel, recurse) => {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (recurse) addMd(child, true);
      } else if (entry.name.endsWith(".md")) {
        out.push(child);
      }
    }
  };
  const agentsDir = path.join(repoRoot, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) addMd(`agents/${entry.name}`, true);
    }
  }
  addMd("docs/policies", false);
  return out.sort();
}

/** Problems that make the derived required list vacuous (source tree without agent or policy files). */
function assertRequiredDerivable(required) {
  const problems = [];
  if (!required.some((rel) => rel.startsWith("agents/"))) problems.push("no agents/**/*.md file found in the source tree; cannot verify the agent instructions ship");
  if (!required.some((rel) => rel.startsWith("docs/policies/"))) problems.push("no docs/policies/*.md file found in the source tree; cannot verify the policy corpus ships");
  return problems;
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs);
    // Files are what ship; list a directory only so an empty or top-level one is judged too.
    if (entry.isDirectory()) {
      out.push(rel);
      if (rel === "node_modules") {
        // List the first level only (node_modules/<name>, node_modules/@scope) so the sharp and @img guard can fire.
        for (const child of fs.readdirSync(abs)) out.push(path.join(rel, child));
        continue;
      }
      if (rel.split(path.sep)[0] === ".next") continue;
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
  const required = deriveRequired(path.resolve(__dirname, ".."));
  const problems = assertRequiredDerivable(required);
  if (problems.length > 0) {
    for (const p of problems) console.error(`check-standalone-output: ${p}`);
    process.exit(1);
  }
  const missing = findMissingRequired(entries, required);
  if (missing.length > 0) {
    console.error(`check-standalone-output: ${missing.length} run-time file(s) missing from ${dir}:`);
    for (const p of missing.slice(0, 30)) console.error(`  ${p}`);
    if (missing.length > 30) console.error(`  ... and ${missing.length - 30} more`);
    console.error("The agents read these at run time; check that lib/agents still joins process.cwd() with literal path segments.");
    process.exit(1);
  }
  console.log(`check-standalone-output: OK (${entries.length} entries, allowlist respected, run-time files present)`);
}

module.exports = { findUnexpectedEntries, findMissingRequired, deriveRequired, assertRequiredDerivable };
if (require.main === module) main();
