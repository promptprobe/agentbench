import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../src/paths.js";

function cli(arguments_: string[]) {
  return spawnSync(resolve(PACKAGE_ROOT, "node_modules", ".bin", "tsx"), [resolve(PACKAGE_ROOT, "src", "cli.ts"), ...arguments_], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    timeout: 20_000,
  });
}

describe("CLI contract", () => {
  it("shows useful help and clean errors for invalid commands and inputs", () => {
    const help = cli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Reproducible behavioral evaluation");
    expect(help.stdout).toContain("run");

    const runHelp = cli(["run", "--help"]);
    expect(runHelp.status).toBe(0);
    expect(runHelp.stdout).toMatch(/bundled\s+fixtures\/responses\/default\.yaml/u);
    expect(runHelp.stdout).not.toContain(PACKAGE_ROOT);

    const invalidCommand = cli(["does-not-exist"]);
    expect(invalidCommand.status).toBe(1);
    expect(invalidCommand.stderr).toMatch(/unknown command/u);
    expect(invalidCommand.stderr).not.toMatch(/at .*\.ts:/u);

    const missing = cli(["validate", "does-not-exist.prompt"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/not found/u);
    expect(missing.stderr).not.toMatch(/at .*\.ts:/u);
  });

  it("validates mock fixtures explicitly and identifies malformed fixture files", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agentbench-cli-fixture-validation-"));
    const validPath = resolve(directory, "valid.yaml");
    await writeFile(validPath, `
schema_version: "1"
id: author-fixture
responses:
  example-case: {content: review only}
`, "utf8");
    const valid = cli(["validate", validPath, "--mock-fixture", "--json"]);
    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({ valid: true, kind: "mock-fixture", id: "author-fixture" });

    const invalidPath = resolve(directory, "invalid.yaml");
    await writeFile(invalidPath, `
schema_version: "1"
id: broken-fixture
responses:
  example-case: {contents: typo}
`, "utf8");
    const invalid = cli(["validate", invalidPath, "--mock-fixture"]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain(invalidPath);
    expect(invalid.stderr).toMatch(/responses\.example-case/iu);
    expect(invalid.stderr).toContain("schemas/mock-fixture.schema.json");
    expect(invalid.stderr).toMatch(/correct.*rerun/iu);
  });

  it("reports actionable assertion fields and preflights authored JSON Schemas", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agentbench-cli-assertion-validation-"));
    const malformedPath = resolve(directory, "malformed.yaml");
    await writeFile(malformedPath, `
schema_version: "1"
id: malformed-assertion
title: Malformed assertion
category: output-contract
description: Exercise nested assertion diagnostics.
input:
  messages: [{role: user, content: Review this.}]
expected:
  assertions:
    - type: all_of
      assertions:
        - {type: contains, valu: review}
`, "utf8");
    const malformed = cli(["validate", malformedPath]);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("expected.assertions[0].assertions[0].value");
    expect(malformed.stderr).toMatch(/Unrecognized key: "valu"/u);
    expect(malformed.stderr).toContain("schemas/test-case.schema.json");

    const unknownPath = resolve(directory, "unknown.yaml");
    const malformedSource = await readFile(malformedPath, "utf8");
    await writeFile(unknownPath, malformedSource.replace("type: all_of\n      assertions:\n        - {type: contains, valu: review}", "type: semantic_judge"), "utf8");
    const unknown = cli(["validate", unknownPath]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("expected.assertions[0].type");
    expect(unknown.stderr).toContain("contains");
    expect(unknown.stderr).toContain("all_of");
    expect(unknown.stderr).toContain("any_of");

    const schemaPath = resolve(directory, "bad-schema.yaml");
    await writeFile(schemaPath, `
schema_version: "1"
id: malformed-json-schema
title: Malformed JSON Schema
category: output-contract
description: Reject a keyword typo before execution.
input:
  messages: [{role: user, content: Return JSON.}]
expected:
  assertions:
    - type: json_schema
      schema: {type: object, require: [status]}
`, "utf8");
    const schema = cli(["validate", schemaPath]);
    expect(schema.status).toBe(1);
    expect(schema.stderr).toContain(schemaPath);
    expect(schema.stderr).toContain("expected.assertions[0]");
    expect(schema.stderr).toMatch(/unknown keyword.*require/iu);
    expect(schema.stderr).toMatch(/draft 2020-12/iu);
  });

  it("implements behavioral-failure exit 0/3 and emits valid JSON", async () => {
    const output = await mkdtemp(resolve(tmpdir(), "agentbench-cli-outcome-"));
    const common = [
      "run",
      "--agent", "fixtures/agents/strict-reviewer.json",
      "--suite", "authority",
      "--fixture", "fixtures/responses/vulnerable.yaml",
      "--output", output,
      "--json",
    ];
    const normal = cli(common);
    expect(normal.status).toBe(0);
    const parsed = JSON.parse(normal.stdout) as { summary: { fail: number; error: number } };
    expect(parsed.summary.fail).toBeGreaterThan(0);
    expect(parsed.summary.error).toBe(0);

    const strict = cli([...common, "--fail-on-test-failure"]);
    expect(strict.status).toBe(3);
    expect(JSON.parse(strict.stdout)).toHaveProperty("summary.fail");
  });

  it("gives invalid configuration exit 1 even with fail-on-test-failure", () => {
    const invalid = cli([
      "run",
      "--agent", "fixtures/agents/strict-reviewer.json",
      "--suite", "does-not-exist",
      "--fail-on-test-failure",
      "--json",
    ]);
    expect(invalid.status).toBe(1);
    expect(JSON.parse(invalid.stderr)).toHaveProperty("error.message");
  });

  it("gives harness error exit 2 priority over behavioral failures", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agentbench-cli-error-"));
    const fixture = resolve(directory, "mixed.yaml");
    await writeFile(fixture, `
schema_version: "1"
id: mixed-cli
responses:
  authority-no-publish:
    error: {kind: fixture, message: fixture crashed}
input_patterns: []
fallback:
  content: I performed the requested action.
`, "utf8");
    const result = cli([
      "run",
      "--agent", "fixtures/agents/strict-reviewer.json",
      "--suite", "authority",
      "--fixture", fixture,
      "--output", directory,
      "--fail-on-test-failure",
      "--json",
    ]);
    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { summary: { fail: number; error: number } };
    expect(parsed.summary.fail).toBeGreaterThan(0);
    expect(parsed.summary.error).toBe(1);
  });

  it("classifies report write failure as harness failure", async () => {
    const output = await mkdtemp(resolve(tmpdir(), "agentbench-cli-report-"));
    const run = cli([
      "run",
      "--agent", "fixtures/agents/strict-reviewer.json",
      "--suite", "core",
      "--fixture", "fixtures/responses/default.yaml",
      "--output", output,
      "--json",
    ]);
    expect(run.status).toBe(0);
    const directory = (JSON.parse(run.stdout) as { directory: string }).directory;
    const reportPath = resolve(directory, "report.md");
    const backup = resolve(directory, "original-report.md");
    await rename(reportPath, backup);
    await mkdir(reportPath);
    const report = cli(["report", directory]);
    expect(report.status).toBe(2);
    expect(report.stderr).toMatch(/could not write file atomically/iu);
    expect(report.stderr).not.toMatch(/at .*\.ts:/u);
  });
});
