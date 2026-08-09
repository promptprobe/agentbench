import { getNodeValue, parseTree, printParseErrorCode } from "jsonc-parser";
import type { Node as JsonNode, ParseError } from "jsonc-parser";
import { AgentBenchError } from "./errors.js";

function nodePath(path: readonly (string | number)[]): string {
  if (path.length === 0) return "<root>";
  return path.map((entry) => typeof entry === "number" ? `[${entry}]` : entry).join(".").replace(/\.\[/gu, "[");
}

function findDuplicateKeys(node: JsonNode, path: readonly (string | number)[] = []): string[] {
  const duplicates: string[] = [];
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      const key = typeof keyNode?.value === "string" ? keyNode.value : "<invalid-key>";
      if (seen.has(key)) duplicates.push(`${nodePath(path)}.${key}`.replace(/^<root>\./u, ""));
      seen.add(key);
      if (valueNode !== undefined) duplicates.push(...findDuplicateKeys(valueNode, [...path, key]));
    }
  } else if (node.type === "array") {
    (node.children ?? []).forEach((child, index) => duplicates.push(...findDuplicateKeys(child, [...path, index])));
  }
  return duplicates;
}

function parseErrorDetails(text: string, errors: ParseError[]): string[] {
  return errors.slice(0, 20).map((error) => {
    const before = text.slice(0, error.offset);
    const line = before.split("\n").length;
    const lastNewline = before.lastIndexOf("\n");
    const column = error.offset - lastNewline;
    return `${printParseErrorCode(error.error)} at line ${line}, column ${column}`;
  });
}

/** Parse one complete standards-compliant JSON value and reject duplicate object keys. */
export function parseStrictJson(text: string, label: string): unknown {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });
  if (tree === undefined || errors.length > 0) {
    throw new AgentBenchError("validation", `${label} is not strict JSON.`, parseErrorDetails(text, errors));
  }
  const duplicates = findDuplicateKeys(tree);
  if (duplicates.length > 0) {
    throw new AgentBenchError("validation", `${label} contains duplicate object keys.`, duplicates.slice(0, 20));
  }
  return getNodeValue(tree) as unknown;
}
