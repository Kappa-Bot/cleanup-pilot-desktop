import fs from "fs";
import path from "path";
import { visualThemeItems } from "../src/features/pipeline/pipelineShared";

const pipelineCss = fs.readFileSync(path.join(__dirname, "..", "src", "features", "pipeline", "pipeline.css"), "utf8");

describe("Pipeline visual system", () => {
  it("defines scoped readable metric and trust styles inside the pipeline shell", () => {
    expect(pipelineCss).toContain(".pipeline-app-shell .product-metric-card");
    expect(pipelineCss).toContain(".pipeline-app-shell .product-metric-card small");
    expect(pipelineCss).toContain(".pipeline-app-shell .trust-badge--safe_win");
    expect(pipelineCss).toContain(".pipeline-app-shell .trust-badge--blocked");
  });

  it("offers production dark themes with shell tokens and swatches", () => {
    const themeIds = visualThemeItems.map((item) => item.id);
    expect(themeIds).toEqual(expect.arrayContaining(["midnight", "onyx"]));
    expect(pipelineCss).toContain('.pipeline-app-shell[data-theme="midnight"]');
    expect(pipelineCss).toContain('.pipeline-app-shell[data-theme="onyx"]');
    expect(pipelineCss).toContain(".theme-swatch-midnight");
    expect(pipelineCss).toContain(".theme-swatch-onyx");
  });
});
