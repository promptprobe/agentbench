import { resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { AgentBenchError } from "../errors.js";
import { MockFixtureSchema } from "../schema.js";
import type { MockFixture, MockResponse } from "../schema.js";
import { assertJsonComplexity, decodeUtf8, FILE_LIMITS, readBoundedFile, sha256 } from "../security.js";
import type { AdapterDescriptor, AdapterExecutionInput, ExecutionAdapter, ExecutionOutput } from "../core/types.js";
import { parseSchema } from "../validation.js";
import { parseYaml } from "../yaml.js";

export class AdapterExecutionError extends Error {
  readonly adapterKind: "transport" | "adapter";

  constructor(adapterKind: "transport" | "adapter", message: string) {
    super(message);
    this.name = "AdapterExecutionError";
    this.adapterKind = adapterKind;
  }
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds === 0) return;
  await new Promise<void>((accept, reject) => {
    const finish = (): void => {
      signal.removeEventListener("abort", onAbort);
      accept();
    };
    const timer = setTimeout(finish, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new AdapterExecutionError("adapter", "Mock execution was aborted."));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function renderedInput(input: AdapterExecutionInput): string {
  const messages = input.test.input.messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  const artifacts = input.test.input.context?.artifacts.map((artifact) => artifact.content).join("\n") ?? "";
  return `${messages}\n${artifacts}`;
}

function selectResponse(fixture: MockFixture, input: AdapterExecutionInput): MockResponse | undefined {
  const exact = fixture.responses[input.test.id];
  if (exact !== undefined) return exact;
  const haystack = renderedInput(input);
  for (const pattern of fixture.input_patterns) {
    const comparableHaystack = pattern.case_sensitive ? haystack : haystack.toLocaleLowerCase("en-US");
    const needle = pattern.case_sensitive ? pattern.contains : pattern.contains.toLocaleLowerCase("en-US");
    if (comparableHaystack.includes(needle)) return pattern.response;
  }
  return fixture.fallback;
}

function outputForRepetition(response: MockResponse, repetition: number): ExecutionOutput {
  const selected = response.sequence?.[Math.min(repetition - 1, response.sequence.length - 1)];
  const rawText = selected?.content ?? response.content;
  const structured = selected?.structured ?? response.structured;
  return {
    ...(rawText === undefined ? {} : { rawText }),
    ...(structured === undefined ? {} : { structured }),
  };
}

export class MockAdapter implements ExecutionAdapter {
  readonly id = "mock";
  readonly #fixture: MockFixture;
  readonly #fixturePath: string;
  readonly #fixtureSha256: string;

  private constructor(fixture: MockFixture, fixturePath: string, fixtureSha256: string) {
    this.#fixture = fixture;
    this.#fixturePath = fixturePath;
    this.#fixtureSha256 = fixtureSha256;
  }

  static async fromFile(inputPath: string): Promise<MockAdapter> {
    const requestedPath = resolve(inputPath);
    const fixturePath = await realpath(requestedPath).catch(() => requestedPath);
    const bytes = await readBoundedFile(fixturePath, FILE_LIMITS.mockFixture, "Mock response fixture");
    const raw = parseYaml(decodeUtf8(bytes, `Mock response fixture ${fixturePath}`), `Mock response fixture ${fixturePath}`);
    assertJsonComplexity(raw, "Mock response fixture", 20, 50_000);
    const fixture = parseSchema(MockFixtureSchema, raw, "Mock response fixture");
    return new MockAdapter(fixture, fixturePath, sha256(bytes));
  }

  describe(): AdapterDescriptor {
    return {
      id: this.id,
      version: "1",
      runtime: "deterministic-local-fixture",
      model: "none",
      parameters: {
        fixtureId: this.#fixture.id,
        fixturePath: this.#fixturePath,
        fixtureSha256: this.#fixtureSha256,
        responseSelection: "test-id, then literal input substring, then fallback",
      },
      warnings: ["Mock outputs are fixtures; they do not demonstrate model capability or safety."],
    };
  }

  async execute(input: AdapterExecutionInput): Promise<ExecutionOutput> {
    const response = selectResponse(this.#fixture, input);
    if (response === undefined) {
      throw new AdapterExecutionError("adapter", `Mock fixture '${this.#fixture.id}' has no response for test '${input.test.id}'.`);
    }
    await abortableDelay(response.delay_ms, input.signal);
    if (input.signal.aborted) throw new AdapterExecutionError("adapter", "Mock execution was aborted.");
    if (response.error !== undefined) {
      throw new AdapterExecutionError(response.error.kind === "transport" ? "transport" : "adapter", response.error.message);
    }
    const output = outputForRepetition(response, input.repetition);
    if (output.rawText === undefined && output.structured === undefined) {
      throw new AgentBenchError("execution", `Mock fixture response for '${input.test.id}' produced no output.`);
    }
    return output;
  }
}
