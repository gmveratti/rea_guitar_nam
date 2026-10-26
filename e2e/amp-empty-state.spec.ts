import { expect, test } from "@playwright/test";

test("initial amp slot shows + until user selects a NAM", async ({ page }) => {
  await page.goto("/");
  const amp = page.getByRole("region", { name: "Amplificador virtual VTTRIG" });
  await expect(amp.getByRole("button", { name: "Adicionar amplificador NAM" })).toBeVisible();
  await expect(amp.locator(".amp-case")).toHaveCount(0);
  await expect(amp.locator(".amp-cable")).toHaveCount(0);
  await page.screenshot({ path: "test-results/vttrig-empty-amp-slot.png", fullPage: true });

  // The header can load a preview, without touching the signal chain.
  await page.locator("#amp-example").selectOption("Marshall_JCM800_2203_A2.nam");
  await expect(amp.locator(".amp-case")).toBeVisible();
  await expect(amp.locator(".amp-art")).toHaveClass(/amp-british/);
  await expect(amp.locator(".amp-cable")).toBeVisible();
  await page.screenshot({ path: "test-results/vttrig-selected-amp-cable.png", fullPage: true });

  // Returning to "no model" must bring back the plus, not a generic amplifier.
  await page.locator("#amp-example").selectOption("");
  await expect(amp.getByRole("button", { name: "Adicionar amplificador NAM" })).toBeVisible();
  await expect(amp.locator(".amp-case")).toHaveCount(0);
});

test("amp + opens NAM selector and chosen filename displays preview only", async ({ page }) => {
  await page.goto("/");
  const amp = page.getByRole("region", { name: "Amplificador virtual VTTRIG" });
  const picker = amp.locator('input[type="file"][accept=".nam"]');
  await expect(picker).toHaveCount(1);
  await picker.setInputFiles({ name: "Hiwatt_DR103.nam", mimeType: "application/octet-stream", buffer: Buffer.from("preview-only") });
  await expect(amp.locator(".amp-art")).toHaveClass(/amp-stadium/);
  await expect(amp.locator(".amp-case")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("não processa áudio");
});

test("jack plug and subtle cable attach to amp panel without spilling into controls", async ({ page }) => {
  await page.goto("/");
  await page.locator("#amp-example").selectOption("Fender_Twin_Reverb_A2.nam");
  const amp = page.getByRole("region", { name: "Amplificador virtual VTTRIG" });
  const cable = amp.locator(".amp-cable");
  await expect(cable).toBeVisible();
  const jack = await amp.locator(".jack-hole").boundingBox();
  const cord = await cable.boundingBox();
  const panel = await amp.locator(".amp-panel").boundingBox();
  expect(jack && cord && panel).toBeTruthy();
  if (jack && cord && panel) {
    expect(cord.x).toBeGreaterThan(jack.x - 10);
    expect(cord.x).toBeLessThan(jack.x + jack.width + 16);
    expect(cord.width).toBeLessThan(110);
    expect(cord.x).toBeGreaterThan(panel.x + panel.width - 85);
  }
});
