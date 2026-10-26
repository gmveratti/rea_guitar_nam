import { expect, test } from "@playwright/test";

test("web preview shows native resource placeholders without pretending a browser plays NAM", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Biblioteca" }).click();
  await page.getByRole("button", { name: "Adicionar VTTAMP" }).first().click();
  const resourceSection = page.getByRole("region", { name: "Modelos e IRs do rig" });
  await expect(resourceSection).toBeVisible();
  await expect(resourceSection.getByText("VTTAMP · NAM")).toBeVisible();
  await expect(resourceSection.getByText("Arquivo não selecionado")).toBeVisible();
  await expect(resourceSection).toContainText("aplicativo desktop");
  await expect(page.getByRole("article", { name: "Áudio e dispositivos" })).toHaveCount(0);

  await page.getByRole("group", { name: /VTTAMP/ })
    .getByRole("button", { name: "Desligar VTTAMP" }).click();
  await expect(page.getByRole("group", { name: /VTTAMP/ })
    .getByRole("button", { name: "Ligar VTTAMP" })).toBeVisible();
  await page.locator("#preset-name").fill("Minha cadeia NAM");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toContainText("salvo localmente");
  await page.reload();
  await page.locator("#preset-picker").selectOption({ label: "Minha cadeia NAM" });
  await expect(page.getByRole("group", { name: /VTTAMP/ })
    .getByRole("button", { name: "Ligar VTTAMP" })).toBeVisible();
});
