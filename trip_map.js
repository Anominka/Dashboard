"use strict";

/* Draws a trip's route: always as a line, and behind it a real map (OpenStreetMap tiles) when the
 * phone is online and the Settings switch allows it.
 *
 * The map uses the usual "slippy map" scheme: the world is a square of 256 x 2^zoom pixels in Web
 * Mercator, cut into 256-pixel tiles. The functions at the top are plain maths (tested without a
 * screen); `TripMap` at the bottom does the drawing. A route is a list of [time, lat, lon] points.
 */

const TILE_SIZE = 256;
const MAP_MIN_ZOOM = 2;
const MAP_MAX_ZOOM = 17;      // street level; tiles do not go much closer
const MAP_PADDING_PX = 28;    // empty space kept around the route
const MAP_MAX_DRAWN_POINTS = 1500;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SVG_NS = "http://www.w3.org/2000/svg";

/** Horizontal position of a longitude in world pixels at a zoom level. */
function worldX(lon, zoom) {
  return ((lon + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

/** Vertical position of a latitude in world pixels (grows towards the south). */
function worldY(lat, zoom) {
  const sine = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  return (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * TILE_SIZE * 2 ** zoom;
}

function routeBounds(route) {
  const bounds = { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 };
  for (const [, lat, lon] of route) {
    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
    bounds.minLon = Math.min(bounds.minLon, lon);
    bounds.maxLon = Math.max(bounds.maxLon, lon);
  }
  return bounds;
}

/** The closest zoom level at which the whole route fits in `width` x `height` pixels with `padding`
 *  to spare, and the world pixel at the top-left corner of the view, with the route in the middle. */
function fitView(bounds, width, height, padding = MAP_PADDING_PX) {
  let zoom = MAP_MAX_ZOOM;
  for (; zoom > MAP_MIN_ZOOM; zoom--) {
    const routeWidth = worldX(bounds.maxLon, zoom) - worldX(bounds.minLon, zoom);
    const routeHeight = worldY(bounds.minLat, zoom) - worldY(bounds.maxLat, zoom);
    if (routeWidth <= width - 2 * padding && routeHeight <= height - 2 * padding) break;
  }
  const centerX = (worldX(bounds.minLon, zoom) + worldX(bounds.maxLon, zoom)) / 2;
  const centerY = (worldY(bounds.minLat, zoom) + worldY(bounds.maxLat, zoom)) / 2;
  return { zoom, originX: centerX - width / 2, originY: centerY - height / 2 };
}

/** The map tiles that cover a view, each with its position inside the view. */
function tilesFor(view, width, height) {
  const count = 2 ** view.zoom;
  const tiles = [];
  for (let ty = Math.floor(view.originY / TILE_SIZE); ty <= Math.floor((view.originY + height) / TILE_SIZE); ty++) {
    if (ty < 0 || ty >= count) continue; // above the north pole or below the south pole
    for (let tx = Math.floor(view.originX / TILE_SIZE); tx <= Math.floor((view.originX + width) / TILE_SIZE); tx++) {
      tiles.push({
        x: ((tx % count) + count) % count, // the world repeats sideways
        y: ty,
        left: tx * TILE_SIZE - view.originX,
        top: ty * TILE_SIZE - view.originY,
      });
    }
  }
  return tiles;
}

/** The route as pixel positions inside the view. Long routes are thinned out, keeping the last point. */
function projectRoute(route, view, maxPoints = MAP_MAX_DRAWN_POINTS) {
  const stride = Math.max(1, Math.ceil(route.length / maxPoints));
  const points = [];
  for (let i = 0; i < route.length; i += stride) points.push(route[i]);
  if (points[points.length - 1] !== route[route.length - 1]) points.push(route[route.length - 1]);
  return points.map(([, lat, lon]) => [worldX(lon, view.zoom) - view.originX, worldY(lat, view.zoom) - view.originY]);
}

class TripMap {
  constructor() {
    this.tiles = h("div", { class: "map-tiles" });
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "map-route");
    this.note = h("div", { class: "map-note" });
    this.attribution = h("div", { class: "map-attribution", hidden: "" }, "© OpenStreetMap contributors");
    this.element = h("div", { class: "trip-map" }, this.tiles, this.svg, this.note, this.attribution);
    this._route = [];
    this._showTiles = true;
  }

  /** Shows a route. `showTiles` says whether the map behind it may be loaded. */
  setRoute(route, showTiles) {
    this._route = route || [];
    this._showTiles = showTiles;
    this.render();
  }

  /** Draws the map at the size it has now. Call again when it changes size or becomes visible. */
  render() {
    this.tiles.replaceChildren();
    this.svg.replaceChildren();
    this.note.textContent = "";
    this.attribution.hidden = true;

    const { width, height } = this.element.getBoundingClientRect();
    if (!(width > 0 && height > 0)) return; // not on screen yet
    if (this._route.length < 2) {
      this.note.textContent = "No route was recorded for this trip.";
      return;
    }

    const view = fitView(routeBounds(this._route), width, height);
    if (this._showTiles) {
      if (navigator.onLine === false) {
        this.note.textContent = "Offline: the route is shown without a map.";
      } else {
        this._addTiles(tilesFor(view, width, height), view);
      }
    }

    const points = projectRoute(this._route, view);
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("class", "map-line");
    line.setAttribute("points", points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
    this.svg.append(line);
    for (const [kind, [x, y]] of [["map-start", points[0]], ["map-end", points[points.length - 1]]]) {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("class", kind);
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute("cy", y.toFixed(1));
      dot.setAttribute("r", "7");
      this.svg.append(dot);
    }
  }

  _addTiles(tiles, view) {
    let failed = 0;
    for (const tile of tiles) {
      const image = h("img", { class: "map-tile", alt: "", draggable: "false" });
      image.style.left = `${tile.left}px`;
      image.style.top = `${tile.top}px`;
      image.onerror = () => {
        image.remove();
        failed += 1;
        if (failed === tiles.length) this.note.textContent = "The map could not be loaded. The route is shown without it.";
      };
      image.onload = () => { this.attribution.hidden = false; };
      image.src = TILE_URL.replace("{z}", view.zoom).replace("{x}", tile.x).replace("{y}", tile.y);
      this.tiles.append(image);
    }
  }
}
