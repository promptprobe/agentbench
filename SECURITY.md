# Security policy

## Reporting a vulnerability

Please use the repository's private GitHub Security Advisory flow. Do not open a public issue containing credentials, private prompts, agent memory, exploitable payloads, or sensitive run output.

Include the affected version or commit, the smallest safe reproduction, the expected boundary, and the observed behavior. Redact all live secrets and personal data.

## Trust model

Agent definitions, suites, YAML, contextual artifacts, mock fixtures, adapter output, run JSON, and report content are untrusted data. AgentBench applies byte, depth, item, path, regex, and output limits; strict schemas; YAML alias rejection; contained suite paths; local-only JSON Schema references; terminal-control stripping; and safe Markdown fences.

The MVP does not execute scripts, shell commands, tools, capabilities, JavaScript evaluators, dynamic imports, downloaded plugins, or adapters declared by an artifact or suite. Its only child process is a fixed no-shell `git rev-parse HEAD` call for local source metadata; untrusted data is never used as its executable or arguments.

Buzz snapshots are parsed as stopped data. AgentBench never imports identity or memory, activates an agent, launches Buzz/ACP, follows a remote avatar, or executes source runtime configuration.

## Enforced bounds

AgentBench rejects invalid UTF-8 and duplicate JSON/YAML object keys. Agent and fixture inputs are limited to 5 MiB, suite manifests to 256 KiB, cases to 512 KiB, normalized instructions/messages/artifacts to 262,144 UTF-8 bytes, composite assertions to four nested levels and 20 children, regular expressions to 500 characters, suites to 500 cases, repetitions to 100, and runs to 10,000 executions. Adapter output is limited to 2 MiB per execution and 64 MiB per run; generated `results.json` is limited to 256 MiB. JSON values and schemas have depth/node bounds. These limits are resource controls, not evidence that every accepted input is inexpensive.

Run directories are created exclusively. Generated files use owner-only atomic replacement where supported, so report regeneration replaces a report symlink rather than writing through it. Suite case paths are checked lexically and after `realpath`; case symlinks may not escape the selected suite root. Agent and fixture paths explicitly selected by the caller are resolved to their real target and recorded that way.

## Residual risks

- Large but in-limit inputs and complex JSON Schemas can still consume CPU or memory.
- Deterministic regex screening reduces but cannot mathematically eliminate every pathological engine case.
- Keyword, negative-keyword, and refusal-signal checks can produce semantic false positives and false negatives even when implemented correctly.
- SHA-256 values are integrity comparison data, not signatures or proof of who produced a run.
- Reports intentionally preserve raw output as evidence; that output may contain secrets supplied by a user or returned by a runtime.
- Local filesystem permissions and backups are outside AgentBench's control.
- A host application can construct a custom adapter with broader capabilities through the library API.
- Future external adapters would transmit evaluation content to their provider.

Use a dedicated output directory, review artifacts before sharing, and never put live credentials in agents, suites, fixtures, or test context.
