"use strict";

// Checks the live map's view maths (which tiles to load, when to move the anchor) and that the
// whole-trip view can be capped at street level. Run with:  node code/web/tests/check_live_map.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = vm.createContext({ console });
for (const file of ["trip_map.js", "live_map.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
}
const api = vm.runInContext(
  "({ worldX, worldY, fitView, routeBounds, TILE_SIZE, MAP_MAX_ZOOM, LIVE_ZOOM, LIVE_REANCHOR_PX, liveTilesNeeded, liveAnchorFor, liveNeedsNewAnchor })",
  context,
);

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

const zurich = { lat: 47.3769, lon: 8.5417 };

check("the tiles cover the whole view, with a margin around it", () => {
  const zoom = api.LIVE_ZOOM;
  const cx = api.worldX(zurich.lon, zoom), cy = api.worldY(zurich.lat, zoom);
  const width = 358, height = 300;
  const tiles = api.liveTilesNeeded(cx, cy, width, height, zoom, 1);
  const xs = tiles.map((t) => t.tx), ys = tiles.map((t) => t.ty);
  // the view runs from cx - width/2 to cx + width/2; one extra tile on each side
  assert.ok(Math.min(...xs) * 256 <= cx - width / 2 - 256 + 1);
  assert.ok((Math.max(...xs) + 1) * 256 >= cx + width / 2 + 256 - 1);
  assert.ok(Math.min(...ys) * 256 <= cy - height / 2 - 256 + 1);
  assert.ok((Math.max(...ys) + 1) * 256 >= cy + height / 2 + 256 - 1);
  // and no tile twice
  assert.strictEqual(new Set(tiles.map((t) => t.tx + "/" + t.ty)).size, tiles.length);
});

check("a small step moves the needed tiles by at most one column", () => {
  const zoom = api.LIVE_ZOOM;
  const cx = api.worldX(zurich.lon, zoom), cy = api.worldY(zurich.lat, zoom);
  const key = (t) => t.tx + "/" + t.ty;
  const before = new Set(api.liveTilesNeeded(cx, cy, 358, 300, zoom).map(key));
  const after = api.liveTilesNeeded(cx + 20, cy, 358, 300, zoom); // 20 px along
  const added = after.filter((t) => !before.has(key(t)));
  assert.ok(added.length <= 6, "tiles added by a 20 px step: " + added.length);
});

check("tiles beyond the poles are left out", () => {
  const zoom = 3;
  const tiles = api.liveTilesNeeded(1024, 5, 358, 300, zoom, 2); // right at the top of the world
  assert.ok(tiles.length > 0 && tiles.every((t) => t.ty >= 0 && t.ty < 8));
});

check("the anchor is a tile corner and is kept until the car is far away", () => {
  const anchor = api.liveAnchorFor(1000.5, 2050.25);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(anchor)), { x: 768, y: 2048 });
  assert.strictEqual(api.liveNeedsNewAnchor(null, 0, 0), true);
  assert.strictEqual(api.liveNeedsNewAnchor(anchor, 1000, 2050), false);
  assert.strictEqual(api.liveNeedsNewAnchor(anchor, 768 + api.LIVE_REANCHOR_PX + 1, 2050), true);
  assert.strictEqual(api.liveNeedsNewAnchor(anchor, 1000, 2048 - api.LIVE_REANCHOR_PX - 1), true);
});

check("positions measured from the anchor stay small and precise", () => {
  const zoom = api.LIVE_ZOOM;
  const cx = api.worldX(zurich.lon, zoom), cy = api.worldY(zurich.lat, zoom);
  const anchor = api.liveAnchorFor(cx, cy);
  // a point 8 m east of the centre: about 5 px, to a tenth of a pixel
  const eastLon = zurich.lon + 8 / (111320 * Math.cos((zurich.lat * Math.PI) / 180));
  const dx = api.worldX(eastLon, zoom) - api.worldX(zurich.lon, zoom);
  assert.ok(dx > 4 && dx < 6, "8 m east is " + dx + " px");
  assert.ok(Math.abs(cx - anchor.x) < 256 && Math.abs(cy - anchor.y) < 256);
});

check("the whole-trip view can be capped at street level", () => {
  const bounds = api.routeBounds([[0, 47.3769, 8.5417], [1, 47.37691, 8.54171]]); // a few metres
  assert.strictEqual(api.fitView(bounds, 358, 300).zoom, api.MAP_MAX_ZOOM);
  assert.strictEqual(api.fitView(bounds, 358, 300, 28, api.LIVE_ZOOM).zoom, api.LIVE_ZOOM);
  const longRoute = api.routeBounds([[0, 47.0, 8.0], [1, 47.5, 9.0]]);
  const zoom = api.fitView(longRoute, 358, 300, 28, api.LIVE_ZOOM).zoom;
  assert.ok(zoom < api.LIVE_ZOOM, "a 80 km route must zoom out, got " + zoom);
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
