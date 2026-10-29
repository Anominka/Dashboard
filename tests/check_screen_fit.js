"use strict";

// Checks when the app is given the screen's own height (iPhone Home Screen apps that are told they
// are shorter than the screen), and that it is left alone everywhere else. Run with:
//   node code/web/tests/check_screen_fit.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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

/** Runs fitToScreen() in a fake phone and returns the height given to the app ("" if none). */
function heightAfterFit({ standalone, portrait = true, innerHeight, screenWidth = 390, screenHeight = 844 }) {
  const app = { style: { height: "stale" } };
  const context = vm.createContext({
    document: { getElementById: () => app },
    window: { matchMedia: () => ({ matches: portrait }), innerHeight },
    navigator: { standalone },
    screen: { width: screenWidth, height: screenHeight },
  });
  context.window.innerHeight = innerHeight;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "screen_fit.js"), "utf8"), context);
  vm.runInContext("fitToScreen()", context);
  return app.style.height;
}

check("an iPhone Home Screen app told it is 47 px short gets the full screen height", () => {
  assert.strictEqual(heightAfterFit({ standalone: true, innerHeight: 797 }), "844px");
});

check("an app that already has the full height is left alone", () => {
  assert.strictEqual(heightAfterFit({ standalone: true, innerHeight: 844 }), "");
});

check("a small difference (under 20 px) is left alone", () => {
  assert.strictEqual(heightAfterFit({ standalone: true, innerHeight: 835 }), "");
});

check("a big difference (a keyboard, say) is left alone", () => {
  assert.strictEqual(heightAfterFit({ standalone: true, innerHeight: 500 }), "");
});

check("a page in a Safari tab is left alone", () => {
  assert.strictEqual(heightAfterFit({ standalone: false, innerHeight: 797 }), "");
  assert.strictEqual(heightAfterFit({ standalone: undefined, innerHeight: 797 }), ""); // Android, desktop
});

check("landscape is left alone", () => {
  assert.strictEqual(heightAfterFit({ standalone: true, portrait: false, innerHeight: 350, screenWidth: 390, screenHeight: 844 }), "");
});

check("works when the phone reports width and height the other way round", () => {
  assert.strictEqual(heightAfterFit({ standalone: true, innerHeight: 797, screenWidth: 844, screenHeight: 390 }), "844px");
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
