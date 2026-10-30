import { expect, test } from "@playwright/test";
import { dragPedalTo } from "./helpers/dragPedal";

test("clean navigation starts with empty board and a clear add control", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Navegação principal" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Adicionar primeiro efeito" })).toBeVisible();
  await expect(page.getByRole("group", { name: /VTTCHORUS/ })).toHaveCount(0);
  await expect(page.locator(".amp-art-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar amplificador NAM" })).toBeVisible();
  await expect(page.locator(".amp-case")).toHaveCount(0);

  await page.getByRole("button", { name: "Adicionar primeiro efeito" }).click();
  await expect(page.getByRole("region", { name: "Biblioteca de efeitos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "NAMs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "IRs" })).toBeVisible();
  await page.getByRole("button", { name: "Adicionar VTTCHORUS" }).click();
  await expect(page.getByRole("group", { name: /VTTCHORUS/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /Configurar VTTCHORUS/ })).toHaveCount(0);
});

test("body click raises pedal and opens editor; footswitch remains independent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adicionar primeiro efeito" }).click();
  await page.getByRole("button", { name: "Adicionar VTTCHORUS" }).click();
  const chorus = page.getByRole("group", { name: /VTTCHORUS/ });
  const body = chorus.getByRole("button", { name: "Selecionar controles de VTTCHORUS" });
  await expect(body).toHaveAttribute("aria-expanded", "false");
  await chorus.getByRole("button", { name: "Desligar VTTCHORUS" }).click();
  await expect(chorus.getByRole("img", { name: "LED desligado" })).toBeVisible();
  await expect(body).toHaveAttribute("aria-expanded", "false");

  await body.click({ position: { x: 20, y: 135 } });
  await expect(body).toHaveAttribute("aria-expanded", "true");
  await expect(chorus).toHaveClass(/is-selected/);
  const focusedStage = page.getByRole("dialog", { name: "Editar VTTCHORUS" });
  await expect(focusedStage).toBeVisible();
  await expect(focusedStage.locator(".pedal-focus-mount .stomp-chassis")).toBeVisible();
  await expect(page.locator(".effects-grid .pedal-focus-placeholder")).toContainText("VTTCHORUS");
  // The selected physical stompbox is raised, not a disconnected panel below the amp.
  await expect(page.locator(".board-view > .pedal-focus")).toHaveCount(0);
  const editor = page.getByRole("region", { name: "Configurar VTTCHORUS" });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("heading", { name: /VTTCHORUS/ })).toBeVisible();
  await editor.getByRole("slider", { name: "VTTCHORUS: Mix" }).fill("67");
  await expect(editor.getByText("67 %")).toBeVisible();
  await editor.getByRole("button", { name: "Ligar" }).click();
  await expect(chorus.getByRole("img", { name: "LED ligado" })).toBeVisible();

  await editor.getByRole("button", { name: "Fechar editor do pedal" }).click();
  await expect(editor).toHaveCount(0);
  await expect(body).toHaveAttribute("aria-expanded", "false");
  await body.click({ position: { x: 20, y: 135 } });
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);

  await body.click({ position: { x: 20, y: 135 } });
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "Fechar edição do pedal" }).click({ position: { x: 20, y: 20 } });
  await expect(editor).toHaveCount(0);
});

test("pedal settings and arbitrary order persist in saved rig presets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Adicionar primeiro efeito" }).click();
  await page.getByRole("button", { name: "Adicionar VTTDELAY" }).click();
  await page.getByRole("button", { name: "Adicionar efeito" }).click();
  await page.getByRole("button", { name: "Adicionar VTTCHORUS" }).click();
  const delay = page.getByRole("group", { name: /VTTDELAY/ });
  const chorus = page.getByRole("group", { name: /VTTCHORUS/ });
  await dragPedalTo(page, chorus, delay);
  await expect(page.locator(".effects-grid .pedal-shell").first()).toHaveAttribute("aria-label", /VTTCHORUS/);

  await chorus.getByRole("button", { name: "Selecionar controles de VTTCHORUS" }).click({ position: { x: 20, y: 130 } });
  const panel = page.getByRole("region", { name: "Configurar VTTCHORUS" });
  await panel.getByRole("slider", { name: "VTTCHORUS: Rate" }).fill("2.4");
  await page.locator("#preset-name").fill("My Clean Rig");
  await panel.getByRole("button", { name: "Salvar preset" }).click();
  await expect(page.getByRole("status")).toContainText("salvo localmente");

  await page.reload();
  await page.locator("#preset-picker").selectOption({ label: "My Clean Rig" });
  await expect(page.locator(".effects-grid .pedal-shell").first()).toHaveAttribute("aria-label", /VTTCHORUS/);
  await page.getByRole("group", { name: /VTTCHORUS/ }).getByRole("button", { name: "Selecionar controles de VTTCHORUS" }).click({ position: { x: 20, y: 135 } });
  await expect(page.getByRole("region", { name: "Configurar VTTCHORUS" }).getByText("2.4 Hz")).toBeVisible();
});

test("legacy demonstration rigs remain available by explicit action", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByRole("button", { name: "Carregar rig exemplo" }).click();
  await expect(page.getByRole("group", { name: /VTTGATE/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /VTTREVERB/ })).toBeAttached();
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByRole("button", { name: "Limpar" }).click();
  await expect(page.getByRole("button", { name: "Adicionar primeiro efeito" })).toBeVisible();
});


test("left navigation floats separately from header and keeps all three destinations", async ({ page }) => {
  await page.goto("/");
  const header = page.locator(".clean-topbar");
  const rail = page.getByRole("navigation", { name: "Navegação principal" });
  const tabs = rail.getByRole("button");

  await expect(tabs).toHaveCount(3);
  await expect(rail).toHaveCSS("position", "fixed");

  for (const width of [1440, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    const headerBox = await header.boundingBox();
    const railBox = await rail.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    if (!headerBox || !railBox) continue;

    // The floating rail is vertically centered without shifting the stage.
    expect(Math.abs(railBox.y + railBox.height / 2 - 450)).toBeLessThanOrEqual(2);
    expect(railBox.y - (headerBox.y + headerBox.height)).toBeGreaterThanOrEqual(12);
    expect(railBox.x).toBeGreaterThan(0);
    expect(railBox.height).toBeLessThan(450);
    expect(railBox.x + railBox.width).toBeLessThan(width / 5);
    // A position:fixed rail leaves the Grid's first column empty; the
    // main stage must explicitly occupy column two.
    const stageBox = await page.locator(".clean-stage").boundingBox();
    expect(stageBox).not.toBeNull();
    if (stageBox) expect(stageBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
    await expect(rail).not.toHaveCSS("border-top-left-radius", "0px");
  }

  // In low-height windows, use a scrollable rail beneath the header.
  await page.setViewportSize({ width: 1000, height: 450 });
  const headerBox = await header.boundingBox();
  const compactBox = await rail.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(compactBox).not.toBeNull();
  if (headerBox && compactBox) {
    expect(compactBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height + 8);
    expect(compactBox.y + compactBox.height).toBeLessThanOrEqual(450);
  }
  await expect(rail).toHaveCSS("overflow-y", "auto");

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(tabs.nth(0)).not.toHaveAttribute("aria-current", "page");
  await tabs.nth(2).click();
  await expect(tabs.nth(2)).toHaveAttribute("aria-current", "page");
  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute("aria-current", "page");
});
