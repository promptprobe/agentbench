import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
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

    const invalidCommand = cli(["does-not-exist"]);
    expect(invalidCommand.status).toBe(1);
    expect(invalidCommand.stderr).toMatch(/unknown command/u);
    expect(invalidCommand.stderr).not.toMatch(/at .*\.ts:/u);

    const missing = cli(["validate", "does-not-exist.prompt"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/not found/u);
    expect(missing.stderr).not.toMatch(/at .*\.ts:/u);
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
