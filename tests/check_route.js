"use strict";

// Checks route recording, GPS positions, backups with routes and the map maths, without a phone or
// a screen. Run with:  node code/web/tests/check_route.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = vm.createContext({ console, performance: { now: () => 0 } });
for (const file of ["gps_reader.js", "performance.js", "trip_tracker.js", "store.js", "trip_map.js", "simulated_source.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
}
const api = vm.runInContext(`({
  GPSFilter, GPSReader, positionToFix, TripTracker, MemoryStore, ROUTE_MAX_POINTS, ROUTE_MIN_STEP_M, distanceMeters,
  worldX, worldY, routeBounds, fitView, tilesFor, projectRoute, TILE_SIZE, MAP_MAX_ZOOM, MAP_MIN_ZOOM,
  simulatedPosition, SIM_ROAD_M, SIM_ORIGIN, sampleRoute
})`, context);
const { GPSFilter, positionToFix, TripTracker, MemoryStore, ROUTE_MAX_POINTS, distanceMeters } = api;

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
const near = (actual, expected, tolerance, what = "value") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} was ${actual}, expected ${expected} +/- ${tolerance}`);
const plain = (value) => JSON.parse(JSON.stringify(value)); // objects made inside the VM compare badly otherwise

// --- GPS positions ---

check("a position travels with the accepted speed", () => {
  const filter = new GPSFilter();
  filter.update(positionToFix({ coords: { speed: 10, accuracy: 5, latitude: 47.5, longitude: 8.5 } }), 100);
  const out = filter.output(100.5);
  assert.deepStrictEqual(plain(out.position), { lat: 47.5, lon: 8.5, accuracyM: 5 });
});

check("a fix without coordinates gives no position", () => {
  const filter = new GPSFilter();
  filter.update(positionToFix({ coords: { speed: 10, accuracy: 5 } }), 100);
  assert.strictEqual(filter.output(100.5).position, null);
  assert.strictEqual(positionToFix({ coords: { speed: 1, accuracy: 5, latitude: 95, longitude: 8 } }).lat, null);
  assert.strictEqual(positionToFix({ coords: { speed: 1, accuracy: 5, latitude: 47, longitude: 190 } }).lon, null);
});

check("a rejected glitch keeps the previous position", () => {
  const filter = new GPSFilter();
  filter.update(positionToFix({ coords: { speed: 10, accuracy: 5, latitude: 47.5, longitude: 8.5 } }), 100);
  filter.update(positionToFix({ coords: { speed: 150, accuracy: 5, latitude: 10, longitude: 10 } }), 101); // +140 km/h in a second
  assert.deepStrictEqual(plain(filter.output(101.2).position), { lat: 47.5, lon: 8.5, accuracyM: 5 });
});

// --- recording a route ---

/** A snapshot like the app's: `kmh` at reading number `n`, at a place `northM` metres north of a start. */
function snapshot(n, kmh, northM, { position = true } = {}) {
  return {
    time: 1000 * (100 + n), // ms on the performance clock; one reading a second
    bestSpeedKmh: kmh,
    speedKmh: kmh,
    speedTimeS: 100 + n,
    fuelRateLph: null,
    position: position ? { lat: 47 + northM / 111320, lon: 8, accuracyM: 5 } : null,
    positionEpochMs: 1700000000000 + n * 1000,
  };
}

check("points are added only after the car has moved on, and carry the time", () => {
  const trip = new TripTracker();
  for (let n = 0; n < 10; n++) trip.update(snapshot(n, 20, n * 5.5)); // 20 km/h = 5.5 m per second
  // 5.5 m is under the 8 m step, so about every second reading is kept
  assert.ok(trip.route.length >= 4 && trip.route.length <= 6, "points: " + trip.route.length);
  for (let i = 1; i < trip.route.length; i++) {
    const [, lat1, lon1] = trip.route[i - 1];
    const [, lat2, lon2] = trip.route[i];
    assert.ok(distanceMeters(lat1, lon1, lat2, lon2) >= 8, "points closer than 8 m");
  }
  assert.strictEqual(trip.route[0][0], 1700000000000);
  assert.strictEqual(trip.route[0].length, 3);
});

check("nothing is recorded when the car is (almost) standing still", () => {
  const trip = new TripTracker();
  for (let n = 0; n < 20; n++) trip.update(snapshot(n, 2.5, n * 30)); // drifting position, tiny speed
  assert.strictEqual(trip.route.length, 0);
});

check("nothing is recorded while the trip is paused, or without a position", () => {
  const trip = new TripTracker();
  trip.pause();
  for (let n = 0; n < 10; n++) trip.update(snapshot(n, 50, n * 14));
  assert.strictEqual(trip.route.length, 0);
  trip.resume();
  for (let n = 10; n < 20; n++) trip.update(snapshot(n, 50, n * 14, { position: false }));
  assert.strictEqual(trip.route.length, 0);
});

check("the same reading seen again is not recorded twice", () => {
  const trip = new TripTracker();
  const one = snapshot(1, 50, 0);
  trip.update(snapshot(0, 50, 0));
  trip.update(one);
  trip.update({ ...one, time: one.time + 100 }); // polled again before the next reading
  trip.update({ ...one, time: one.time + 200 });
  assert.strictEqual(trip.route.length, 1);
});

check("recording stops at the maximum number of points", () => {
  const trip = new TripTracker();
  trip.route = new Array(ROUTE_MAX_POINTS).fill([0, 47, 8]);
  trip.update(snapshot(0, 50, 0));
  trip.update(snapshot(1, 50, 14));
  trip.update(snapshot(2, 50, 28));
  assert.strictEqual(trip.route.length, ROUTE_MAX_POINTS);
});

check("the route survives a backup and restore, and an old backup restores with no route", () => {
  const trip = new TripTracker();
  for (let n = 0; n < 6; n++) trip.update(snapshot(n, 50, n * 14));
  const state = JSON.parse(JSON.stringify(trip.toState()));
  const other = new TripTracker();
  other.restore(state);
  assert.strictEqual(JSON.stringify(other.route), JSON.stringify(trip.route));
  delete state.route;
  other.restore(state);
  assert.strictEqual(other.route.length, 0);
});

check("a finished trip's record keeps its route and a new trip starts empty", () => {
  const trip = new TripTracker();
  for (let n = 0; n < 40; n++) trip.update(snapshot(n, 60, n * 16.7)); // about 670 m
  const record = trip.toRecord();
  assert.ok(record !== null && record.route.length > 10);
  const kept = record.route.length;
  trip.reset();
  trip.update(snapshot(50, 60, 0));
  trip.update(snapshot(51, 60, 17));
  assert.strictEqual(record.route.length, kept, "the saved route changed");
  assert.ok(trip.route.length <= 2);
});

// --- storage and backups ---

check("backups carry routes, and older trips without one stay without", () => {
  const store = new MemoryStore();
  const route = [[1700000000000, 47.1, 8.1], [1700000004000, 47.1005, 8.1005]];
  store.addTrip({ day: new Date(2026, 9, 1), distanceKm: 5, durationS: 600, lPer100km: 6, score: 80, route });
  store.addTrip({ day: new Date(2026, 9, 2), distanceKm: 6, durationS: 700, lPer100km: null, score: 70 }); // old trip
  const exported = JSON.parse(JSON.stringify(store.exportData()));
  assert.strictEqual(JSON.stringify(exported.trips[0].route), JSON.stringify(route));
  assert.ok(!("route" in exported.trips[1]));
  const parsed = MemoryStore.parseBackup(exported);
  assert.strictEqual(JSON.stringify(parsed.trips[0].route), JSON.stringify(route));
  assert.strictEqual(parsed.trips[1].route.length, 0);
});

check("a damaged route in a backup is refused", () => {
  const good = { app: "dashboard", version: 1, trips: [], runs: [] };
  const trip = (route) => ({ ...good, trips: [{ day: "2026-10-01", distanceKm: 1, durationS: 60, lPer100km: null, score: 90, route }] });
  for (const bad of ["not a list", [[1, 2]], [[1, "x", 3]], [[1, 95, 3]], [[1, 47, 200]], new Array(ROUTE_MAX_POINTS + 1).fill([0, 47, 8])]) {
    assert.throws(() => MemoryStore.parseBackup(trip(bad)), /route is damaged/);
  }
  assert.doesNotThrow(() => MemoryStore.parseBackup(trip([[1, 47, 8]])));
});

check("the map-background setting defaults to on and is read from backups", () => {
  assert.strictEqual(new MemoryStore().settings.mapTiles, true);
  const base = { app: "dashboard", version: 1, trips: [], runs: [] };
  assert.strictEqual(MemoryStore.parseBackup(base).settings.mapTiles, true);
  assert.strictEqual(MemoryStore.parseBackup({ ...base, settings: { mapTiles: false } }).settings.mapTiles, false);
});

check("demo trips come with routes of roughly the right length", () => {
  const store = new MemoryStore({ sampleTrips: true });
  for (const trip of store.trips("all")) {
    assert.ok(trip.route.length >= 2);
    let metres = 0;
    for (let i = 1; i < trip.route.length; i++) {
      metres += distanceMeters(trip.route[i - 1][1], trip.route[i - 1][2], trip.route[i][1], trip.route[i][2]);
    }
    near(metres / 1000, trip.distanceKm, trip.distanceKm * 0.15 + 0.3, "route length in km");
  }
});

// --- map maths ---

check("the map projection agrees with the standard tile formulas", () => {
  const places = [[47.3769, 8.5417], [0, 0], [-33.87, 151.21], [64.1, -21.9], [35.68, 139.69]];
  for (const zoom of [3, 10, 15]) {
    for (const [lat, lon] of places) {
      const rad = (lat * Math.PI) / 180;
      const x = ((lon + 180) / 360) * 2 ** zoom;
      const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom; // the textbook form
      near(api.worldX(lon, zoom) / api.TILE_SIZE, x, 1e-9, `x at zoom ${zoom}`);
      near(api.worldY(lat, zoom) / api.TILE_SIZE, y, 1e-9, `y at zoom ${zoom}`);
    }
  }
});

function boundsOf(route) { return api.routeBounds(route); }

check("the view shows the whole route, centred, with room to spare", () => {
  const route = [];
  for (let i = 0; i <= 20; i++) route.push([i, 47.37 + i * 0.0005, 8.54 + i * 0.0007]); // about 1.5 km diagonal
  const width = 358, height = 420;
  const view = api.fitView(boundsOf(route), width, height);
  const points = api.projectRoute(route, view);
  for (const [x, y] of points) {
    assert.ok(x >= 28 - 0.5 && x <= width - 28 + 0.5, "x outside the padding: " + x);
    assert.ok(y >= 28 - 0.5 && y <= height - 28 + 0.5, "y outside the padding: " + y);
  }
  // one zoom level closer would not fit, so the route fills most of the view
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  assert.ok(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > 0.4 * Math.min(width, height));
  near((Math.min(...xs) + Math.max(...xs)) / 2, width / 2, 1, "horizontal centre");
  near((Math.min(...ys) + Math.max(...ys)) / 2, height / 2, 1, "vertical centre");
});

check("tiny and huge routes get sensible zoom levels", () => {
  assert.strictEqual(api.fitView(boundsOf([[0, 47, 8], [1, 47.00001, 8.00001]]), 358, 420).zoom, api.MAP_MAX_ZOOM);
  const continent = api.fitView(boundsOf([[0, 36, -9], [1, 60, 30]]), 358, 420).zoom;
  assert.ok(continent >= api.MAP_MIN_ZOOM && continent <= 5, "zoom " + continent);
});

check("the tiles cover the whole view and are numbered inside the world", () => {
  const route = [[0, 47.37, 8.54], [1, 47.39, 8.58]];
  const width = 358, height = 420;
  const view = api.fitView(boundsOf(route), width, height);
  const tiles = api.tilesFor(view, width, height);
  assert.ok(tiles.length >= 1);
  const count = 2 ** view.zoom;
  for (const t of tiles) assert.ok(t.x >= 0 && t.x < count && t.y >= 0 && t.y < count, "tile out of range");
  const left = Math.min(...tiles.map((t) => t.left)), top = Math.min(...tiles.map((t) => t.top));
  const right = Math.max(...tiles.map((t) => t.left)) + 256, bottom = Math.max(...tiles.map((t) => t.top)) + 256;
  assert.ok(left <= 0 && top <= 0 && right >= width && bottom >= height, "the view is not covered");
  // the tile under the middle of the view is the one that holds the route's centre
  const centre = tiles.find((t) => t.left <= width / 2 && width / 2 < t.left + 256 && t.top <= height / 2 && height / 2 < t.top + 256);
  const midLon = (8.54 + 8.58) / 2, midLat = (47.37 + 47.39) / 2;
  assert.strictEqual(centre.x, Math.floor(api.worldX(midLon, view.zoom) / 256));
  assert.strictEqual(centre.y, Math.floor(api.worldY(midLat, view.zoom) / 256) );
});

check("tile numbers wrap around the world sideways and stop at the poles", () => {
  const view = { zoom: 2, originX: -300, originY: -100 };
  const tiles = api.tilesFor(view, 400, 400);
  assert.ok(tiles.every((t) => t.x >= 0 && t.x < 4 && t.y >= 0 && t.y < 4));
  assert.ok(tiles.some((t) => t.x === 3), "the tile left of the date line is the last one");
});

check("a long route is thinned out but keeps its first and last point", () => {
  const route = [];
  for (let i = 0; i < 9000; i++) route.push([i, 47 + i * 1e-5, 8 + i * 1e-5]);
  const view = api.fitView(boundsOf(route), 358, 420);
  const points = api.projectRoute(route, view, 1500);
  assert.ok(points.length <= 1501);
  const first = api.projectRoute([route[0]], view)[0], last = api.projectRoute([route[8999]], view)[0];
  near(points[0][0], first[0], 1e-9); near(points[points.length - 1][1], last[1], 1e-9);
});

// --- the simulated road ---

check("the simulated drive follows a closed road without jumps", () => {
  const corners = api.SIM_ROAD_M.concat([api.SIM_ROAD_M[0]]);
  let loop = 0;
  for (let i = 0; i < corners.length - 1; i++) loop += Math.hypot(corners[i + 1][0] - corners[i][0], corners[i + 1][1] - corners[i][1]);
  const start = api.simulatedPosition(0);
  const after = api.simulatedPosition(loop);
  near(after.lat, start.lat, 1e-9); near(after.lon, start.lon, 1e-9);
  let previous = start;
  for (let d = 10; d <= loop; d += 10) {
    const here = api.simulatedPosition(d);
    // 10 m along the road; a step that spans one of the 45 degree corners is a little shorter in a straight line
    const step = distanceMeters(previous.lat, previous.lon, here.lat, here.lon);
    assert.ok(step >= 9.2 && step <= 10.05, `step at ${d} m was ${step}`);
    previous = here;
  }
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
