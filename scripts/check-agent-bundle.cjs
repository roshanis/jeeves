/* eslint-disable @typescript-eslint/no-require-imports -- Loads the CommonJS webpack server runtime directly. */
/* Offline regression for the webpack production artifact, not a provider smoke.
 * Run after: DATA_PROVIDER=mock npm run build -- --webpack
 *   node scripts/check-agent-bundle.cjs [path/to/.next/standalone]
 * Copies only the deployable artifact to OS temp and blocks source-tree asset
 * reads and network access. No database, credentials, or application mutation.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");

function checkBundle() {
  const root = process.cwd();
  let networkCalls = 0;
  const forbidNetwork = () => {
    networkCalls++;
    throw new Error("Network forbidden in packaged-agent regression");
  };
  globalThis.fetch = forbidNetwork;
  for (const name of ["node:http", "node:https"]) {
    const transport = require(name);
    transport.request = transport.get = forbidNetwork;
  }
  const net = require("node:net");
  net.connect = net.createConnection = forbidNetwork;
  require("node:tls").connect = forbidNetwork;

  const readFile = fs.readFileSync;
  const reads = new Set();
  let missingAsset;
  fs.readFileSync = function (file, ...args) {
    if (typeof file === "string" && file.endsWith(".md")) {
      const relative = path.relative(root, path.resolve(file));
      // A build-source path may still exist on a CI/developer machine. Refuse
      // it so it cannot conceal a broken deployable bundle.
      assert(!relative.startsWith("..") && !path.isAbsolute(relative), "Agent attempted a build-source asset read");
      if (relative === missingAsset) {
        const error = new Error("ENOENT private diagnostic path");
        error.code = "ENOENT";
        throw error;
      }
      reads.add(relative);
    }
    return readFile.call(this, file, ...args);
  };

  const load = require(path.join(root, ".next/server/webpack-runtime.js"));
  require(path.join(root, ".next/server/app/api/initiatives/[id]/draft-run/route.js"));
  process.env.OPENAI_API_KEY = "";
  // Webpack mangles module ids and export names. Locate the existing factory
  // by its narrow descriptor/preflight shape, never by credentials text that
  // now belongs to the resolver. This is deliberately implementation-coupled:
  // fail closed on zero/multiple matches instead of trying arbitrary exports.
  const portFactoryShape = (value) => {
    const source = String(value);
    return /\.configured\b/.test(source)
      && /\.deepReviewEnabled\b/.test(source)
      && /["']agents-sdk["']/.test(source)
      && /\bcatch\s*\(/.test(source);
  };
  const candidates = new Set();
  for (const [id, factory] of Object.entries(load.m)) {
    if (!portFactoryShape(factory)) continue;
    for (const value of Object.values(load(id))) {
      if (typeof value === "function" && portFactoryShape(value)) candidates.add(value);
    }
  }
  assert.equal(candidates.size, 1, "Expected exactly one compiled getAgentPort factory matching descriptor/preflight shape");
  const [getPort] = candidates;
  assert.equal(typeof getPort().draftReview, "function");
  assert.equal(reads.size, 0, "Keyless mock unexpectedly needs live assets");
  process.env.OPENAI_API_KEY = "diagnostic-placeholder-never-sent";
  for (const runtime of ["ai-sdk", "agents-sdk"]) {
    process.env.JEEVES_AGENT_RUNTIME = runtime;
    process.env.JEEVES_DEEP_REVIEW = "0";
    assert.equal(typeof getPort().draftReview, "function");
    assert(reads.has("agents/reviewer/instructions.md"));
    assert(reads.has("agents/reviewer/tracks/privacy-hipaa.md"));
    missingAsset = "agents/reviewer/instructions.md";
    assert.throws(getPort, { name: "AgentInitializationError", message: "Agent runtime could not initialize. Check the deployed prompts and policies." });
    missingAsset = undefined;
    console.log(`${runtime}: relocated initialization and safe missing-prompt failure passed`);
  }
  process.env.JEEVES_DEEP_REVIEW = "1";
  assert.equal(typeof getPort().draftReview, "function");
  for (const file of ["docs/policies/INDEX.md", "docs/policies/legal.md", "docs/policies/fast-lane-policy.md"]) {
    assert(reads.has(file), `Deep review did not read packaged ${file}`);
  }
  missingAsset = "docs/policies/legal.md";
  assert.throws(getPort, { name: "AgentInitializationError", message: "Agent runtime could not initialize. Check the deployed prompts and policies." });
  assert.equal(networkCalls, 0);
  console.log("Deep-review policies and safe missing-policy failure passed; zero network calls");
}

if (process.argv[2] === "--worker") {
  checkBundle();
} else {
  const source = path.resolve(process.argv[2] || ".next/standalone");
  assert(fs.existsSync(path.join(source, "server.js")), "Build the webpack standalone artifact first");
  const relocated = fs.mkdtempSync(path.join(tmpdir(), "jeeves-agent-bundle-"));
  if (fs.lstatSync(path.join(source, "node_modules")).isSymbolicLink()) {
    console.log("Note: local artifact reuses installed dependencies via symlink; this check validates packaged app assets.");
  }
  fs.cpSync(source, relocated, {
    recursive: true,
    filter: (file) => !path.basename(file).startsWith(".env"),
  });
  const result = spawnSync(process.execPath, [__filename, "--worker"], {
    cwd: relocated,
    // Deliberately do not inherit keys, database URLs, tracing or NODE_OPTIONS.
    env: { PATH: process.env.PATH, NODE_ENV: "production", JEEVES_AGENT_TRACING: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "Relocated agent bundle check failed");
  console.log("Packaged-agent regression passed (temporary artifact retained for inspection)");
}
