"use strict";

/* Live page: big speed with the trip summary below it, and three tiles at the bottom. */

class LivePage {
  constructor(root, { trip }) {
    this.trip = trip;

    this.speed = h("div", { class: "speed-value" }, NO_VALUE);
    this.distance = h("span", { class: "row-value" }, NO_VALUE);
    this.time = h("span", { class: "row-value" }, NO_VALUE);
    this.avgSpeed = h("span", { class: "row-value" }, NO_VALUE);
    this.score = h("span", { class: "row-value accent" }, NO_VALUE);

    const tripRow = (caption, value) =>
      h("div", { class: "trip-row" }, h("span", { class: "row-label" }, caption), value);

    const speedPanel = h("div", { class: "panel speed-panel" },
      h("div", { class: "speed-block" }, this.speed, h("div", { class: "speed-unit" }, "km/h")),
      h("div", { class: "trip-list" },
        h("div", { class: "label" }, "This trip"),
        tripRow("Distance", this.distance),
        tripRow("Time", this.time),
        tripRow("Avg speed", this.avgSpeed),
        tripRow("Score", this.score),
      ),
    );

    this.rpm = h("div", { class: "tile-value" }, NO_VALUE);
    this.coolant = h("div", { class: "tile-value" }, NO_VALUE);
    this.consumption = h("div", { class: "tile-value" }, NO_VALUE);
    const tile = (caption, value) =>
      h("div", { class: "panel tile" }, h("div", { class: "label" }, caption), value);

    root.append(
      speedPanel,
      h("div", { class: "tiles" },
        tile("RPM", this.rpm),
        tile("Coolant", this.coolant),
        tile("L/100 km", this.consumption),
      ),
    );
  }

  update(snap) {
    const text = (value, digits, suffix = "") => (value === null ? NO_VALUE : value.toFixed(digits) + suffix);
    this.speed.textContent = text(snap.bestSpeedKmh, 0);
    this.rpm.textContent = text(snap.rpm, 0);
    this.coolant.textContent = text(snap.coolantC, 0, " °C");
    this.consumption.textContent = text(snap.fuelLPer100km, 1);

    const trip = this.trip;
    this.distance.textContent = trip.distanceKm.toFixed(1) + " km";
    this.time.textContent = formatDuration(trip.elapsedS);
    this.avgSpeed.textContent = trip.avgSpeedKmh.toFixed(0) + " km/h";
    this.score.textContent = String(trip.score);
  }
}
