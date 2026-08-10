import type { ZodError, ZodType } from "zod";
import { AgentBenchError } from "./errors.js";

interface ValidationIssue {
  code: string;
  path: PropertyKey[];
  message: string;
  errors?: ValidationIssue[][];
  note?: string;
  options?: unknown[];
  values?: unknown[];
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "<root>";
  return path.map((part, index) => typeof part === "number" ? `[${part}]` : `${index === 0 ? "" : "."}${String(part)}`).join("");
}

function discriminatorOptions(errors: readonly ValidationIssue[][]): string[] | undefined {
  const options: string[] = [];
  const everyBranchIdentifiesType = errors.every((branch) => branch.some((issue) => {
    if (issue.path.length !== 1 || issue.path[0] !== "type") return false;
    if (issue.note === "No matching discriminator") {
      options.push(...(issue.options ?? []).map(String));
      return true;
    }
    if (issue.code === "invalid_value") {
      options.push(...(issue.values ?? []).map(String));
      return true;
    }
    return false;
  }));
  return everyBranchIdentifiesType ? [...new Set(options)] : undefined;
}

function issueScore(issue: ValidationIssue): number {
  if (issue.code === "invalid_union") {
    if (issue.errors === undefined || issue.errors.length === 0) return issue.note === "No matching discriminator" ? 100 : 10;
    return Math.min(...issue.errors.map((branch) => branch.reduce((sum, child) => sum + issueScore(child), 0)));
  }
  if (issue.path.at(-1) === "type" && issue.code === "invalid_value") return 50;
  return 1;
}

function flattenIssue(issue: ValidationIssue, prefix: readonly PropertyKey[] = []): Array<{ path: PropertyKey[]; message: string }> {
  const path = [...prefix, ...issue.path];
  if (issue.code !== "invalid_union" || issue.errors === undefined || issue.errors.length === 0) {
    return [{ path, message: issue.message }];
  }
  const expectedTypes = discriminatorOptions(issue.errors);
  if (expectedTypes !== undefined && expectedTypes.length > 0) {
    return [{ path: [...path, "type"], message: `Expected one of: ${expectedTypes.join(", ")}.` }];
  }
  const best = issue.errors.reduce((selected, branch) => {
    const selectedScore = selected.reduce((sum, child) => sum + issueScore(child), 0);
    const branchScore = branch.reduce((sum, child) => sum + issueScore(child), 0);
    return branchScore < selectedScore ? branch : selected;
  });
  return best.flatMap((child) => flattenIssue(child, path));
}

export function zodDetails(error: ZodError): string[] {
  return error.issues
    .flatMap((issue) => flattenIssue(issue as ValidationIssue))
    .map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
}

export function parseSchema<T>(schema: ZodType<T>, value: unknown, label: string, guidance: readonly string[] = []): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentBenchError("validation", `${label} is invalid.`, [...zodDetails(parsed.error), ...guidance]);
  return parsed.data;
}
