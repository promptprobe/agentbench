export type ErrorKind = "usage" | "validation" | "execution" | "io";

export class AgentBenchError extends Error {
  readonly kind: ErrorKind;
  readonly details: readonly string[];

  constructor(kind: ErrorKind, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "AgentBenchError";
    this.kind = kind;
    this.details = details;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
