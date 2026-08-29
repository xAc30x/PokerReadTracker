import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const productTitle = "TableRead Poker Tracker";
const productDescription = "Fast, durable player reads for live poker tables.";
const textExtensions = new Set([".html", ".js", ".json", ".mjs", ".txt"]);

async function readBuiltText(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await readBuiltText(entryPath));
      continue;
    }

    if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      chunks.push(await readFile(entryPath, "utf8"));
    }
  }

  return chunks.join("\n");
}

test("compiled app contains the TableRead product metadata", async () => {
  const builtText = await readBuiltText(distDir);

  assert.match(builtText, new RegExp(productTitle, "i"));
  assert.match(builtText, new RegExp(productDescription, "i"));
});
