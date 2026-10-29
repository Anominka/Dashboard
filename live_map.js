"use strict";

/* The live map on the Trip page: the route is drawn while you drive.
 *
 * Two views, switched by tapping the map: "Following" keeps the car in the middle at street level
 * (zoom 16) with the route behind it; "Whole trip" zooms out until the whole route fits.
 * It uses the same map images and drawing as trip_map.js (see there for how the map is built).
 *
 * Positions inside the map are measured from an "anchor" (a tile corner near the view) instead of
 * from the top-left of the world: at zoom 16 the world is 16.7 million pixels wide, where the numbers
 * of an SVG line lose their precision. The anchor moves only when the car gets far from it.
 */

const LIVE_ZOOM = 16;               // street level in "Following"; also the closest "Whole trip" goes
const LIVE_REANCHOR_PX = 2500;      // the anchor is moved when the view centre is this far from it
const LIVE_TILE_MARGIN = 1;         // tiles loaded beyond the edge of the view, so scrolling shows no gaps
const LIVE_MAX_DRAWN_POINTS = 1500;
const LIVE_MOVE_SECONDS = 1;        // the map glides to each new position over this long...
const LIVE_MIN_INTERVAL_MS = 900;   // ...so it is moved at most about once a second (a glide that restarts
                                    //    more often never gets anywhere and the car would drift off the middle)

/** The tiles (as {tx, ty}, x not wrapped) needed to cover a view centred on world pixel (cx, cy),
 *  plus `margin` tiles around it. Tiles above the north pole or below the south pole are left out. */
function liveTilesNeeded(cx, cy, width, height, zoom, margin = LIVE_TILE_MARGIN) {
  const count = 2 ** zoom;
  const first = (value, size) => Math.floor((value - size / 2) / TILE_SIZE) - margin;
  const last = (value, size) => Math.floor((value + size / 2) / TILE_SIZE) + margin;
  const tiles = [];
  for (let ty = Math.max(0, first(cy, height)); ty <= Math.min(count - 1, last(cy, height)); ty++) {
    for (let tx = first(cx, width); tx <= last(cx, width); tx++) tiles.push({ tx, ty });
  }
  return tiles;
}

/** The anchor for a view centred on world pixel (cx, cy): the corner of the tile it is in. */
function liveAnchorFor(cx, cy) {
  return { x: Math.floor(cx / TILE_SIZE) * TILE_SIZE, y: Math.floor(cy / TILE_SIZE) * TILE_SIZE };
}

/** True when the anchor is missing or too far from the view centre to be kept. */
function liveNeedsNewAnchor(anchor, cx, cy) {
  return anchor === null || Math.abs(cx - anchor.x) > LIVE_REANCHOR_PX || Math.abs(cy - anchor.y) > LIVE_REANCHOR_PX;
}

class LiveMap {
  constructor() {
    this.follow = true;

    this.tiles = h("div", { class: "map-tiles live-tiles" });
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "live-route");
    this.line = document.createElementNS(SVG_NS, "polyline");
    this.line.setAttribute("class", "map-line");
    this.startDot = document.createElementNS(SVG_NS, "circle");
    this.startDot.setAttribute("class", "map-start");
    this.startDot.setAttribute("r", "6");
    this.carDot = document.createElementNS(SVG_NS, "circle"); // the car in "Whole trip", where it is on the route
    this.carDot.setAttribute("class", "map-car");
    this.carDot.setAttribute("r", "8");
    this.svg.append(this.line, this.startDot, this.carDot);

    this.world = h("div", { class: "live-world" }, this.tiles, this.svg);
    this.carMarker = h("div", { class: "map-car-fixed", hidden: "" }); // the car in "Following": always the middle
    this.note = h("div", { class: "map-note" });
    this.modeLabel = h("div", { class: "map-mode" }, "Following");
    this.attribution = h("div", { class: "map-attribution", hidden: "" }, "© OpenStreetMap contributors");
    this.element = h("div", { class: "live-map", onclick: () => this.toggle() },
      this.world, this.carMarker, this.note, this.modeLabel, this.attribution);

    this._anchor = null;
    this._zoom = null;
    this._tileImages = new Map(); // "z/x/y" -> <img>
    this._failed = new Set();     // tiles that could not be loaded; not asked for again until the next rebuild
    this._key = null;
    this._structure = null;
    this._appliedAt = 0;
    this._last = null;
  }

  /** Switches between following the car and showing the whole trip. */
  toggle() {
    this.follow = !this.follow;
    this.modeLabel.textContent = this.follow ? "Following" : "Whole trip";
    if (this._last) this.update(...this._last);
  }

  /** Draws the map. `route` is the trip's [time, lat, lon] list, `current` the car's position
   *  ({lat, lon}) or null, `showTiles` whether map images may be loaded. Cheap to call often:
   *  it does nothing when nothing changed. */
  update(route, current, showTiles) {
    this._last = [route, current, showTiles];
    const { width, height } = this.element.getBoundingClientRect();
    if (!(width > 0 && height > 0)) return; // not on screen

    const last = route.length ? route[route.length - 1] : null;
    const car = current || (last ? { lat: last[1], lon: last[2] } : null);
    // what is on the screen apart from the car's position; a change here is drawn at once, while a new
    // position is drawn at most about once a second
    const structure = [this.follow, width, height, showTiles, navigator.onLine].join("|");
    const key = [route.length, car && car.lat, car && car.lon, structure].join("|");
    if (key === this._key) return;
    const now = performance.now();
    if (structure === this._structure && now - this._appliedAt < LIVE_MIN_INTERVAL_MS) return;
    this._key = key;
    this._structure = structure;
    this._appliedAt = now;

    if (car === null) {
      this._clear();
      this.carMarker.hidden = true;
      this.note.textContent = "Waiting for GPS…";
      return;
    }
    this.note.textContent = "";

    // where the view is centred, and at which zoom
    let zoom = LIVE_ZOOM;
    let cx = worldX(car.lon, zoom);
    let cy = worldY(car.lat, zoom);
    if (!this.follow && route.length) {
      const bounds = routeBounds(route.concat([[0, car.lat, car.lon]]));
      const view = fitView(bounds, width, height, 28, LIVE_ZOOM);
      zoom = view.zoom;
      cx = view.originX + width / 2;
      cy = view.originY + height / 2;
    }

    const rebuilt = zoom !== this._zoom || liveNeedsNewAnchor(this._anchor, cx, cy);
    if (rebuilt) {
      this._clear();
      this._zoom = zoom;
      this._anchor = liveAnchorFor(cx, cy);
    }
    const anchor = this._anchor;

    if (showTiles && navigator.onLine !== false) this._syncTiles(cx, cy, width, height);
    else if (showTiles) this.note.textContent = "Offline: the route is shown without a map.";

    // the route, as pixels from the anchor; ending at the car so the line reaches it
    const shown = this.follow ? route.slice(-LIVE_MAX_DRAWN_POINTS) : route;
    const stride = Math.max(1, Math.ceil(shown.length / LIVE_MAX_DRAWN_POINTS));
    const points = [];
    for (let i = 0; i < shown.length; i += stride) points.push([shown[i][1], shown[i][2]]);
    points.push([car.lat, car.lon]);
    const pixel = ([lat, lon]) => [worldX(lon, zoom) - anchor.x, worldY(lat, zoom) - anchor.y];
    this.line.setAttribute("points", points.map((p) => pixel(p).map((v) => v.toFixed(1)).join(",")).join(" "));
    this._place(this.startDot, route.length ? pixel([route[0][1], route[0][2]]) : null);
    // while following, the car is the fixed marker in the middle; otherwise a dot on the route
    this._place(this.carDot, this.follow ? null : pixel([car.lat, car.lon]));
    this.carMarker.hidden = !this.follow;

    // slide the world so the centre is in the middle of the view; no gliding when everything was just rebuilt
    this.world.style.transition = rebuilt ? "none" : `transform ${LIVE_MOVE_SECONDS}s linear`;
    this.world.style.transform = `translate(${(width / 2 - (cx - anchor.x)).toFixed(1)}px, ${(height / 2 - (cy - anchor.y)).toFixed(1)}px)`;
  }

  _place(dot, position) {
    dot.style.display = position ? "" : "none";
    if (position) {
      dot.setAttribute("cx", position[0].toFixed(1));
      dot.setAttribute("cy", position[1].toFixed(1));
    }
  }

  /** Makes the loaded tiles match the ones the view needs: adds the missing, drops the ones far away. */
  _syncTiles(cx, cy, width, height) {
    const zoom = this._zoom;
    const count = 2 ** zoom;
    const needed = new Map();
    for (const { tx, ty } of liveTilesNeeded(cx, cy, width, height, zoom)) {
      needed.set(`${zoom}/${tx}/${ty}`, { tx, ty });
    }
    for (const [key, image] of this._tileImages) {
      if (!needed.has(key)) { image.remove(); this._tileImages.delete(key); }
    }
    for (const [key, { tx, ty }] of needed) {
      if (this._tileImages.has(key) || this._failed.has(key)) continue;
      const image = h("img", { class: "map-tile", alt: "", draggable: "false" });
      image.style.left = `${tx * TILE_SIZE - this._anchor.x}px`;
      image.style.top = `${ty * TILE_SIZE - this._anchor.y}px`;
      image.onload = () => { this.attribution.hidden = false; };
      image.onerror = () => { image.remove(); this._tileImages.delete(key); this._failed.add(key); };
      image.src = TILE_URL.replace("{z}", zoom).replace("{x}", ((tx % count) + count) % count).replace("{y}", ty);
      this.tiles.append(image);
      this._tileImages.set(key, image);
    }
  }

  _clear() {
    this.tiles.replaceChildren();
    this._tileImages.clear();
    this._failed.clear();
    this.attribution.hidden = true;
    this.line.setAttribute("points", "");
    this._place(this.startDot, null);
    this._place(this.carDot, null);
    this._anchor = null;
    this._zoom = null;
  }
}
