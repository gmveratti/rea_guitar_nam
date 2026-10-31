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
  await page.locator(".effects-grid").evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await page.evaluate(() => window.scrollTo(0, 0));
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
  await expect(saved.locator("option")).toContainText(["Personalizado", "Studio Demo"]);
  await saved.selectOption({ label: "Studio Demo" });
  await expect(page.getByRole("group", { name: /VTTDELAY/ }).getByRole("img", { name: "LED desligado" })).toBeVisible();
  await expect(page.locator(".amp-art")).toHaveClass(/amp-chime/);
});

test("Personalizado saves a new preset without overwriting the original (issue #28)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adicionar primeiro efeito" }).click();
  await page.getByRole("button", { name: "Adicionar VTTCHORUS" }).click();
  await page.locator("#preset-name").fill("Preset Original");
  await page.getByRole("button", { name: "Salvar preset", exact: true }).first().click();
  const picker = page.locator("#preset-picker");
  const originalId = await picker.inputValue();
  expect(originalId).not.toBe("");
  await expect(picker.locator("option")).toHaveCount(2);

  // Switching to "Personalizado" must not clear the current rig or its settings.
  await picker.selectOption("");
  await expect(picker).toHaveValue("");
  await expect(page.getByRole("group", { name: /VTTCHORUS/ })).toBeVisible();

  // Make a variant of the existing preset, rather than replacing its ID.
  await page.getByRole("button", { name: "Adicionar efeito" }).click();
  await page.getByRole("button", { name: "Adicionar VTTDELAY" }).click();
  await page.locator("#preset-name").fill("Preset Variacao");
  await page.getByRole("button", { name: "Salvar preset", exact: true }).first().click();
  const variantId = await picker.inputValue();
  expect(variantId).not.toBe(originalId);
  await expect(picker.locator("option")).toHaveCount(3);

  await page.reload();
  await picker.selectOption(originalId);
  await expect(page.getByRole("group", { name: /VTTCHORUS/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /VTTDELAY/ })).toHaveCount(0);
  await picker.selectOption(variantId);
  await expect(page.getByRole("group", { name: /VTTCHORUS/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /VTTDELAY/ })).toBeVisible();
});
