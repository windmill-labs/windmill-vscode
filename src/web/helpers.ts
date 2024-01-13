/*
    This function takes in the path of a runnable and parses out the root path of the windmill project
    Also accounts for multiple instances of "/u*" or "/f*" in the path

    Examples:
    "/windmill/under/windmill-src/f/testing/bar.py" => "/windmill/under/windmill-src"
    "/windmill/free/windmill-src/u/ryan/bar.py" => "/windmill/free/windmill-src"
*/
export function getRootPathFromRunnablePath(fullPath: string): string | undefined {
    const dirs = ["/u/", "/f/"];

    for (const dir of dirs) {
        if (fullPath.includes(dir) || fullPath.endsWith(dir) ) {
            return fullPath.split(dir)[0];
        }
    }

    return;
}
