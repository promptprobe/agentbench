import { MockAdapter } from "../adapters/mock.js";
import { DEFAULT_MOCK_FIXTURE } from "../paths.js";
import { listBuiltinSuiteIds, loadSuite } from "../suites/load-suite.js";

const ids = await listBuiltinSuiteIds();
if (ids.length < 4) throw new Error(`Expected at least four built-in suites; found ${ids.length}.`);
for (const id of ids) {
  const suite = await loadSuite(id);
  if (suite.cases.length < 5) throw new Error(`Built-in suite '${id}' needs at least five cases.`);
}
await MockAdapter.fromFile(DEFAULT_MOCK_FIXTURE);
console.log(`Validated ${ids.length} suites: ${ids.join(", ")}.`);
