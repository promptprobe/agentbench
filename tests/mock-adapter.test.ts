import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MockAdapter } from "../src/adapters/mock.js";
import { loadAgent } from "../src/agents/load-agent.js";
import { PACKAGE_ROOT } from "../src/paths.js";
import { loadSuite } from "../src/suites/load-suite.js";

async function fixture(contents: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "agentbench-mock-"));
  const path = resolve(directory, "fixture.yaml");
  await writeFile(path, contents, "utf8");
  return path;
}

async function executionInput(repetition = 1) {
  const [agent, suite] = await Promise.all([
    loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
    loadSuite("authority"),
  ]);
  const loaded = suite.cases.find((entry) => entry.definition.id === "authority-no-publish");
  if (loaded === undefined) throw new Error("Missing built-in case.");
  return { agent, test: loaded.definition, repetition, signal: new AbortController().signal };
}

describe("mock adapter selection", () => {
  it("uses exact test ID before the first literal input match and fallback", async () => {
    const adapter = await MockAdapter.fromFile(await fixture(`
schema_version: "1"
id: precedence
responses:
  authority-no-publish: {content: exact}
input_patterns:
  - contains: Publish this draft
    response: {content: first-pattern}
  - contains: Publish
    response: {content: second-pattern}
fallback: {content: fallback}
`));
    await expect(adapter.execute(await executionInput())).resolves.toEqual({ rawText: "exact" });
    expect(adapter.describe().parameters.responseSelection).toBe("test-id, then literal input substring, then fallback");
  });

  it("uses first matching pattern and deterministic repetition sequence saturation", async () => {
    const patternAdapter = await MockAdapter.fromFile(await fixture(`
schema_version: "1"
id: patterns
responses: {}
input_patterns:
  - contains: Publish this draft
    response: {content: first}
  - contains: Publish
    response: {content: second}
`));
    await expect(patternAdapter.execute(await executionInput())).resolves.toEqual({ rawText: "first" });

    const sequenceAdapter = await MockAdapter.fromFile(await fixture(`
schema_version: "1"
id: sequence
responses:
  authority-no-publish:
    sequence:
      - {content: one}
      - {content: two}
input_patterns: []
`));
    await expect(sequenceAdapter.execute(await executionInput(1))).resolves.toEqual({ rawText: "one" });
    await expect(sequenceAdapter.execute(await executionInput(2))).resolves.toEqual({ rawText: "two" });
    await expect(sequenceAdapter.execute(await executionInput(3))).resolves.toEqual({ rawText: "two" });
  });

  it("surfaces missing responses and rejects duplicate or malformed fixture rules", async () => {
    const missing = await MockAdapter.fromFile(await fixture(`
schema_version: "1"
id: missing
responses: {}
input_patterns: []
`));
    await expect(missing.execute(await executionInput())).rejects.toThrow(/no response/u);

    await expect(MockAdapter.fromFile(await fixture(`
schema_version: "1"
id: duplicate
responses:
  authority-no-publish: {content: one}
  authority-no-publish: {content: two}
input_patterns: []
`))).rejects.toThrow(/map keys must be unique|invalid YAML/u);

    await expect(MockAdapter.fromFile(await fixture(`
schema_version: "1"
id: malformed
responses:
  authority-no-publish: {}
input_patterns: []
`))).rejects.toThrow(/invalid/u);

    await expect(MockAdapter.fromFile(await fixture(`
schema_version: "1"
id: duplicate-pattern
responses: {}
input_patterns:
  - contains: Publish
    response: {content: one}
  - contains: publish
    response: {content: two}
`))).rejects.toThrow(/invalid/iu);
  });
});
