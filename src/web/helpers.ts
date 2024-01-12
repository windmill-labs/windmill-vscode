export function getRootPathFromRunnablePath(basePath: string) {
    if (basePath.includes("/u/")) {
        if (basePath.endsWith("/u")) {
            basePath = basePath.split("/u")[0];
        } else {
            basePath = basePath.split("/u/")[0];
        }
    } else if (basePath.includes("/f")) {
        if (basePath.endsWith("/f")) {
            basePath = basePath.split("/f")[0];
        } else {
            basePath = basePath.split("/f/")[0];
        }
    }

    return basePath;
}
