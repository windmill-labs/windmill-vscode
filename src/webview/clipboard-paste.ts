export const CLIPBOARD_PASTE_TYPE = "clipboardPaste";

export function clipboardPasteMessage(text: string): { type: string; text: string } {
  return { type: CLIPBOARD_PASTE_TYPE, text };
}

export async function pasteClipboardIntoWebview(
  webview: { postMessage: (message: unknown) => Thenable<boolean> },
  readText: () => Thenable<string>
): Promise<boolean> {
  const text = await readText();
  if (text === "") {
    return false;
  }
  return webview.postMessage(clipboardPasteMessage(text));
}
