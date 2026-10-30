import { expect, test } from "@playwright/test";

test("main amp NAM lives outside the pedalboard, even when previewed as A2", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Adicionar amplificador NAM" })).toBeVisible();
  await page.locator("#amp-example").selectOption("Marshall_JCM800_2203_A2.nam");
  await expect(page.locator(".amp-case")).toBeVisible();
  await expect(page.locator(".effects-grid .pedal-shell")).toHaveCount(0);

  const main = page.getByRole("region", { name: "Amplificador principal" });
  await expect(main).toBeVisible();
  await expect(main).toContainText("Arquivo não selecionado");
  await expect(main).toContainText("aplicativo desktop");
  await expect(page.getByRole("article", { name: "Áudio e dispositivos" })).toHaveCount(0);

  await page.getByRole("button", { name: "Biblioteca" }).click();
  await expect(page.getByRole("button", { name: "Adicionar VTTAMP" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Adicionar VTTDRIVE" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Adicionar VTTCAB" })).toHaveCount(0);
  await page.getByRole("button", { name: "Adicionar VTTCHORUS" }).click();
  await expect(page.getByRole("group", { name: /VTTCHORUS/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /VTTAMP|VTTDRIVE|VTTCAB/ })).toHaveCount(0);

  await page.locator("#preset-name").fill("A2 no cabeçote");
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.reload();
  await page.locator("#preset-picker").selectOption({ label: "A2 no cabeçote" });
  await expect(page.locator(".amp-case")).toBeVisible();
  await expect(page.getByRole("group", { name: /VTTCHORUS/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /VTTAMP|VTTDRIVE|VTTCAB/ })).toHaveCount(0);
});
