"use strict";

// Checks the motion sensor and its use in the acceleration timers with synthetic phone motion,
// no phone needed. Run with:  node code/web/tests/check_motion.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const fakeTarget = {
  handler: null,
  addEventListener(name, handler) { if (name === "devicemotion") this.handler = handler; },
  removeEventListener(name) { if (name === "devicemotion") this.handler = null; },
};

const context = vm.createContext({ console, DeviceMotionEvent: class {}, performance: { now: () => 0 } });
for (const file of ["performance.js", "motion.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
}
const { MotionSensor, AccelerationTimer } = vm.runInContext("({ MotionSensor, AccelerationTimer })", context);

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

// checks that wait for something; they run one after the other once the plain ones are done
const asyncChecks = [];
function checkAsync(name, test) {
  asyncChecks.push(async () => {
    try {
      await test();
      console.log("ok   " + name);
    } catch (error) {
      failures += 1;
      console.log("FAIL " + name + "\n     " + error.message);
    }
  });
}
const near = (actual, expected, tolerance, what = "value") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} was ${actual}, expected ${expected} +/- ${tolerance}`);

// --- synthetic phone motion ---

const G = 9.81;
let seed = 12345;
const noise = (amount) => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648 - 0.5) * 2 * amount; };

/** A "devicemotion" event for the car accelerating forward by `a` m/s2, with the phone upright on a stand
 *  tilted back by `tiltDeg`, screen facing the driver. `flip` mimics a phone that reports the opposite
 *  sign (as iPhones are said to). */
function motionEvent(a, tiltDeg, flip = false, noiseAmount = 0.03) {
  const s = Math.sin((tiltDeg * Math.PI) / 180);
  const c = Math.cos((tiltDeg * Math.PI) / 180);
  const own = [noise(noiseAmount), a * s + noise(noiseAmount), -a * c + noise(noiseAmount)];
  const withGravity = [own[0], own[1] + G * c, own[2] + G * s];
  const sign = flip ? -1 : 1;
  const vec = (v) => ({ x: sign * v[0], y: sign * v[1], z: sign * v[2] });
  return { acceleration: vec(own), accelerationIncludingGravity: vec(withGravity) };
}

/** Feeds a sensor 60 readings a second for [from, to] with acceleration profile `accel(t)`. */
function feed(sensor, accel, from, to, tilt, flip) {
  for (let t = from; t <= to + 1e-9; t += 1 / 60) sensor.handleMotion(motionEvent(accel(t), tilt, flip), t);
}

/** True time at which a profile first reaches `speed` (m/s), starting at `speed0` at `t0`. */
function trueCrossing(accel, t0, speed0, speed) {
  let v = speed0;
  const step = 1e-4;
  for (let t = t0; t < t0 + 20; t += step) {
    const next = v + accel(t) * step;
    if (next >= speed) return t + ((speed - v) / (next - v)) * step;
    v = next;
  }
  throw new Error("never reached");
}

const launch = (t) => (t < 0.5 ? 0 : 6.67); // stopped until 0.5 s, then hard acceleration

for (const tilt of [0, 20, 35]) {
  for (const flip of [false, true]) {
    check(`finds the launch inside a second (stand tilted ${tilt} degrees${flip ? ", opposite sign" : ""})`, () => {
      const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
      feed(sensor, launch, 0, 1, tilt, flip);
      const gained = 0.5 * 6.67 * 3.6; // km/h gained by 1.0 s: about 12
      const time = sensor.crossingTime(1 / gained, 0, 1, gained);
      near(time, trueCrossing(launch, 0, 0, 1 / 3.6), 0.03, "1 km/h crossing");
      // assuming constant acceleration would put it at 1/12 s: far too early
      assert.ok(time > 0.3);
    });
  }
}

check("follows a dip in acceleration, such as a gear change", () => {
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  const accel = (t) => (t >= 0.4 && t < 0.7 ? 0.2 : 5); // already doing 20 km/h at t=0
  const gained = (0.4 * 5 + 0.3 * 0.2 + 0.3 * 5) * 3.6; // km/h gained in the second: about 12.8
  feed(sensor, accel, 0, 1, 20, false);
  const level = 28; // km/h, reached just after the dip
  const linear = (level - 20) / gained; // where constant acceleration would put it
  const truth = trueCrossing(accel, 0, 20 / 3.6, level / 3.6);
  const time = sensor.crossingTime(linear, 0, 1, gained);
  near(time, truth, 0.04, "crossing after the dip");
  assert.ok(Math.abs(linear - truth) > 0.08, "the straight-line guess should be clearly worse (" + linear + " vs " + truth + ")");
});

check("is not used when no sensor data covers the interval", () => {
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  assert.strictEqual(sensor.crossingTime(0.5, 0, 1, 12), null);
  feed(sensor, launch, 0, 0.4, 20, false); // stops before the end of the interval
  assert.strictEqual(sensor.crossingTime(0.5, 0, 1, 12), null);
});

check("is not used when the data has a gap", () => {
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  feed(sensor, launch, 0, 0.4, 20, false);
  feed(sensor, launch, 0.8, 1, 20, false);
  assert.strictEqual(sensor.crossingTime(0.5, 0, 1, 12), null);
});

check("is not used when the sensor disagrees with GPS about how much speed was gained", () => {
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  feed(sensor, launch, 0, 1, 20, false); // the sensor saw 12 km/h
  assert.strictEqual(sensor.crossingTime(0.5, 0, 1, 60), null); // GPS says 60
  assert.strictEqual(sensor.crossingTime(0.5, 0, 1, 2), null);  // GPS says 2
});

check("is not used for sideways motion", () => {
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  for (let t = 0; t <= 1; t += 1 / 60) {
    const e = motionEvent(0, 20);
    e.acceleration.x += 4; // sideways push (cornering)
    e.accelerationIncludingGravity.x += 4;
    sensor.handleMotion(e, t);
  }
  assert.strictEqual(sensor.crossingTime(0.5, 0, 1, 12), null);
});

check("is not used when the phone lies flat (no forward direction)", () => {
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  for (let t = 0; t <= 1; t += 1 / 60) {
    sensor.handleMotion({ acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: G } }, t);
  }
  assert.strictEqual(sensor.crossingTime(0.5, 0, 1, 12), null);
});

check("works with a phone that reports no separate acceleration", () => {
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  // 3 s standing still lets the smoothed gravity settle, then the launch at 3.5 s
  const accel = (t) => (t < 3.5 ? 0 : 6.67);
  for (let t = 0; t <= 4.0; t += 1 / 60) {
    const e = motionEvent(accel(t), 20);
    sensor.handleMotion({ acceleration: null, accelerationIncludingGravity: e.accelerationIncludingGravity }, t);
  }
  const gained = 0.5 * 6.67 * 3.6; // km/h gained between the GPS readings at 3 s and 4 s
  const time = sensor.crossingTime(1 / gained, 3, 4, gained);
  near(time, 3.5 + 1 / 3.6 / 6.67, 0.08, "crossing with smoothed gravity");
});

check("ignores nonsense readings", () => {
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  sensor.handleMotion({ acceleration: null, accelerationIncludingGravity: null }, 0);
  sensor.handleMotion({ accelerationIncludingGravity: { x: NaN, y: 0, z: 0 } }, 0.1);
  assert.strictEqual(sensor.delivering, false);
});

// --- permission and messages ---

checkAsync("asks for permission, listens when allowed, reports data arriving", async () => {
  let now = 0;
  let asked = 0;
  context.DeviceMotionEvent.requestPermission = async () => { asked += 1; return "granted"; };
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => now });
  assert.strictEqual(sensor.supported, true);
  assert.ok(sensor.message(false).startsWith("Off"));
  assert.ok(sensor.message(true).includes("Tap anywhere"));
  assert.strictEqual(await sensor.enable(), true);
  assert.strictEqual(asked, 1);
  assert.ok(fakeTarget.handler, "no listener was added");
  assert.ok(sensor.message(true).includes("no motion data"));
  fakeTarget.handler(motionEvent(0, 20));
  assert.strictEqual(sensor.delivering, true);
  assert.ok(sensor.message(true).startsWith("On:"));
  now = 5; // the data stops
  assert.strictEqual(sensor.delivering, false);
  sensor.disable();
  assert.strictEqual(fakeTarget.handler, null);
});

checkAsync("a refused permission is reported and nothing is listened to", async () => {
  context.DeviceMotionEvent.requestPermission = async () => "denied";
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  assert.strictEqual(await sensor.enable(), false);
  assert.ok(sensor.message(true).startsWith("Denied"));
  assert.strictEqual(fakeTarget.handler, null);
});

checkAsync("browsers without a permission question just start listening", async () => {
  delete context.DeviceMotionEvent.requestPermission;
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  assert.strictEqual(await sensor.enable(), true);
  assert.ok(fakeTarget.handler);
  sensor.disable();
});

checkAsync("a browser with no motion support says so", async () => {
  const saved = context.DeviceMotionEvent;
  delete context.DeviceMotionEvent;
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  context.DeviceMotionEvent = saved;
  assert.strictEqual(sensor.supported, false);
  assert.strictEqual(await sensor.enable(), false);
  assert.ok(sensor.message(true).startsWith("Not available"));
});

// --- the timers, with and without the sensor ---

/** A run from a standstill: the car leaves at `leaveAt` and then accelerates at 3 m/s2. GPS gives one
 *  speed a second (at whole seconds); the timer is polled 10 times a second; the sensor delivers 60 a second. */
function runTimer(useSensor, leaveAt) {
  const accel = (t) => (t < leaveAt ? 0 : 3);
  const speedAt = (t) => Math.max(0, t - leaveAt) * 3 * 3.6; // km/h
  const sensor = new MotionSensor({ target: fakeTarget, clock: () => 0 });
  const timer = new AccelerationTimer();
  if (useSensor) timer.shape = sensor;

  let gpsSpeed = null;
  let gpsTime = null;
  for (let step = 0; step <= 16 * 60; step++) {
    const t = step / 60;
    sensor.handleMotion(motionEvent(accel(t), 25), t);
    if (step % 60 === 0) { gpsSpeed = speedAt(t); gpsTime = t; }
    if (step % 6 === 0) timer.updateFromSnapshot({ speedKmh: gpsSpeed, speedTimeS: gpsTime, time: t * 1000 });
  }
  return timer.results;
}

check("the timers are accurate with the sensor and off by a few tenths without it", () => {
  const leaveAt = 3.6;
  // the timer counts from the moment the car passes 1 km/h (STOPPED_KMH), at 3 m/s2
  const truth50 = (50 - 1) / 3.6 / 3;
  const truth100 = (100 - 1) / 3.6 / 3;
  const without = runTimer(false, leaveAt);
  const withSensor = runTimer(true, leaveAt);
  near(withSensor[50], truth50, 0.06, "0-50 with the sensor");
  near(withSensor[100], truth100, 0.06, "0-100 with the sensor");
  assert.ok(Math.abs(without[50] - truth50) > 0.3, "0-50 without the sensor was " + without[50]);
  console.log(`     0-50 truth ${truth50.toFixed(2)} s: with sensor ${withSensor[50].toFixed(2)}, without ${without[50].toFixed(2)}`);
});

check("with the sensor switched off the timers behave as before", () => {
  const results = runTimer(false, 4.0); // leaves exactly on a GPS reading: no error either way
  near(results[50], (50 - 1) / 3.6 / 3, 0.06, "0-50");
});

(async () => {
  for (const run of asyncChecks) await run();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
