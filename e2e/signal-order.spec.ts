import { expect, test } from "@playwright/test";

test("reordering pedals changes the chain order and survives saving a preset", async ({ page }) => {
  await page.goto("/");
  // The new default is a clean, empty chain. Explicitly load the legacy
  // demonstration chain when testing its modules and old preset workflows.
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByRole("button", { name: "Carregar rig exemplo" }).click();

  const pedals = page.locator(".effects-grid .pedal-shell");
  await expect(pedals.first()).toHaveAttribute("aria-label", /VTTGATE/);
  await expect(pedals.nth(1)).toHaveAttribute("aria-label", /VTTCOMP/);

  // Real UI drag handle, not a direct state mutation.
  const gate = page.getByRole("group", { name: /VTTGATE/ });
  const compressor = page.getByRole("group", { name: /VTTCOMP/ });
  await gate.locator(".stomp-drag").dragTo(compressor.locator(".stomp-topbar"));

  // The old fixed signal order would fail here.
  await expect(pedals.first()).toHaveAttribute("aria-label", /VTTCOMP/);
  await expect(pedals.nth(1)).toHaveAttribute("aria-label", /VTTGATE/);

  await page.locator("#preset-name").fill("Custom Chain Regression");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toContainText("salvo localmente");

  await page.reload();
  await page.locator("#preset-picker").selectOption({ label: "Custom Chain Regression" });
  await expect(pedals.first()).toHaveAttribute("aria-label", /VTTCOMP/);
  await expect(pedals.nth(1)).toHaveAttribute("aria-label", /VTTGATE/);
});
