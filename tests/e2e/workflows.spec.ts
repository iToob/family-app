import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=username]", user);
  await page.fill("input[name=password]", "demo-password");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(admin|home)/);
}

const toast = (page: Page, text: string | RegExp) => page.locator("[role=status]").filter({ hasText: text });

async function available(page: Page) {
  await page.goto("/home");
  const text = await page.locator(".banknote .font-display").first().innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe.configure({ mode: "serial" });

test("Workflow A: child claims and submits a job, parent approves, balance rises", async ({ page }) => {
  await login(page, "child14");
  const before = await available(page);
  await page.goto("/earn");
  const card = page.locator("li", { hasText: "Take out and wash the bins" });
  await card.getByRole("button", { name: "Claim" }).click();
  await expect(page.getByText("Job claimed")).toBeVisible();
  await page.fill("textarea[name=notes]", "Bins out and hosed");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(toast(page, "Submitted for approval")).toBeVisible();

  await login(page, "parent2");
  await page.goto("/admin/approvals");
  const item = page.locator("li", { hasText: "Take out and wash the bins" });
  await item.getByRole("button", { name: "Approve and pay" }).click();
  await expect(toast(page, "Approved and paid")).toBeVisible();

  await login(page, "child14");
  expect(await available(page)).toBe(before + 30);
  await page.goto("/wallet");
  await expect(page.getByText("Take out and wash the bins").first()).toBeVisible();
});

test("Workflow D: insufficient Points shows the gap and no buy button", async ({ page }) => {
  await login(page, "child16"); // 200 available in the demo data
  await page.goto("/spend");
  const row = page.locator("li", { hasText: "Premium phone plan" });
  await expect(row.getByText(/200 more Points needed/)).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
});

test("Parents add Points and record a spend from the dashboard", async ({ page }) => {
  await login(page, "child16");
  const before = await available(page);

  await login(page, "parent1");
  await page.goto("/admin");
  await page.getByText("+ Add Points").click();
  const add = page.locator("details", { hasText: "+ Add Points" });
  await add.locator("select[name=memberId]").selectOption({ label: "Child B (16)" });
  await add.locator("input[name=points]").fill("75");
  await add.locator("input[name=reason]").fill("Helped carry shopping");
  await add.getByRole("button", { name: "Add Points" }).click();
  await expect(toast(page, "Points added")).toBeVisible();

  await page.getByText("− Record a spend").click();
  const spend = page.locator("details", { hasText: "− Record a spend" });
  const direct = spend.locator("form", { has: page.locator("input[name=description]") });
  await direct.locator("select[name=memberId]").selectOption({ label: "Child B (16)" });
  await direct.locator("input[name=points]").fill("25");
  await direct.locator("input[name=description]").fill("Ice cream");
  await direct.getByRole("button", { name: "Record spend" }).click();
  await expect(toast(page, "Spend recorded")).toBeVisible();

  await login(page, "child16");
  expect(await available(page)).toBe(before + 50);
});

test("Cash-out: request reserves Points; parent records payment once", async ({ page }) => {
  await login(page, "child18");
  const before = await available(page);
  await page.goto("/wallet/cash-out");
  await page.fill("input[name=points]", "100");
  await expect(page.getByText("= $10.00")).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Request cash" }).click();
  await expect(toast(page, /Request sent/)).toBeVisible();
  expect(await available(page)).toBe(before - 100);

  await login(page, "parent1");
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto("/admin/approvals");
  const req = page.locator("li", { hasText: "$10.00 for Child C (18)" });
  await req.getByRole("button", { name: "I've paid it" }).click();
  await expect(toast(page, "Payment recorded")).toBeVisible();
  await expect(page.locator("li", { hasText: "$10.00 for Child C (18)" })).toHaveCount(0);

  await login(page, "child18");
  expect(await available(page)).toBe(before - 100);
  await page.goto("/wallet/cash-out");
  await expect(page.getByText("Paid").first()).toBeVisible();
});

test("Children cannot reach admin pages or exports", async ({ page }) => {
  await login(page, "child16");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/home$/);
  const res = await page.request.get("/api/export/ledger");
  expect(res.status()).toBe(403);
});

test("View-only mode: kids see everything but can't act", async ({ page }) => {
  await login(page, "parent1");
  await page.goto("/admin/settings");
  const box = page.getByLabel(/Kids can make requests/);
  if (await box.isChecked()) await box.uncheck();
  await page.locator("form", { has: box }).getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Settings saved")).toBeVisible();

  await login(page, "child16");
  await page.goto("/earn");
  await expect(page.getByText(/view-only/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
  await page.goto("/spend");
  await expect(page.getByRole("button", { name: /Buy|Request/ })).toHaveCount(0);
});

test("CSV export downloads for parents", async ({ page }) => {
  await login(page, "parent1");
  const res = await page.request.get("/api/export/ledger");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("occurred_at_utc");
  expect(body).toContain("Demo opening balance");
});

test("Cron endpoint requires the secret", async ({ request }) => {
  expect((await request.get("/api/cron/maintenance")).status()).toBe(401);
  const ok = await request.get("/api/cron/maintenance", { headers: { authorization: "Bearer e2e-cron" } });
  expect(ok.status()).toBe(200);
});

test("Recovery: wrong code is refused; right code resets a parent password", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Recover account" }).click();
  await page.fill("input[name=code]", "wrong-code-000000");
  await page.fill("input[name=username]", "parent2");
  await page.fill("input[name=password]", "brand-new-pass");
  await page.fill("input[name=confirm]", "brand-new-pass");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("isn't right");

  await page.fill("input[name=code]", "e2e-recovery-code-123");
  await page.fill("input[name=username]", "child16"); // children can't be recovered this way
  await page.fill("input[name=password]", "brand-new-pass");
  await page.fill("input[name=confirm]", "brand-new-pass");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("isn't right");

  await page.fill("input[name=code]", "e2e-recovery-code-123");
  await page.fill("input[name=username]", "parent2");
  await page.fill("input[name=password]", "brand-new-pass");
  await page.fill("input[name=confirm]", "brand-new-pass");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(toast(page, "Password reset")).toBeVisible();

  await page.goto("/login");
  await page.fill("input[name=username]", "parent2");
  await page.fill("input[name=password]", "brand-new-pass");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/admin/);
});
