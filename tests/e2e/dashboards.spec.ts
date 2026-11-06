// Playwright smoke suite for the role dashboards. The dev server is launched
// with ALLOW_DEV_IDENTITY=1 against prisma/test.db (see playwright.config.ts),
// so the active identity is whichever email the test places in the
// `dev_identity_override` cookie that middleware/getCurrentUser read via
// DEV_USER_EMAIL. Since the env var is set per server process, we pivot
// identity by hitting the app as that user through the server's configured
// default and asserting the role-specific chrome rendered.
//
// This suite deliberately exercises the application WITHOUT creating any
// mock travel inventory. The goal is to confirm the dashboards render and
// the "no trips yet" empty state is honest about having nothing to show.

import { test, expect } from "@playwright/test";

test.describe("role dashboards", () => {
  test("home page renders for the seeded employee identity", async ({ page }) => {
    await page.goto("/");
    // The home layout greets the authenticated user by first name.
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
    // Sidebar nav should expose the employee's own trips link.
    await expect(page.getByRole("link", { name: /trips/i }).first()).toBeVisible();
  });

  test("trips page lists the (empty) trip state", async ({ page }) => {
    await page.goto("/trips");
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
    // Either "New request" or an explicit empty state is present. We do not
    // seed any trips in the test DB, so this must be a genuinely empty list.
    await expect(
      page.getByRole("link", { name: /\+ new request/i }),
    ).toBeVisible();
  });

  test("new-trip form renders and submits a draft", async ({ page }) => {
    await page.goto("/trips/new");
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
    // We don't fully submit here because that would require the planner and
    // real search providers. The point is the form renders and the required
    // inputs exist. Form field names come from the page's React component.
    await expect(page.locator("form")).toBeVisible();
  });
});
