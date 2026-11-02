import { expect, test } from "@playwright/test";

test("main amp NAM lives outside the pedalboard, even when previewed as A2", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Adicionar amplificador NAM" })).toBeVisible();
  await page.locator("#amp-example").selectOption("Marshall_JCM800_2203_A2.nam");
  await expect(page.locator(".amp-case")).toBeVisible();
  await expect(page.locator(".effects-grid .pedal-shell")).toHaveCount(0);

  const main = page.getByRole("region", { name: "Amplificador principal", exact: true });
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

test("desktop amp and IR pickers send one rig and persist its files without adding pedals", async ({ page }) => {
  // This exercises the full UI/IPC contract, not a real driver or NAM engine.
  await page.addInitScript(() => {
    const desktop = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      nativeCalls: { command: string; args: Record<string, unknown> }[];
      appliedManifest: string | null;
      nextCabPath: string;
      rejectNextUpdate: boolean;
    };
    desktop.isTauri = true;
    desktop.nativeCalls = [];
    desktop.appliedManifest = null;
    desktop.nextCabPath = "C:/Usuários/Gabi/4x12.wav";
    desktop.rejectNextUpdate = false;
    let running = false;
    let selection: unknown = null;
    desktop.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        desktop.nativeCalls.push({ command, args });
        if (command === "audio_engine_status") return "native_live_nam_ir_available";
        if (command === "audio_list_hosts") return [{
          id: "asio",
          inputs: [{ index: 0, name: "Interface USB", channels: 2, supportsMonitor: true }],
          outputs: [{ index: 0, name: "Interface USB", channels: 2, supportsMonitor: true }],
        }];
        if (command === "audio_monitor_status" || command === "audio_live_status") {
          const wet = command === "audio_live_status";
          return { running: wet && running, failed: false, inputFailed: false, outputFailed: false, engineFailed: false, underruns: 0, overflows: 0, selection: wet && running ? selection : null, appliedManifest: wet ? desktop.appliedManifest : null };
        }
        if (command === "audio_start_live") {
          running = true;
          selection = args.selection;
          desktop.appliedManifest = args.chainJson as string;
        }
        if (command === "audio_update_live") {
          if (desktop.rejectNextUpdate) {
            desktop.rejectNextUpdate = false;
            throw new Error("Não foi possível carregar o novo IR.");
          }
          desktop.appliedManifest = args.chainJson as string;
        }
        if (command === "audio_stop_live") {
          running = false;
          desktop.appliedManifest = null;
        }
        if (command === "plugin:dialog|open") {
          const options = args.options as { filters: { extensions: string[] }[] };
          return options.filters[0].extensions[0] === "nam"
            ? "C:/Usuários/Gabi/JCM900.nam" : desktop.nextCabPath;
        }
        return null;
      },
    };
  });
  await page.goto("/");
  const rig = page.getByRole("region", { name: "Amplificador principal", exact: true });
  await expect(rig).toContainText("Sem IR adicional");
  await rig.getByRole("button", { name: "Escolher NAM do amplificador principal" }).click();
  await rig.getByRole("button", { name: "Escolher IR do gabinete" }).click();
  await expect(rig).toContainText("JCM900.nam");
  await expect(rig).toContainText("4x12.wav");
  await expect(page.locator(".effects-grid .pedal-shell")).toHaveCount(0);
  await page.locator("#audio-mode").selectOption("wet");
  await expect(page.locator("#audio-host")).toHaveValue("asio");
  await page.getByRole("button", { name: "Iniciar NAM", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => {
    const state = window as unknown as { nativeCalls: { command: string; args: { chainJson?: string } }[] };
    const call = state.nativeCalls.find(entry => entry.command === "audio_start_live");
    return call?.args.chainJson ? JSON.parse(call.args.chainJson) : null;
  })).toMatchObject({ nodes: [
    { kind: "amp", resource: { path: "C:/Usuários/Gabi/JCM900.nam" } },
    { kind: "cabinet", resource: { path: "C:/Usuários/Gabi/4x12.wav" } },
  ] });
  const inputGain = page.getByRole("slider", { name: "Amplificador: Input (dB)", exact: true });
  const outputGain = page.getByRole("slider", { name: "Amplificador: Output (dB)", exact: true });
  await inputGain.press("End");
  for (let step = 0; step < 35; step += 1) await inputGain.press("ArrowLeft");
  await outputGain.press("Home");
  for (let step = 0; step < 24; step += 1) await outputGain.press("ArrowRight");
  await expect.poll(() => page.evaluate(() => {
    const applied = (window as unknown as { appliedManifest: string | null }).appliedManifest;
    return applied ? JSON.parse(applied).nodes.find((node: { kind: string }) => node.kind === "amp").parameters : null;
  })).toEqual({ input: 6.5, output: -12 });

  await page.evaluate(() => {
    (window as unknown as { nextCabPath: string }).nextCabPath = "C:/Usuários/Gabi/2x12.wav";
  });
  await rig.getByRole("button", { name: "Escolher IR do gabinete" }).click();
  await expect.poll(() => page.evaluate(() => {
    const applied = (window as unknown as { appliedManifest: string | null }).appliedManifest;
    return applied ? JSON.parse(applied).nodes.at(-1).resource.path : null;
  })).toBe("C:/Usuários/Gabi/2x12.wav");
  await rig.getByRole("button", { name: "Limpar IR do gabinete" }).click();
  await expect.poll(() => page.evaluate(() => {
    const applied = (window as unknown as { appliedManifest: string | null }).appliedManifest;
    return applied ? JSON.parse(applied).nodes.map((node: { kind: string }) => node.kind) : null;
  })).toEqual(["amp"]);

  // Navigating to the library and back must keep the current audio session.
  await page.getByRole("button", { name: /^Biblioteca\b/ }).click();
  await expect(page.getByRole("article", { name: "Áudio e dispositivos", includeHidden: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Selecionar IR do gabinete", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const applied = (window as unknown as { appliedManifest: string | null }).appliedManifest;
    return applied ? JSON.parse(applied).nodes.at(-1).resource.path : null;
  })).toBe("C:/Usuários/Gabi/2x12.wav");
  await page.getByRole("button", { name: "Adicionar VTTGATE", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const applied = (window as unknown as { appliedManifest: string | null }).appliedManifest;
    return applied ? JSON.parse(applied).nodes.map((node: { kind: string }) => node.kind) : null;
  })).toEqual(["gate", "amp", "cabinet"]);
  await page.getByRole("slider", { name: "VTTGATE Threshold", exact: true }).press("Home");
  await page.getByRole("slider", { name: "VTTGATE Threshold", exact: true }).press("ArrowRight");
  await expect.poll(() => page.evaluate(() => {
    const applied = (window as unknown as { appliedManifest: string | null }).appliedManifest;
    return applied ? JSON.parse(applied).nodes[0].parameters.threshold : null;
  })).toBe(-99);
  await page.getByRole("button", { name: "Desligar VTTGATE", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const applied = (window as unknown as { appliedManifest: string | null }).appliedManifest;
    return applied ? JSON.parse(applied).nodes[0].enabled : null;
  })).toBe(false);

  const previousManifest = await page.evaluate(() => (window as unknown as { appliedManifest: string | null }).appliedManifest);
  await page.evaluate(() => {
    const state = window as unknown as { nextCabPath: string; rejectNextUpdate: boolean };
    state.nextCabPath = "C:/Usuários/Gabi/missing.wav";
    state.rejectNextUpdate = true;
  });
  await rig.getByRole("button", { name: "Escolher IR do gabinete" }).click();
  await expect(page.getByText(/O som anterior foi mantido/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { appliedManifest: string | null }).appliedManifest)).toBe(previousManifest);
  await page.evaluate(() => {
    (window as unknown as { nextCabPath: string }).nextCabPath = "C:/Usuários/Gabi/4x12.wav";
  });
  await rig.getByRole("button", { name: "Escolher IR do gabinete" }).click();
  await expect.poll(() => page.evaluate(() => {
    const applied = (window as unknown as { appliedManifest: string | null }).appliedManifest;
    return applied ? JSON.parse(applied).nodes.at(-1).resource.path : null;
  })).toBe("C:/Usuários/Gabi/4x12.wav");
  expect(await page.evaluate(() => {
    const state = window as unknown as { nativeCalls: { command: string }[] };
    return state.nativeCalls.filter(call => call.command === "audio_start_live" || call.command === "audio_stop_live").map(call => call.command);
  })).toEqual(["audio_start_live"]);
  await page.locator("#preset-name").fill("Amp e IR");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.reload();
  await page.locator("#preset-picker").selectOption({ label: "Amp e IR" });
  await expect(rig).toContainText("4x12.wav");
  await expect(page.getByRole("slider", { name: "Amplificador: Input (dB)", exact: true })).toHaveValue("6.5");
  await expect(page.getByRole("slider", { name: "Amplificador: Output (dB)", exact: true })).toHaveValue("-12");
  await rig.getByRole("button", { name: "Limpar IR do gabinete" }).click();
  await page.reload();
  await expect(rig).toContainText("Sem IR adicional");
  await expect(rig).toContainText("JCM900.nam");
  await expect(page.locator(".effects-grid .pedal-shell")).toHaveCount(1);
});
