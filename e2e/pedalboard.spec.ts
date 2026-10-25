import { expect, test } from "@playwright/test";

test("VTTRIG shows branded pedals, pedal LED and a family-specific amplifier", async ({ page }) => {
  await page.goto("/");
  // The new default is a clean, empty chain. Explicitly load the legacy
  // demonstration chain when testing its modules and old preset workflows.
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByRole("button", { name: "Carregar rig exemplo" }).click();
  await expect(page.getByText("VTTRIG").first()).toBeVisible();
  const chorus = page.getByRole("group", { name: /VTTCHORUS/ });
  await expect(chorus).toBeVisible();
  await expect(chorus.getByRole("img", { name: "LED ligado" })).toBeVisible();

  await chorus.getByRole("button", { name: "Desligar VTTCHORUS" }).click();
  await expect(chorus.getByRole("img", { name: "LED desligado" })).toBeVisible();
  await chorus.getByRole("button", { name: "Ligar VTTCHORUS" }).click();
  await expect(chorus.getByRole("img", { name: "LED ligado" })).toBeVisible();

  await page.locator("#amp-example").selectOption("Fender_Twin_Reverb_A2.nam");
  await expect(page.locator(".amp-art")).toHaveClass(/amp-american/);
  await expect(page.locator(".amp-channel strong").getByText("AMERICAN DELUXE")).toBeVisible();
  await page.locator("#amp-example").selectOption("Hiwatt_DR103_Classic.nam");
  await expect(page.locator(".amp-art")).toHaveClass(/amp-stadium/);


  // Keep the sticky header at the document origin when capturing full-page previews.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/vttrig-amp-view.png", fullPage: true });
  await page.locator(".effects-grid").evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/vttrig-effects-view.png", fullPage: true });
});

test("presets preserve the chain and LED bypass state across reload", async ({ page }) => {
  await page.goto("/");
  // The new default is a clean, empty chain. Explicitly load the legacy
  // demonstration chain when testing its modules and old preset workflows.
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByRole("button", { name: "Carregar rig exemplo" }).click();
  const delay = page.getByRole("group", { name: /VTTDELAY/ });
  await delay.getByRole("button", { name: "Desligar VTTDELAY" }).click();
  await page.locator("#amp-example").selectOption("Vox_AC30_TopBoost.nam");
  await page.locator("#preset-name").fill("Studio Demo");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toContainText("salvo localmente");
  await page.reload();
  const saved = page.locator("#preset-picker");
  await expect(saved.locator("option")).toContainText(["Selecionar preset salvo", "Studio Demo"]);
  await saved.selectOption({ label: "Studio Demo" });
  await expect(page.getByRole("group", { name: /VTTDELAY/ }).getByRole("img", { name: "LED desligado" })).toBeVisible();
  await expect(page.locator(".amp-art")).toHaveClass(/amp-chime/);
});
