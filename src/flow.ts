import { FlowModule, RawScript } from "windmill-client";

interface InlineScript {
  path: string;
  content: string;
}

interface State {
  counter: number;
  seen_names: Set<string>;
}
function assignPath(
  summary: string | undefined,
  language: RawScript["language"] | "bunnative",
  state: State,
  defaultTs: "bun" | "deno"
): string {
  let name;
  if (summary && summary != "" && !state.seen_names.has(summary)) {
    name = summary.toLowerCase().replace(/[^a-z0-9]/g, "_");
    state.seen_names.add(name);
  } else {
    name = `inline_script_${state.counter}`;
    while (state.seen_names.has(name)) {
      state.counter++;
      name = `inline_script_${state.counter}`;
    }
    state.seen_names.add(name);
  }
  let ext;
  if (language == "python3") ext = "py";
  else if (language == defaultTs || language == "bunnative") ext = "ts";
  else if (language == "deno") ext = "deno.ts";
  else if (language == "bun") ext = "bun.ts";
  else if (language == "go") ext = "go";
  else if (language == "bash") ext = "sh";
  else if (language == "powershell") ext = "ps1";
  else if (language == "postgresql") ext = "pg.sql";
  else if (language == "mysql") ext = "my.sql";
  else if (language == "bigquery") ext = "bq.sql";
  else if (language == "snowflake") ext = "sf.sql";
  else if (language == "graphql") ext = "gql";
  else if (language == "nativets") ext = "native.ts";
  else if (language == "php") ext = "php";

  return `${name}.inline_script.${ext}`;
}

export function extractInlineScripts(
  modules: FlowModule[],
  defaultTs?: "bun" | "deno",
  state?: State,
  mapping: Record<string, string> = {}
): InlineScript[] {
  if (!state) {
    state = {
      counter: 0,
      seen_names: new Set(),
    };
    Object.values(mapping).forEach((v) =>
      state!.seen_names.add(v.split(".")[0])
    );
  }

  return modules.flatMap((m) => {
    if (m.value.type == "rawscript") {
      const path =
        mapping[m.id] ??
        assignPath(m.summary, m.value.language, state!, defaultTs ?? "bun");
      const content = m.value.content;
      m.value.content = "!inline " + path;
      let lockPath = undefined;
      if (
        ![
          "mssql",
          "mysql",
          "postgresql",
          "bigquery",
          "snowflake",
          "postgresql",
          "bash",
          "oracledb",
        ].includes(m.value.language)
      ) {
        lockPath = path.split(".")[0] + ".inline_script.lock";
        m.value.lock = "!inline " + lockPath;
      }
      const r = [{ path: path, content: content }];
      if (lockPath) {
        r.push({ path: lockPath, content: "" });
      }
      return r;
    } else if (
      m.value.type == "forloopflow" ||
      m.value.type == "whileloopflow"
    ) {
      return extractInlineScripts(m.value.modules, defaultTs, state, mapping);
    } else if (m.value.type == "branchall") {
      return m.value.branches.flatMap((b) =>
        extractInlineScripts(b.modules, defaultTs, state, mapping)
      );
    } else if (m.value.type == "branchone") {
      return [
        ...m.value.branches.flatMap((b) =>
          extractInlineScripts(b.modules, defaultTs, state, mapping)
        ),
        ...extractInlineScripts(m.value.default, defaultTs, state, mapping),
      ];
    } else {
      return [];
    }
  });
}

export function extraCurrentMapping(
  modules: FlowModule[] | undefined,
  mapping: Record<string, string>
) {
  if (!modules || !Array.isArray(modules)) {
    return;
  }
  modules.forEach((m) => {
    if (!m?.value?.type) {
      return;
    }
    if (m.value.type == "rawscript") {
      if (m.value.content.startsWith("!inline ")) {
        mapping[m.id] = m.value.content.trim().split(" ")[1];
      }
    } else if (
      m.value.type == "forloopflow" ||
      m.value.type == "whileloopflow"
    ) {
      extraCurrentMapping(m.value.modules, mapping);
    } else if (m.value.type == "branchall") {
      m.value.branches.forEach((b) => extraCurrentMapping(b.modules, mapping));
    } else if (m.value.type == "branchone") {
      m.value.branches.forEach((b) => extraCurrentMapping(b.modules, mapping));
      extraCurrentMapping(m.value.default, mapping);
    }
  });
  return mapping;
}
