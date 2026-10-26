import { expect, test } from "@playwright/test";

test("settings explain native device selection without pretending browser has drivers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Configurações" }).click();
  const audio = page.getByRole("article", { name: "Áudio e dispositivos" });
  await expect(audio).toBeVisible();
  await expect(audio.getByRole("heading", { name: "Áudio e dispositivos" })).toBeVisible();
  await expect(audio.getByText(/NAM\/IR ainda não está integrado ao Tauri/)).toBeVisible();
  await expect(audio.getByRole("status")).toContainText("aplicativo desktop");
  await expect(audio.getByRole("button", { name: "Iniciar monitor DRY" })).toHaveCount(0);

  // The new settings card cannot change the pedalboard order or the amp slot.
  await page.getByRole("button", { name: "Pedalboard" }).click();
  await expect(page.getByRole("button", { name: "Adicionar amplificador NAM" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar primeiro efeito" })).toBeVisible();
});
