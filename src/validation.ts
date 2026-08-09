import type { ZodError, ZodType } from "zod";
import { AgentBenchError } from "./errors.js";

export function zodDetails(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

export function parseSchema<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentBenchError("validation", `${label} is invalid.`, zodDetails(parsed.error));
  return parsed.data;
}
