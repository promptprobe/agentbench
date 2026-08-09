import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PACKAGE_ROOT } from "../paths.js";
import { serializedSchemaDocuments } from "../schema-documents.js";

const output = resolve(PACKAGE_ROOT, "schemas");
await mkdir(output, { recursive: true });
await Promise.all(
  Object.entries(serializedSchemaDocuments()).map(async ([name, contents]) => writeFile(resolve(output, name), contents, "utf8")),
);
