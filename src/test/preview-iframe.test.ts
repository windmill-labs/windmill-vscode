import { previewIframeAllow, renderPreviewIframe } from "../webview/preview-iframe";

describe("preview iframe clipboard policy", () => {
  it("grants clipboard access on the nested Windmill /dev frame", () => {
    expect(previewIframeAllow).toBe("clipboard-read; clipboard-write");
  });

  it("embeds the remote /dev page with clipboard allow and token query", () => {
    const html = renderPreviewIframe({
      remoteUrl: "https://app.windmill.dev/",
      token: "tok",
      workspace: "demo",
      themeKind: 2,
    });
    expect(html).toContain('allow="clipboard-read; clipboard-write"');
    expect(html).toContain(
      'src="https://app.windmill.dev/dev?wm_token=tok&workspace=demo&activeColorTheme=2"'
    );
  });
});
