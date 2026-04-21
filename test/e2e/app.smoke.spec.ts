import { expect, test } from "@playwright/test";
import { installDesktopApiStub } from "./desktopApiStub";

test.use({
  baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173"
});

test.beforeEach(async ({ page }) => {
  await installDesktopApiStub(page);
});

test("runs the scan and cleanup flow with local stubs", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Scan" }).click();
  await expect(page.getByRole("heading", { name: "Scan Wizard" })).toBeVisible();

  await page.getByRole("button", { name: "Start Scan" }).click();
  await expect(page.getByRole("heading", { name: "Results Overview" })).toBeVisible();

  await page.getByRole("button", { name: "Review Cleanup Categories" }).click();
  await expect(page.getByRole("heading", { name: "Bulk cleanup workspace" })).toBeVisible();

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("2 actions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Execute Quarantine" }).click();
  await expect(page.getByText("Moved 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Freed 10.0 KB")).toBeVisible();
});

test("opens performance and exposes the optimize workspace safely", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Performance" }).click();
  await expect(page.getByRole("heading", { name: "Live monitor and diagnosis" })).toBeVisible();
});

test("loads quarantine vault pages locally", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Quarantine" }).click();
  await expect(page.getByRole("heading", { name: "Quarantine Vault" })).toBeVisible();
  await expect(page.getByText("3 total records in the vault")).toBeVisible();
  await expect(page.getByText(/Loaded 3 items in the current page window\./)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Restore" }).first()).toBeVisible();
});
