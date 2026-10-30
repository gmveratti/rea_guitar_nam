import type { Locator, Page } from "@playwright/test";

/**
 * Exercise the application's actual HTML5 dragstart/drop handlers with one
 * DataTransfer instance. This avoids Chromium's intermittent pointer-based
 * dragTo misses inside the horizontally scrollable, scroll-snapping pedal row.
 * It does not manipulate React state or bypass the board's drop handler.
 */
export async function dragPedalTo(page: Page, source: Locator, target: Locator) {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  try {
    await source.locator(".stomp-drag").dispatchEvent("dragstart", { dataTransfer: transfer });
    await target.dispatchEvent("dragover", { dataTransfer: transfer });
    await target.dispatchEvent("drop", { dataTransfer: transfer });
    await source.locator(".stomp-drag").dispatchEvent("dragend", { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
}
