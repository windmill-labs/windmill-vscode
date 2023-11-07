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
  language: RawScript.language,
  state: State
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
  else if (language == "deno") ext = "ts";
  else if (language == "go") ext = "go";
  else if (language == "bash") ext = "sh";
  else if (language == "powershell") ext = "ps1";
  else if (language == "postgresql") ext = "pg.sql";
  else if (language == "mysql") ext = "my.sql";
  else if (language == "bigquery") ext = "bq.sql";
  else if (language == "snowflake") ext = "sf.sql";
  else if (language == "graphql") ext = "gql";
  else if (language == "bun") ext = "bun.ts";
  else if (language == "nativets") ext = "native.ts";

  return `${name}.inline_script.${ext}`;
}

export function extractInlineScripts(
  modules: FlowModule[],
  state?: State
): InlineScript[] {
  if (!state) {
    state = {
      counter: 0,
      seen_names: new Set(),
    };
  }

  return modules.flatMap((m) => {
    if (m.value.type == "rawscript") {
      const path = assignPath(m.summary, m.value.language, state!);
      const content = m.value.content;
      m.value.content = "!inline " + path;
      return [{ path: path, content: content }];
    } else if (m.value.type == "forloopflow") {
      return extractInlineScripts(m.value.modules, state);
    } else if (m.value.type == "branchall") {
      return m.value.branches.flatMap((b) =>
        extractInlineScripts(b.modules, state)
      );
    } else if (m.value.type == "branchone") {
      return [
        ...m.value.branches.flatMap((b) =>
          extractInlineScripts(b.modules, state)
        ),
        ...extractInlineScripts(m.value.default, state),
      ];
    } else {
      return [];
    }
  });
}
