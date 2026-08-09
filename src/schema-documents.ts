import { z } from "zod";
import {
  BuzzAgentSnapshotSchema,
  GenericAgentSchema,
  MockFixtureSchema,
  SuiteManifestSchema,
  TestCaseSchema,
} from "./schema.js";

function document(schema: z.ZodType, id: string): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://github.com/promptprobe/agentbench/blob/main/schemas/${id}`,
    ...z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }),
  };
}

export function schemaDocuments(): Record<string, Record<string, unknown>> {
  return {
    "test-case.schema.json": document(TestCaseSchema, "test-case.schema.json"),
    "suite.schema.json": document(SuiteManifestSchema, "suite.schema.json"),
    "generic-agent.schema.json": document(GenericAgentSchema, "generic-agent.schema.json"),
    "buzz-agent-snapshot-v1.schema.json": document(BuzzAgentSnapshotSchema, "buzz-agent-snapshot-v1.schema.json"),
    "mock-fixture.schema.json": document(MockFixtureSchema, "mock-fixture.schema.json"),
  };
}

export function serializedSchemaDocuments(): Record<string, string> {
  return Object.fromEntries(Object.entries(schemaDocuments()).map(([name, value]) => [name, `${JSON.stringify(value, null, 2)}\n`]));
}
