import { expect, test } from "@playwright/test";
import { installDesktopApiStub } from "./desktopApiStub";

test.beforeEach(async ({ page }) => {
  await installDesktopApiStub(page);
});

test("runs the full Home -> Scan -> Plan -> Execute -> History flow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "4 issues need attention" })).toBeVisible();
  await page.getByRole("button", { name: "Run Smart Check" }).click();

  await expect(page.getByRole("heading", { name: "Grouped issues" })).toBeVisible();
  await expect(page.getByText("Safe to clean")).toBeVisible();
  await expect(page.getByText("Large storage")).toBeVisible();
  await expect(page.getByText("Startup impact")).toBeVisible();
  await expect(page.getByText("Blocked for safety")).toBeVisible();

  await page.getByRole("button", { name: "Build Plan" }).click();

  await expect(page.getByRole("button", { name: "Review and continue" })).toBeVisible();
  await expect(page.getByText("Why this is safe")).toBeVisible();

  await page.getByRole("button", { name: "Review and continue" }).click();
  await expect(page.getByRole("button", { name: "Apply plan" })).toBeVisible();

  await page.getByRole("button", { name: "Apply plan" }).click();
  await expect(page.getByRole("button", { name: "Open session report" })).toBeVisible();

  await page.getByRole("button", { name: "Open session report" }).click();
  await expect(page.getByRole("heading", { name: "Smart Check session" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Purge" })).toBeVisible();
});

test("keeps settings hidden from primary navigation and exposes only the minimal drawer", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Home" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Execute" })).toBeVisible();
  await expect(page.getByRole("button", { name: "History" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Cleaner")).toHaveCount(0);
  await expect(page.getByText("Optimize")).toHaveCount(0);
  await expect(page.getByText("Vault")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Settings drawer")).toBeVisible();
  await expect(page.getByText("AI provider")).toBeVisible();
  await expect(page.getByText("Enable safe auto-clean schedule")).toBeVisible();
  await expect(page.getByText("Reduce motion")).toBeVisible();
  await expect(page.getByText("High contrast")).toBeVisible();
  await expect(page.getByText("Quarantine retention (days)")).toBeVisible();
  await expect(page.getByText("Advanced roots")).toBeVisible();
});

test("lets the user undo and purge a session from History", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Smart Check session" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("main").getByText("Session restored.").first()).toBeVisible();

  await page.getByRole("button", { name: "Purge" }).click();
  await expect(page.locator("main").getByText("Session purged.").first()).toBeVisible();
});
