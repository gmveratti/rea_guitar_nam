import { expect, test } from "@playwright/test";

test("amplifier power is a working visual switch and the cable stays connected", async ({ page }) => {
  await page.goto("/");
  await page.locator("#amp-example").selectOption("Marshall_JCM800_2203_A2.nam");
  const amp = page.getByRole("region", { name: "Amplificador virtual VTTRIG" });
  const powerOff = amp.getByRole("button", { name: "Desligar amplificador" });
  await expect(powerOff).toHaveAttribute("aria-pressed", "true");
  await expect(amp.locator(".amp-art")).toHaveClass(/amp-is-on/);
  await expect(amp.locator(".amp-cable")).toBeVisible();
  await expect(amp.locator(".amp-cable-plug")).toBeVisible();
  // The complete amp must stay within the studio canvas on laptop windows.
  // Previously it could overflow left underneath the navigation rail.
  const bounds = await Promise.all([
    page.locator(".board-view").boundingBox(),
    amp.locator(".amp-case").boundingBox(),
  ]);
  expect(bounds[0]).not.toBeNull();
  expect(bounds[1]).not.toBeNull();
  const [canvas, head] = bounds as [NonNullable<typeof bounds[0]>, NonNullable<typeof bounds[1]>];
  expect(head.x).toBeGreaterThanOrEqual(canvas.x - 2);
  expect(head.x + head.width).toBeLessThanOrEqual(canvas.x + canvas.width + 2);


  await powerOff.click();
  await expect(amp.locator(".amp-art")).toHaveClass(/amp-is-off/);
  const powerOn = amp.getByRole("button", { name: "Ligar amplificador" });
  await expect(powerOn).toHaveAttribute("aria-pressed", "false");
  await powerOn.click();
  await expect(amp.locator(".amp-art")).toHaveClass(/amp-is-on/);
  await expect(amp.getByRole("button", { name: "Desligar amplificador" }))
    .toHaveAttribute("aria-pressed", "true");
});

test("Fedora WebKit form controls use legible dark backgrounds and foregrounds", async ({ page }) => {
  await page.goto("/");
  const preset = page.locator("#preset-picker");
  const model = page.locator("#amp-example");
  const name = page.locator("#preset-name");
  for (const control of [preset, model, name]) {
    await expect(control).toHaveCSS("color-scheme", "dark");
    await expect(control).toHaveCSS("background-color", "rgb(25, 26, 29)");
    await expect(control).toHaveCSS("color", "rgb(240, 233, 223)");
  }

  await page.getByRole("button", { name: "Configurações" }).click();
  const settings = page.locator("#skin-family");
  await expect(settings).toHaveCSS("background-color", "rgb(25, 26, 29)");
  await expect(settings).toHaveCSS("color", "rgb(240, 233, 223)");
});

test("focused physical pedal keeps working knobs, independent switch, and preset persistence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adicionar primeiro efeito" }).click();
  await page.getByRole("button", { name: "Adicionar VTTDELAY" }).click();
  const pedal = page.getByRole("group", { name: /VTTDELAY/ });
  await pedal.getByRole("button", { name: "Selecionar controles de VTTDELAY" }).click({
    position: { x: 20, y: 136 },
  });
  const stage = page.getByRole("dialog", { name: "Editar VTTDELAY" });
  await expect(stage).toBeVisible();
  await expect(stage.locator(".pedal-focus-mount .stomp-chassis")).toBeVisible();
  await stage.getByRole("slider", { name: "VTTDELAY: Time" }).fill("680");

  const selected = stage.getByRole("group", { name: /VTTDELAY/ });
  await selected.getByRole("button", { name: "Desligar VTTDELAY" }).click();
  await expect(selected.getByRole("img", { name: "LED desligado" })).toBeVisible();
  await expect(stage).toBeVisible();

  await page.locator("#preset-name").fill("Focused VTTDELAY");
  await stage.getByRole("button", { name: "Salvar preset" }).click();
  await expect(page.getByRole("status")).toContainText("salvo localmente");
  await stage.getByRole("button", { name: "Fechar editor do pedal" }).click();
  await expect(page.locator(".effects-grid .pedal-shell")).toHaveCount(1);

  await page.reload();
  await page.locator("#preset-picker").selectOption({ label: "Focused VTTDELAY" });
  await expect(page.getByRole("group", { name: /VTTDELAY/ })
    .getByRole("img", { name: "LED desligado" })).toBeVisible();
  await page.getByRole("group", { name: /VTTDELAY/ })
    .getByRole("button", { name: "Selecionar controles de VTTDELAY" })
    .click({ position: { x: 20, y: 136 } });
  await expect(page.getByRole("dialog", { name: "Editar VTTDELAY" }).getByText("680 ms"))
    .toBeVisible();
});
