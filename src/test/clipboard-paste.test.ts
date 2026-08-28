import { clipboardPasteMessage, pasteClipboardIntoWebview } from "../webview/clipboard-paste";

describe("clipboardPasteMessage", () => {
  it("posts the text the iframe Dev page already understands as clipboardPaste", () => {
    expect(clipboardPasteMessage("abc-123")).toEqual({
      type: "clipboardPaste",
      text: "abc-123",
    });
  });
});

describe("pasteClipboardIntoWebview", () => {
  it("reads the host clipboard and posts it to the preview webview", async () => {
    const posted: unknown[] = [];
    const ok = await pasteClipboardIntoWebview(
      { postMessage: async (msg) => { posted.push(msg); return true; } },
      async () => "long-numeric-id"
    );
    expect(ok).toBe(true);
    expect(posted).toEqual([{ type: "clipboardPaste", text: "long-numeric-id" }]);
  });

  it("does not post when the clipboard is empty", async () => {
    const posted: unknown[] = [];
    const ok = await pasteClipboardIntoWebview(
      { postMessage: async (msg) => { posted.push(msg); return true; } },
      async () => ""
    );
    expect(ok).toBe(false);
    expect(posted).toEqual([]);
  });
});
