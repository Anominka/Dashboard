"use strict";

// Checks the GPS filter and reader with fake positions, no phone needed. Run with:
//   node code/web/tests/check_gps_reader.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// the web files are plain browser scripts, so load them into one shared scope
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "gps_reader.js"), "utf8"), context);
const { GPSFilter, GPSReader, positionToFix } = vm.runInContext("({ GPSFilter, GPSReader, positionToFix })", context);

// objects made inside the VM have a different prototype, so compare them as JSON
function same(actual, expected) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected));
}

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

/** A fake Geolocation that remembers its callbacks. */
function fakeGeolocation() {
  const geo = { watches: [], cleared: [], nextId: 1 };
  geo.watchPosition = (onPosition, onError) => {
    geo.watches.push({ id: geo.nextId, onPosition, onError });
    return geo.nextId++;
  };
  geo.clearWatch = (id) => geo.cleared.push(id);
  return geo;
}

function makeReader() {
  const geo = fakeGeolocation();
  const time = { now: 100 };
  const reader = new GPSReader(geo, () => time.now);
  reader.connect();
  const watch = () => geo.watches[geo.watches.length - 1];
  const send = (kmh, accuracy = 5) =>
    watch().onPosition({ coords: { speed: kmh === null ? null : kmh / 3.6, accuracy } });
  return { geo, time, reader, send, watch };
}

check("converts m/s to km/h and reports a fix", () => {
  const { reader, send } = makeReader();
  send(50);
  const out = reader.read();
  assert.strictEqual(out.hasFix, true);
  assert.ok(Math.abs(out.speedKmh - 50) < 1e-9);
});

check("the reading carries the time it was measured", () => {
  const { reader, time, send } = makeReader();
  send(50);
  const measuredAt = time.now;
  time.now += 0.4; // polled again before the next reading arrives
  assert.strictEqual(reader.read().time, measuredAt);
});

check("is connected with no fix until the first good reading", () => {
  const { reader } = makeReader();
  assert.strictEqual(reader.connected, true);
  same(reader.read(), { speedKmh: null, hasFix: false });
});

check("a reading without speed is not trusted", () => {
  const { reader, send } = makeReader();
  send(null);
  assert.strictEqual(reader.read().hasFix, false);
});

check("poor position accuracy is not trusted", () => {
  const { reader, send } = makeReader();
  send(50, 120);
  assert.strictEqual(reader.read().hasFix, false);
  send(50, 10);
  assert.strictEqual(reader.read().hasFix, true);
});

check("an impossible speed is not trusted", () => {
  const fix = positionToFix({ coords: { speed: 500 / 3.6, accuracy: 5 } });
  assert.strictEqual(fix.valid, false);
  assert.strictEqual(positionToFix({ coords: { speed: -1, accuracy: 5 } }).valid, false);
});

check("drift below the noise floor counts as stopped", () => {
  const { reader, send } = makeReader();
  send(0.6);
  assert.strictEqual(reader.read().speedKmh, 0);
});

check("a one-reading jump is ignored", () => {
  const { reader, time, send } = makeReader();
  send(50);
  time.now += 1;
  send(160); // +110 km/h in one second
  assert.ok(Math.abs(reader.read().speedKmh - 50) < 1e-9);
  time.now += 1;
  send(52);
  assert.ok(Math.abs(reader.read().speedKmh - 52) < 1e-9);
});

check("a lasting new level is accepted after 5 readings", () => {
  const { reader, time, send } = makeReader();
  send(50);
  // +250 km/h: too big for the allowance, which grows with the time since the last accepted reading
  for (let i = 0; i < 4; i++) { time.now += 1; send(300); }
  assert.ok(Math.abs(reader.read().speedKmh - 50) < 1e-9);
  time.now += 1;
  send(300);
  assert.ok(Math.abs(reader.read().speedKmh - 300) < 1e-9);
});

check("normal hard acceleration and braking are accepted", () => {
  const { reader, time, send } = makeReader();
  send(0);
  time.now += 1; send(25);  // 25 km/h per second, under the 30 limit
  assert.ok(Math.abs(reader.read().speedKmh - 25) < 1e-9);
  time.now += 1; send(0);   // -25 km/h per second
  assert.strictEqual(reader.read().speedKmh, 0);
});

check("speed disappears when no good fix arrives for 3 s", () => {
  const { reader, time, send } = makeReader();
  send(50);
  time.now += 2.5;
  assert.strictEqual(reader.read().hasFix, true); // one or two missed readings are tolerated
  time.now += 1;
  same(reader.read(), { speedKmh: null, hasFix: false });
});

check("after a signal loss the filter starts fresh", () => {
  const { reader, time, send } = makeReader();
  send(50);
  time.now += 10;
  send(100); // would be an impossible jump from 50, but 50 is long forgotten
  assert.ok(Math.abs(reader.read().speedKmh - 100) < 1e-9);
});

check("permission denied disconnects and explains why", () => {
  const { reader, watch } = makeReader();
  watch().onError({ code: 1 });
  assert.strictEqual(reader.connected, false);
  assert.ok(reader.lastError.includes("denied"));
});

check("other errors leave the GPS connected without a fix", () => {
  const { reader, watch } = makeReader();
  watch().onError({ code: 2 }); // position unavailable
  watch().onError({ code: 3 }); // timeout
  assert.strictEqual(reader.connected, true);
  assert.strictEqual(reader.read().hasFix, false);
});

check("reconnecting stops the old watch and forgets old data", () => {
  const { geo, reader, send } = makeReader();
  send(50);
  reader.connect();
  same(geo.cleared, [1]);
  assert.strictEqual(geo.watches.length, 2);
  assert.strictEqual(reader.read().hasFix, false);
});

check("a browser without location support is reported", () => {
  const reader = new GPSReader(null, () => 0);
  assert.strictEqual(reader.connect(), false);
  assert.strictEqual(reader.connected, false);
  assert.ok(reader.lastError.includes("no location support"));
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
