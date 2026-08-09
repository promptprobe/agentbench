import { parseDocument } from "yaml";
import { AgentBenchError } from "./errors.js";

export function parseYaml(text: string, label: string): unknown {
  try {
    const document = parseDocument(text, {
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      throw new AgentBenchError(
        "validation",
        `${label} contains invalid YAML.`,
        document.errors.map((error) => error.message),
      );
    }
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof AgentBenchError) throw error;
    throw new AgentBenchError("validation", `${label} uses unsupported YAML aliases or exceeds parser limits.`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}
