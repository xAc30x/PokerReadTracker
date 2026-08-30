import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const productTitle = "TableRead Poker Tracker";
const productDescription = "Fast, durable player reads for live poker tables.";
const companionTitle = "TableRead Companion HUD";
const textExtensions = new Set([".html", ".js", ".json", ".mjs", ".txt", ".webmanifest"]);

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

test("compiled app includes the iOS companion HUD entry point", async () => {
  const builtText = await readBuiltText(distDir);

  assert.match(builtText, new RegExp(companionTitle, "i"));
  assert.match(builtText, /\/hud/i);
  assert.match(builtText, /standalone/i);
});

test("compiled iOS HUD includes Phase 2 mobile controls", async () => {
  const builtText = await readBuiltText(distDir);

  assert.match(builtText, /Game mode/i);
  assert.match(builtText, /Fast player switcher/i);
  assert.match(builtText, /flop/i);
  assert.match(builtText, /turn/i);
  assert.match(builtText, /river/i);
  assert.match(builtText, /Session note/i);
  assert.match(builtText, /Wallet/i);
  assert.match(builtText, /Offline queue/i);
});
