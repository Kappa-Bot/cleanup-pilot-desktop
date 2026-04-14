const { performance } = require("perf_hooks");
const fs = require("fs");
const path = require("path");

function benchmark(label, fn) {
  const startedAt = performance.now();
  const result = fn();
  const endedAt = performance.now();
  return { label, durationMs: Number((endedAt - startedAt).toFixed(2)), result };
}

const fixturesRoot = path.join(__dirname, "..", "fixtures", "systems");
const profiles = fs.readdirSync(fixturesRoot);

const results = [
  benchmark("fixture-enumeration", () => profiles.length),
  benchmark("fixture-parse", () =>
    profiles.map((profile) =>
      JSON.parse(fs.readFileSync(path.join(fixturesRoot, profile, "system.json"), "utf8"))
    )
  )
];

console.table(results);
