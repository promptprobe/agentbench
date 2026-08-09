import { basename, extname, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { AgentBenchError } from "../errors.js";
import { parseStrictJson } from "../json.js";
import { BuzzAgentSnapshotSchema, GenericAgentSchema } from "../schema.js";
import { assertJsonComplexity, decodeUtf8, FILE_LIMITS, readBoundedFile, sha256 } from "../security.js";
import type { NormalizedAgent } from "../core/types.js";
import { parseSchema } from "../validation.js";

function identifierFromPath(path: string): string {
  const raw = basename(path, extname(path)).toLowerCase();
  return raw.replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 128) || "system-prompt";
}

function parseJson(bytes: Buffer, path: string): unknown {
  try {
    const value = parseStrictJson(decodeUtf8(bytes, `Agent definition ${path}`), `Agent JSON ${path}`);
    assertJsonComplexity(value, "Agent definition");
    return value;
  } catch (error) {
    if (error instanceof AgentBenchError) throw error;
    throw new AgentBenchError("validation", `Agent JSON is invalid: ${path}`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

export async function loadAgent(inputPath: string): Promise<NormalizedAgent> {
  const requestedPath = resolve(inputPath);
  const path = await realpath(requestedPath).catch(() => requestedPath);
  const bytes = await readBoundedFile(path, FILE_LIMITS.agent, "Agent definition");
  const digest = sha256(bytes);
  const extension = extname(path).toLowerCase();

  if ([".txt", ".md", ".prompt"].includes(extension)) {
    const instructions = decodeUtf8(bytes, `System prompt ${path}`).trim();
    if (!instructions) throw new AgentBenchError("validation", `System prompt is empty: ${path}`);
    if (Buffer.byteLength(instructions) > 262_144) {
      throw new AgentBenchError("validation", "System prompt exceeds the 262144-byte normalized instruction limit.");
    }
    return {
      id: identifierFromPath(path),
      instructions,
      source: { type: "system-prompt", path, sha256: digest, normalizedInstructionsSha256: sha256(instructions), sizeBytes: bytes.length },
      warnings: [],
    };
  }

  if (extension !== ".json") {
    throw new AgentBenchError(
      "validation",
      `Unsupported agent format: ${extension || "no extension"}. Use .txt, .md, .prompt, or .json.`,
    );
  }

  const value = parseJson(bytes, path);
  const discriminator = value !== null && typeof value === "object" ? (value as Record<string, unknown>).format : undefined;

  if (discriminator === "buzz-agent-snapshot") {
    const snapshot = parseSchema(BuzzAgentSnapshotSchema, value, "Buzz Agent Snapshot");
    if (Buffer.byteLength(snapshot.definition.systemPrompt, "utf8") > 262_144) {
      throw new AgentBenchError("validation", "Buzz systemPrompt exceeds the 262144-byte normalized instruction limit.");
    }
    const ignoredFields = [
      snapshot.definition.runtime ? "runtime" : undefined,
      snapshot.definition.model ? "model" : undefined,
      snapshot.definition.provider ? "provider" : undefined,
      snapshot.definition.respondTo ? "respondTo" : undefined,
      snapshot.definition.respondToAllowlist?.length ? "respondToAllowlist" : undefined,
      snapshot.definition.namePool?.length ? "namePool" : undefined,
    ].filter((entry): entry is string => entry !== undefined);
    const warnings = [
      "Buzz Agent Snapshot was parsed as stopped data; AgentBench did not import identity, memory, tools, or capabilities.",
    ];
    if (ignoredFields.length > 0) warnings.push(`Buzz execution metadata was ignored: ${ignoredFields.join(", ")}.`);
    return {
      id: identifierFromPath(path),
      name: snapshot.profile.displayName,
      instructions: snapshot.definition.systemPrompt,
      source: { type: "buzz-agent-snapshot", path, sha256: digest, normalizedInstructionsSha256: sha256(snapshot.definition.systemPrompt), sizeBytes: bytes.length },
      metadata: {
        buzzSnapshotVersion: snapshot.version,
        sourceDefinitionName: snapshot.definition.name,
        sourceIsBuiltIn: snapshot.definition.sourceIsBuiltIn ?? false,
      },
      warnings,
    };
  }

  if (typeof discriminator === "string") {
    throw new AgentBenchError("validation", `Unsupported agent artifact format discriminator: ${discriminator}`);
  }

  const agent = parseSchema(GenericAgentSchema, value, "Generic agent definition");
  if (Buffer.byteLength(agent.instructions, "utf8") > 262_144) {
    throw new AgentBenchError("validation", "Generic agent instructions exceed the 262144-byte normalized instruction limit.");
  }
  return {
    id: agent.id,
    ...(agent.name === undefined ? {} : { name: agent.name }),
    instructions: agent.instructions,
    source: { type: "generic-json", path, sha256: digest, normalizedInstructionsSha256: sha256(agent.instructions), sizeBytes: bytes.length },
    ...((agent.scope !== undefined || agent.metadata !== undefined)
      ? { metadata: { ...(agent.metadata ?? {}), ...(agent.scope === undefined ? {} : { scope: agent.scope }) } }
      : {}),
    warnings: [],
  };
}
