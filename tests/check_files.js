"use strict";

// Checks that the offline file list in sw.js matches the files of the app, that every file the
// page loads exists, and that the manifest points at real icons. Run with:
//   node code/web/tests/check_files.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
let failures = 0;
function check(name, test) {
  try {
    test();
    console.log("ok   " + name);
  } catch (error) {
    failures += 1;
    console.log("FAIL " + name + "\n     " + error.message);
  }
}

function listFiles(dir, prefix = "") {
  const found = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) found.push(...listFiles(path.join(dir, entry.name), relative + "/"));
    else found.push(relative);
  }
  return found;
}

const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const cached = vm.runInNewContext(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1]).filter((f) => f !== "./");

// files that are part of the app; tests, tools and license text are not served to the phone
const appFiles = listFiles(".").filter(
  (f) => !f.startsWith("tests/") && !f.startsWith("tools/") && f !== "sw.js" && f !== "fonts/OFL.txt",
);

check("every app file is in the offline list", () => {
  const missing = appFiles.filter((f) => !cached.includes(f));
  assert.strictEqual(missing.length, 0, "missing from sw.js: " + missing.join(", "));
});

check("the offline list names no file that does not exist", () => {
  const unknown = cached.filter((f) => !appFiles.includes(f));
  assert.strictEqual(unknown.length, 0, "not in the folder: " + unknown.join(", "));
});

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

check("every script and stylesheet in index.html exists", () => {
  const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(referenced.length > 10);
  for (const file of referenced) assert.ok(fs.existsSync(path.join(root, file)), file + " is missing");
});

check("every script loaded by index.html is in the offline list", () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const file of scripts) assert.ok(cached.includes(file), file + " is not in sw.js");
});

check("the manifest points at real icons", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  assert.strictEqual(manifest.display, "standalone");
  assert.strictEqual(manifest.start_url, "./");
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, icon.src)), icon.src + " is missing");
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
