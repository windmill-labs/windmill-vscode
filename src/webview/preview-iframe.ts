export const previewIframeAllow = "clipboard-read; clipboard-write";

export function renderPreviewIframe(opts: {
  remoteUrl: string;
  token: string;
  workspace: string;
  themeKind: number;
}): string {
  const src = `${opts.remoteUrl}dev?wm_token=${opts.token}&workspace=${opts.workspace}&activeColorTheme=${opts.themeKind}`;
  return `<iframe id="iframe" src="${src}" width="100%" allow="${previewIframeAllow}" style="border: none; height: 100vh;"></iframe>`;
}
