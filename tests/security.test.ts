import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SuiteManifestSchema } from "../src/schema.js";
import { fencedCode, inlineCode, markdownText, sanitizeTerminal } from "../src/security.js";
import { loadSuite } from "../src/suites/load-suite.js";
import { parseYaml } from "../src/yaml.js";

describe("untrusted input boundaries", () => {
  it("rejects suite path traversal", () => {
    const parsed = SuiteManifestSchema.safeParse({
      schema_version: "1",
      id: "escape",
      version: "1.0.0",
      title: "Escape",
      description: "Attempts to escape the suite root.",
      cases: ["../outside.yaml"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects YAML aliases", () => {
    expect(() => parseYaml("a: &value [1]\nb: *value\n", "alias fixture")).toThrow(/aliases|Excessive alias/u);
  });

  it("strips terminal controls and safely expands Markdown fences", () => {
    expect(markdownText("heading\n# forged")).toBe("heading \\# forged");
    const block = fencedCode("before\n```\nafter");
    expect(block.startsWith("````text")).toBe(true);
    expect(block.endsWith("````")).toBe(true);
    expect(inlineCode("model`name")).toBe("``model`name``");
    expect(sanitizeTerminal("safe\u001b[31mred\u001b[0m\u0007")).toBe("safered");
  });

  it("rejects absolute case paths and duplicate case paths", () => {
    expect(SuiteManifestSchema.safeParse({
      schema_version: "1", id: "escape", version: "1", title: "Escape", description: "absolute", cases: ["/tmp/case.yaml"],
    }).success).toBe(false);
    expect(SuiteManifestSchema.safeParse({
      schema_version: "1", id: "duplicate", version: "1", title: "Duplicate", description: "duplicate", cases: ["cases/a.yaml", "cases/a.yaml"],
    }).success).toBe(false);
  });

  it("rejects direct and nested suite-case symlink escapes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "agentbench-suite-link-"));
    const suite = resolve(root, "suite");
    const cases = resolve(suite, "cases");
    const outside = resolve(root, "outside.yaml");
    await mkdir(cases, { recursive: true });
    await writeFile(outside, "schema_version: '1'\n", "utf8");
    await writeFile(resolve(suite, "suite.yaml"), `
schema_version: "1"
id: linked
version: 1.0.0
title: Linked
description: Symlink escape fixture.
cases: [cases/escape.yaml]
`, "utf8");
    await symlink(outside, resolve(cases, "escape.yaml"));
    await expect(loadSuite(suite)).rejects.toThrow(/escapes its suite/u);

    const nestedSuite = resolve(root, "nested-suite");
    await mkdir(nestedSuite, { recursive: true });
    await writeFile(resolve(nestedSuite, "suite.yaml"), `
schema_version: "1"
id: nested-linked
version: 1.0.0
title: Nested linked
description: Nested symlink escape fixture.
cases: [linked/case.yaml]
`, "utf8");
    await symlink(resolve(root, "outside-directory"), resolve(nestedSuite, "linked"));
    await mkdir(resolve(root, "outside-directory"));
    await writeFile(resolve(root, "outside-directory", "case.yaml"), "schema_version: '1'\n", "utf8");
    await expect(loadSuite(nestedSuite)).rejects.toThrow(/escapes its suite/u);
  });
});
