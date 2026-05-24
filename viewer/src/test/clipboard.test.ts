import assert from "node:assert/strict";
import test from "node:test";
import { copyTextToClipboard } from "../main/clipboard.ts";

test("copying text falls back to clipboard.write when writeText is rejected", async () => {
  const copiedItems: unknown[] = [];
  class FakeBlob {
    constructor(
      readonly parts: readonly string[],
      readonly options: { type: string },
    ) {}
  }
  class FakeClipboardItem {
    constructor(readonly items: Record<string, FakeBlob>) {}
  }

  const copied = await copyTextToClipboard("CodeCharter annotation prompt", {
    ClipboardItem: FakeClipboardItem as unknown as typeof ClipboardItem,
    Blob: FakeBlob as unknown as typeof Blob,
    navigator: {
      clipboard: {
        writeText: async () => {
          throw new DOMException("Clipboard writeText denied", "NotAllowedError");
        },
        write: async (items) => {
          copiedItems.push(...items);
        },
      },
    },
  });

  assert.equal(copied, true);
  assert.equal(copiedItems.length, 1);
});
