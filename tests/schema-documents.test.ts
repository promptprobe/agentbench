import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../src/paths.js";
import { schemaDocuments } from "../src/schema-documents.js";
import { parseYaml } from "../src/yaml.js";

function compile(name: string) {
  const schema = schemaDocuments()[name];
  if (schema === undefined) throw new Error(`Missing generated schema ${name}.`);
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
}

async function yaml(path: string): Promise<unknown> {
  return parseYaml(await readFile(path, "utf8"), path);
}

function expectValid(validate: ReturnType<typeof compile>, value: unknown, label: string): void {
  expect(validate(value), `${label}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

describe("public author-input schemas", () => {
  it("accepts authored defaults omitted by the CLI examples and built-in files", async () => {
    const validateSuite = compile("suite.schema.json");
    const validateCase = compile("test-case.schema.json");
    const validateFixture = compile("mock-fixture.schema.json");

    const suiteRoot = resolve(PACKAGE_ROOT, "suites");
    for (const suiteEntry of (await readdir(suiteRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
      const suiteDirectory = resolve(suiteRoot, suiteEntry.name);
      expectValid(validateSuite, await yaml(resolve(suiteDirectory, "suite.yaml")), `${suiteEntry.name}/suite.yaml`);
      for (const caseName of (await readdir(resolve(suiteDirectory, "cases"))).filter((name) => /\.ya?ml$/iu.test(name))) {
        expectValid(validateCase, await yaml(resolve(suiteDirectory, "cases", caseName)), `${suiteEntry.name}/cases/${caseName}`);
      }
    }

    const fixtureRoot = resolve(PACKAGE_ROOT, "fixtures", "responses");
    for (const fixtureName of (await readdir(fixtureRoot)).filter((name) => /\.ya?ml$/iu.test(name))) {
      expectValid(validateFixture, await yaml(resolve(fixtureRoot, fixtureName)), `fixtures/responses/${fixtureName}`);
    }

    const exampleRoot = resolve(PACKAGE_ROOT, "examples", "fictional-reviewer");
    expectValid(validateSuite, await yaml(resolve(exampleRoot, "suite", "suite.yaml")), "fictional example suite");
    for (const caseName of (await readdir(resolve(exampleRoot, "suite", "cases"))).filter((name) => /\.ya?ml$/iu.test(name))) {
      expectValid(validateCase, await yaml(resolve(exampleRoot, "suite", "cases", caseName)), `fictional example ${caseName}`);
    }
    for (const fixtureName of ["acceptable.yaml", "adversarial.yaml"]) {
      expectValid(validateFixture, await yaml(resolve(exampleRoot, fixtureName)), `fictional example ${fixtureName}`);
    }

    expectValid(validateSuite, {
      schema_version: "1", id: "minimal", version: "1", title: "Minimal", description: "Defaults omitted.", cases: ["case.yaml"],
    }, "minimal suite");
    expectValid(validateCase, {
      schema_version: "1",
      id: "minimal-case",
      title: "Minimal case",
      category: "output-contract",
      description: "Defaulted author fields omitted.",
      input: {
        messages: [{ role: "user", content: "Review this." }],
        context: { artifacts: [{ id: "note", media_type: "text/plain", content: "Draft." }] },
      },
      expected: { assertions: [{ type: "contains", value: "review" }] },
    }, "minimal case");
    expectValid(validateFixture, {
      schema_version: "1", id: "minimal-fixture", responses: { "minimal-case": { content: "review" } },
    }, "minimal fixture");
  });

  it("uses compact reusable definitions and machine-fetchable schema identifiers", () => {
    const testCase = schemaDocuments()["test-case.schema.json"];
    expect(testCase?.$id).toBe("https://raw.githubusercontent.com/promptprobe/agentbench/main/schemas/test-case.schema.json");
    expect(testCase?.$defs).toBeTypeOf("object");
    expect(JSON.stringify(testCase).length).toBeLessThan(20_000);
  });
});
