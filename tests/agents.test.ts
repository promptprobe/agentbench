import { mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgent } from "../src/agents/load-agent.js";

async function temporaryFile(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "agentbench-agent-"));
  const path = resolve(directory, name);
  await writeFile(path, contents, "utf8");
  return path;
}

describe("agent ingestion", () => {
  it("normalizes a plain prompt and records its digest", async () => {
    const path = await temporaryFile("reviewer.prompt", "Review supplied evidence only.\n");
    const agent = await loadAgent(path);
    expect(agent.id).toBe("reviewer");
    expect(agent.source.type).toBe("system-prompt");
    expect(agent.source.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(agent.instructions).toBe("Review supplied evidence only.");
  });

  it("normalizes the generic JSON format", async () => {
    const path = await temporaryFile("agent.json", JSON.stringify({
      schema_version: "1",
      id: "bounded-reviewer",
      instructions: "Review only.",
      scope: { allowed_actions: ["review"], prohibited_actions: ["publish"] },
    }));
    const agent = await loadAgent(path);
    expect(agent.source.type).toBe("generic-json");
    expect(agent.metadata?.scope).toEqual({ allowed_actions: ["review"], prohibited_actions: ["publish"] });
  });

  it("parses only memory-free Buzz Snapshot v1 JSON as stopped data", async () => {
    const snapshot = {
      format: "buzz-agent-snapshot",
      version: 1,
      definition: { name: "reviewer", systemPrompt: "Review only.", runtime: "codex", model: "example" },
      profile: { displayName: "Reviewer" },
      memory: { level: "none" },
    };
    const path = await temporaryFile("reviewer.agent.json", JSON.stringify(snapshot));
    const agent = await loadAgent(path);
    expect(agent.source.type).toBe("buzz-agent-snapshot");
    expect(agent.instructions).toBe("Review only.");
    expect(agent.warnings.join(" ")).toContain("stopped data");
    expect(agent.warnings.join(" ")).toContain("runtime");
  });

  it("rejects Buzz snapshots with memory or unknown capability fields", async () => {
    const withMemory = await temporaryFile("memory.agent.json", JSON.stringify({
      format: "buzz-agent-snapshot",
      version: 1,
      definition: { name: "reviewer", systemPrompt: "Review only." },
      profile: { displayName: "Reviewer" },
      memory: { level: "core", entries: [{ slug: "core", body: "private" }] },
    }));
    await expect(loadAgent(withMemory)).rejects.toThrow(/invalid/u);

    const withCapability = await temporaryFile("capability.agent.json", JSON.stringify({
      format: "buzz-agent-snapshot",
      version: 1,
      definition: { name: "reviewer", systemPrompt: "Review only.", command: "sh" },
      profile: { displayName: "Reviewer" },
      memory: { level: "none" },
    }));
    await expect(loadAgent(withCapability)).rejects.toThrow(/invalid/u);
  });

  it("rejects empty, whitespace-only, oversized, and invalid UTF-8 prompts", async () => {
    const empty = await temporaryFile("empty.prompt", "");
    await expect(loadAgent(empty)).rejects.toThrow(/empty/u);
    const whitespace = await temporaryFile("space.md", " \n\t ");
    await expect(loadAgent(whitespace)).rejects.toThrow(/empty/u);
    const huge = await temporaryFile("huge.txt", "x".repeat(262_145));
    await expect(loadAgent(huge)).rejects.toThrow(/262144-byte/u);

    const directory = await mkdtemp(resolve(tmpdir(), "agentbench-agent-utf8-"));
    const invalid = resolve(directory, "invalid.prompt");
    await writeFile(invalid, Buffer.from([0xc3, 0x28]));
    await expect(loadAgent(invalid)).rejects.toThrow(/valid UTF-8/u);
  });

  it("rejects malformed and ambiguous JSON while allowing only declared generic fields", async () => {
    await expect(loadAgent(await temporaryFile("malformed.json", "{not-json"))).rejects.toThrow(/strict JSON/u);
    await expect(loadAgent(await temporaryFile("duplicate.json", '{"schema_version":"1","id":"a","instructions":"one","instructions":"two"}'))).rejects.toThrow(/duplicate object keys/u);
    await expect(loadAgent(await temporaryFile("unknown.json", JSON.stringify({
      schema_version: "1", id: "a", instructions: "Review.", capabilities: ["shell"],
    })))).rejects.toThrow(/invalid/u);
    await expect(loadAgent(await temporaryFile("nested.json", JSON.stringify({
      schema_version: "1", id: "a", instructions: { text: "Review." },
    })))).rejects.toThrow(/invalid/u);
  });

  it("resolves agent symlinks and hashes exact source bytes separately from normalized instructions", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "agentbench-agent-link-"));
    const target = resolve(directory, "target.prompt");
    const link = resolve(directory, "linked.prompt");
    await writeFile(target, "  Review only.\r\n", "utf8");
    await symlink(target, link);
    const agent = await loadAgent(link);
    expect(agent.source.path).toBe(await realpath(target));
    expect(agent.instructions).toBe("Review only.");
    expect(agent.source.sha256).not.toBe(agent.source.normalizedInstructionsSha256);
  });

  it("rejects unsupported, locked, memory-bearing, and capability-bearing Buzz variants", async () => {
    const base = {
      format: "buzz-agent-snapshot",
      version: 1,
      definition: { name: "reviewer", systemPrompt: "Review only." },
      profile: { displayName: "Reviewer" },
      memory: { level: "none" },
    };
    await expect(loadAgent(await temporaryFile("v2.agent.json", JSON.stringify({ ...base, version: 2 })))).rejects.toThrow(/invalid/u);
    await expect(loadAgent(await temporaryFile("locked.agent.json", JSON.stringify({ format: "buzz-agent-snapshot-encrypted", payload: "ciphertext" })))).rejects.toThrow(/unsupported agent artifact format/iu);
    await expect(loadAgent(await temporaryFile("tools.agent.json", JSON.stringify({
      ...base, definition: { ...base.definition, tools: ["shell"] },
    })))).rejects.toThrow(/invalid/u);

    const metadata = await loadAgent(await temporaryFile("metadata.agent.json", JSON.stringify({
      ...base,
      definition: { ...base.definition, runtime: "codex", provider: "example", model: "model", respondToAllowlist: ["user"] },
    })));
    for (const ignored of ["runtime", "provider", "model", "respondToAllowlist"]) {
      expect(metadata.warnings.join(" ")).toContain(ignored);
    }
    expect(metadata.metadata).not.toHaveProperty("runtime");
  });
});
