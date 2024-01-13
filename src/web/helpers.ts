/*
    This function takes in the path of a runnable and parses out the root path of the windmill project
    Also accounts for multiple instances of "/u*" or "/f*" in the path

    Examples:
    "/windmill/under/windmill-src/f/testing/bar.py" => "/windmill/under/windmill-src"
    "/windmill/free/windmill-src/u/ryan/bar.py" => "/windmill/free/windmill-src"
*/
export function getRootPathFromRunnablePath(basePath: string): string {
    const dirs = ["/u/", "/f/"];

    for (const dir of dirs) {
        if (basePath.includes(dir)) {
            basePath = basePath.endsWith(dir) ? basePath.split(dir)[0] : basePath.split(`${dir}`)[0];
            break;
        }
    }

    return basePath;
}
