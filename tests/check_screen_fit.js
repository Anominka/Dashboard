"use strict";

// Checks when the bottom margin is switched off (an iPhone Home Screen app whose window ends above the
// home indicator) and that it is left alone everywhere else. Run with:
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

/** Runs fitToScreen() in a fake phone and returns the value given to --bottom-inset (null if none). */
function bottomInsetAfterFit({ standalone, portrait = true, innerHeight, screenWidth = 390, screenHeight = 844 }) {
  const properties = { "--bottom-inset": "left over from before" };
  const context = vm.createContext({
    document: {
      documentElement: {
        style: {
          setProperty: (name, value) => { properties[name] = value; },
          removeProperty: (name) => { delete properties[name]; },
        },
      },
    },
    window: { matchMedia: () => ({ matches: portrait }), innerHeight },
    navigator: { standalone },
    screen: { width: screenWidth, height: screenHeight },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "screen_fit.js"), "utf8"), context);
  vm.runInContext("fitToScreen()", context);
  return properties["--bottom-inset"] === undefined ? null : properties["--bottom-inset"];
}

check("an iPhone Home Screen app whose window ends 47 px early ignores the bottom margin", () => {
  assert.strictEqual(bottomInsetAfterFit({ standalone: true, innerHeight: 797 }), "0px");
});

check("an app whose window reaches the bottom of the screen keeps the phone's margin", () => {
  assert.strictEqual(bottomInsetAfterFit({ standalone: true, innerHeight: 844 }), null);
});

check("a small difference (under 20 px) is left alone", () => {
  assert.strictEqual(bottomInsetAfterFit({ standalone: true, innerHeight: 835 }), null);
});

check("a big difference (a keyboard, say) is left alone", () => {
  assert.strictEqual(bottomInsetAfterFit({ standalone: true, innerHeight: 500 }), null);
});

check("a page in a Safari tab is left alone", () => {
  assert.strictEqual(bottomInsetAfterFit({ standalone: false, innerHeight: 797 }), null);
  assert.strictEqual(bottomInsetAfterFit({ standalone: undefined, innerHeight: 797 }), null); // Android, desktop
});

check("landscape is left alone", () => {
  assert.strictEqual(bottomInsetAfterFit({ standalone: true, portrait: false, innerHeight: 350 }), null);
});

check("works when the phone reports width and height the other way round", () => {
  assert.strictEqual(bottomInsetAfterFit({ standalone: true, innerHeight: 797, screenWidth: 844, screenHeight: 390 }), "0px");
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
