import { FlowModule } from "windmill-client";

export function extractCurrentMapping(
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
      extractCurrentMapping(m.value.modules, mapping);
    } else if (m.value.type == "branchall") {
      m.value.branches.forEach((b) => extractCurrentMapping(b.modules, mapping));
    } else if (m.value.type == "branchone") {
      m.value.branches.forEach((b) => extractCurrentMapping(b.modules, mapping));
      extractCurrentMapping(m.value.default, mapping);
    }
  });
  return mapping;
}
