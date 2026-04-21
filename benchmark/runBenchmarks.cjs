const { performance } = require("perf_hooks");
const fs = require("fs");
const path = require("path");
const React = require("react");
const { flushSync } = require("react-dom");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

function round(value) {
  return Number(value.toFixed(2));
}

function benchmark(label, fn, iterations = 1) {
  const samples = [];
  let result;
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    result = fn(index);
    const endedAt = performance.now();
    samples.push(endedAt - startedAt);
  }

  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    label,
    iterations,
    durationMs: round(total / Math.max(1, samples.length)),
    minMs: round(Math.min(...samples)),
    maxMs: round(Math.max(...samples)),
    result
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadSystemFixtures() {
  const fixturesRoot = path.join(__dirname, "..", "fixtures", "systems");
  return fs
    .readdirSync(fixturesRoot)
    .sort()
    .map((profile) => ({
      profile,
      system: readJson(path.join(fixturesRoot, profile, "system.json"))
    }));
}

function createSyntheticFindings(system, profile) {
  const categories = ["temp", "cache", "logs", "installer_artifacts", "wsl_leftovers", "minecraft_leftovers"];
  const findings = [];
  const total = Math.max(12, Math.round((system.startupEntries + system.services + system.scheduledTasks) / 20));

  for (let index = 0; index < total; index += 1) {
    const category = categories[index % categories.length];
    const sizeBytes = 64_000 + (index + 1) * 12_500 + system.startupEntries * 600;
    findings.push({
      id: `${profile}-${category}-${index}`,
      path: `C:\\fixtures\\${profile}\\${category}\\item-${index}.bin`,
      category,
      sizeBytes,
      risk: index % 5 === 0 ? "high" : index % 3 === 0 ? "medium" : "low",
      reason: `${category} residue`,
      sourceRuleId: `${category}-rule`,
      selectedByDefault: index % 4 !== 0,
      modifiedAt: 1_700_000_000_000 - index * 60_000,
      kind: index % 7 === 0 ? "directory" : "file",
      entryCount: index % 7 === 0 ? 3 + (index % 5) : undefined
    });
  }

  return findings;
}

function summarizeCleanupSelection(findings) {
  const selected = findings.filter((item) => item.selectedByDefault);
  const totalBytes = selected.reduce((sum, item) => sum + item.sizeBytes, 0);
  const riskFlags = {
    highRiskCount: selected.filter((item) => item.risk === "high").length,
    mediumRiskCount: selected.filter((item) => item.risk === "medium").length,
    blockedCount: selected.filter((item) => item.path.toLowerCase().includes("windows")).length
  };

  return {
    actionCount: selected.length,
    totalBytes,
    riskFlags
  };
}

function createRendererTree(profile, system, findings) {
  const cards = findings.slice(0, 24).map((item) =>
    React.createElement(
      "article",
      { key: item.id, className: "mini-card" },
      React.createElement("small", null, item.category),
      React.createElement("strong", null, `${Math.round(item.sizeBytes / 1024)} KB`),
      React.createElement("span", { className: "muted" }, item.path)
    )
  );

  return React.createElement(
    "section",
    { className: "benchmark-shell" },
    React.createElement(
      "header",
      null,
      React.createElement("h1", null, `${profile} profile`),
      React.createElement("p", null, `${system.cpuModel} / ${Math.round(system.totalRamBytes / 1024 / 1024 / 1024)} GB`)
    ),
    React.createElement("div", { className: "benchmark-grid" }, cards)
  );
}

function measureRendererMount(profileData) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost"
  });

  const previous = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    requestAnimationFrame: global.requestAnimationFrame,
    cancelAnimationFrame: global.cancelAnimationFrame,
    ResizeObserver: global.ResizeObserver
  };

  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
  global.cancelAnimationFrame = (handle) => clearTimeout(handle);
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  try {
    const container = dom.window.document.getElementById("root");
    const root = createRoot(container);
    flushSync(() => {
      root.render(createRendererTree(profileData.profile, profileData.system, profileData.findings));
    });
    root.unmount();
    return container.children.length;
  } finally {
    global.window = previous.window;
    global.document = previous.document;
    global.navigator = previous.navigator;
    global.requestAnimationFrame = previous.requestAnimationFrame;
    global.cancelAnimationFrame = previous.cancelAnimationFrame;
    global.ResizeObserver = previous.ResizeObserver;
    dom.window.close();
  }
}

function collectBundleSizeReport() {
  const distRoot = path.join(__dirname, "..", "dist");
  if (!fs.existsSync(distRoot)) {
    return { available: false, reason: "dist/ not found" };
  }

  const stack = [distRoot];
  const files = [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(resolved);
        continue;
      }
      if (entry.isFile()) {
        files.push(resolved);
      }
    }
  }

  const selected = files.filter((filePath) => /\.(js|css|mjs)$/i.test(filePath));
  const byExtension = selected.reduce((accumulator, filePath) => {
    const extension = path.extname(filePath).slice(1) || "unknown";
    const size = fs.statSync(filePath).size;
    accumulator[extension] = (accumulator[extension] || 0) + size;
    accumulator.total = (accumulator.total || 0) + size;
    return accumulator;
  }, {});

  return {
    available: true,
    fileCount: selected.length,
    totalBytes: byExtension.total || 0,
    jsBytes: byExtension.js || 0,
    cssBytes: byExtension.css || 0,
    mjsBytes: byExtension.mjs || 0
  };
}

const fixtures = loadSystemFixtures();

const results = [
  benchmark("fixture-enumeration", () => fixtures.length),
  benchmark("fixture-json-parse", () => fixtures.map((item) => item.system)),
  benchmark("ipc-scan-payload-roundtrip", () =>
    JSON.parse(
      JSON.stringify(
        fixtures.map((item) => ({
          profile: item.profile,
          request: {
            preset: "standard",
            categories: ["temp", "cache", "logs"],
            roots: [`C:\\fixtures\\${item.profile}`]
          },
          findings: createSyntheticFindings(item.system, item.profile)
        }))
      )
    )
  ),
  benchmark("cleanup-preview-fixture", () => fixtures.map((item) => summarizeCleanupSelection(createSyntheticFindings(item.system, item.profile)))),
  benchmark("renderer-mount-synthetic", () =>
    fixtures.map((item) =>
      measureRendererMount({
        ...item,
        findings: createSyntheticFindings(item.system, item.profile)
      })
    )
  ),
  benchmark("bundle-size-report", () => collectBundleSizeReport())
];

console.table(
  results.map((entry) => ({
    label: entry.label,
    iterations: entry.iterations,
    durationMs: entry.durationMs,
    minMs: entry.minMs,
    maxMs: entry.maxMs
  }))
);

const bundleSizeResult = results.find((entry) => entry.label === "bundle-size-report")?.result;
if (bundleSizeResult?.available) {
  console.log(
    JSON.stringify(
      {
        bundleSizeBytes: bundleSizeResult.totalBytes,
        jsBytes: bundleSizeResult.jsBytes,
        cssBytes: bundleSizeResult.cssBytes,
        files: bundleSizeResult.fileCount
      },
      null,
      2
    )
  );
} else {
  console.log(`Bundle size report skipped: ${bundleSizeResult?.reason ?? "unknown reason"}`);
}
