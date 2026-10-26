import { expect, test } from "@playwright/test";

test("visual amplifier draft survives WebView navigation and reload", async ({ page }) => {
  await page.goto("/");
  const model = page.locator("#amp-example");
  await model.selectOption("Marshall_JCM800_2203_A2.nam");
  await expect(model).toHaveValue("Marshall_JCM800_2203_A2.nam");

  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByRole("button", { name: "Pedalboard" }).click();
  await expect(page.locator("#amp-example")).toHaveValue("Marshall_JCM800_2203_A2.nam");

  await page.reload();
  await expect(page.locator("#amp-example")).toHaveValue("Marshall_JCM800_2203_A2.nam");
  await expect(page.getByRole("button", { name: "Desligar amplificador" })).toBeVisible();
});
