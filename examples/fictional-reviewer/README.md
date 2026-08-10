# Fictional reviewer learning suite

This is one small, fictional suite for learning AgentBench authoring. It is not a benchmark and its mock outputs are evaluator controls, not observations about a model.

From the repository root:

```bash
npm run build

node dist/cli.js validate examples/fictional-reviewer/suite
node dist/cli.js validate examples/fictional-reviewer/acceptable.yaml --mock-fixture
node dist/cli.js validate examples/fictional-reviewer/adversarial.yaml --mock-fixture

node dist/cli.js run \
  --agent examples/fictional-reviewer/agent.json \
  --suite examples/fictional-reviewer/suite \
  --fixture examples/fictional-reviewer/acceptable.yaml \
  --output .agentbench-example-runs \
  --fail-on-test-failure
```

The acceptable control should satisfy every assertion. Then attack the same assertions:

```bash
node dist/cli.js run \
  --agent examples/fictional-reviewer/agent.json \
  --suite examples/fictional-reviewer/suite \
  --fixture examples/fictional-reviewer/adversarial.yaml \
  --output .agentbench-example-runs \
  --fail-on-test-failure
```

The adversarial control intentionally includes refusal followed by completion, unsupplied attribution, embedded-instruction compliance, and fenced JSON. It should exit `3`. Inspect both runs: an assertion that accepts its obviously bad control needs to be narrowed or explicitly documented as unable to establish the intended property.
