"use strict";

// Checks the acceleration timers with a 1 Hz GPS (one new speed a second) polled 10 times a second.
// Run with:  node code/web/tests/check_performance.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "performance.js"), "utf8"), context);
const { AccelerationTimer } = vm.runInContext("({ AccelerationTimer })", context);

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

/** Runs the timer for `seconds` polling every 0.1 s. `fixes` maps a whole second to the speed that
 *  arrives then; the GPS reports the last one until the next arrives (like the real reader). */
function drive(timer, fixes, seconds) {
  let speed = null;
  let measuredAt = null;
  for (let tenths = 0; tenths <= seconds * 10; tenths++) {
    const now = tenths / 10;
    if (Number.isInteger(now) && fixes[now] !== undefined) {
      speed = fixes[now];
      measuredAt = now;
    }
    timer.updateFromSnapshot({ speedKmh: speed, speedTimeS: speed === null ? null : measuredAt, time: now * 1000 });
  }
}

// stopped for 4 s, then +12 km/h every second
const accelerating = {};
for (let t = 0; t <= 4; t++) accelerating[t] = 0;
for (let t = 5; t <= 14; t++) accelerating[t] = (t - 4) * 12;

check("0-50 and 0-100 are interpolated between 1 Hz readings", () => {
  const timer = new AccelerationTimer();
  drive(timer, accelerating, 14);
  // 1 km/h is crossed at 4 + 1/12 s, 50 at 8 + 2/12 s, 100 at 12 + 4/12 s
  assert.ok(Math.abs(timer.results[50] - 4.083) < 0.01, "0-50 was " + timer.results[50]);
  assert.ok(Math.abs(timer.results[100] - 8.25) < 0.01, "0-100 was " + timer.results[100]);
  assert.strictEqual(timer.state, "finished");
});

check("a repeated reading is not counted as a new one", () => {
  const timer = new AccelerationTimer();
  const calls = [];
  const original = timer.update.bind(timer);
  timer.update = (speed, now) => { calls.push([speed, now]); original(speed, now); };
  const snap = { speedKmh: 30, speedTimeS: 5, time: 5000 };
  timer.updateFromSnapshot(snap);
  timer.updateFromSnapshot({ ...snap, time: 5100 });
  timer.updateFromSnapshot({ ...snap, time: 5200 });
  assert.strictEqual(calls.length, 1);
  timer.updateFromSnapshot({ speedKmh: 31, speedTimeS: 6, time: 6000 });
  assert.strictEqual(calls.length, 2);
});

check("losing the speed resets the timers", () => {
  const timer = new AccelerationTimer();
  drive(timer, { 0: 0, 1: 0, 2: 0, 3: 20 }, 3.5);
  assert.strictEqual(timer.state, "running");
  timer.updateFromSnapshot({ speedKmh: null, speedTimeS: null, time: 4000 });
  assert.strictEqual(timer.state, "waiting");
});

check("a run needs a stop first", () => {
  const timer = new AccelerationTimer();
  const rolling = {};
  for (let t = 0; t <= 12; t++) rolling[t] = 20 + t * 12; // never stopped
  drive(timer, rolling, 12);
  assert.strictEqual(timer.results[50], null);
  assert.strictEqual(timer.results[100], null);
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
