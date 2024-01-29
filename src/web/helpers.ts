/*
    This function takes in the path of a runnable and parses out the root path of the windmill project
    Also accounts for multiple instances of "/u*" or "/f*" in the path

    Examples:
    "/windmill/under/windmill-src/f/testing/bar.py" => "/windmill/under/windmill-src"
    "/windmill/free/windmill-src/u/ryan/bar.py" => "/windmill/free/windmill-src"
*/
export function getRootPathFromRunnablePath(
  fullPath: string
): string | undefined {
  const dirs = ["/u/", "/f/"];

  for (const dir of dirs) {
    if (fullPath.includes(dir) || fullPath.endsWith(dir)) {
      return fullPath.split(dir)[0];
    }
  }

  return;
}

export function determineLanguage(
  path: string,
  defaultTs: "bun" | "deno" | undefined
) {
  const splitPath = path.split(".");
  const len = splitPath.length;
  const ext = splitPath[len - 1];
  const penu = splitPath[len - 2];
  switch (ext) {
    case "py":
      return "python3";
    case "ts":
      return getTypescriptType(len, penu, defaultTs);
    case "go":
      return "go";
    case "sh":
      return "bash";
    case "gql":
      return "graphql";
    case "ps1":
      return "powershell";
    case "sql":
      return getSqlType(len, penu);
    case "yaml":
      return penu === "flow/flow" ? "flow" : undefined;
    default:
      return undefined;
  }
}

export function getTypescriptType(
  len: number,
  penu: string,
  defaultTs: "bun" | "deno" | undefined
) {
  if (len > 2) {
    if (penu === "fetch") {
      return "nativets";
    } else if (penu === "bun") {
      return "bun";
    } else if (penu === "deno") {
      return "deno";
    }
  }
  return defaultTs ?? "deno";
}

export function getSqlType(len: number, penu: string) {
  if (len > 2) {
    if (penu === "my") {
      return "mysql";
    }
    if (penu === "bq") {
      return "bigquery";
    }
    if (penu === "sf") {
      return "snowflake";
    }
  }
  return "postgresql";
}
