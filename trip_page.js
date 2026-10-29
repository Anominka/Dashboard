"use strict";

/* Trip page: trip statistics, efficiency score, and Pause / End trip buttons. */

const MESSAGE_DURATION_MS = 5000;

class TripPage {
  constructor(root, { trip, store }) {
    this.trip = trip;
    this.store = store;
    this._messageTimer = null;

    const captions = ["Distance", "Time", "Avg speed", "Max speed", "Fuel used", "Avg consumption"];
    this.values = {};
    const cells = captions.map((caption) => {
      this.values[caption] = h("div", { class: "stat-value" }, NO_VALUE);
      return h("div", { class: "stat" }, h("div", { class: "label" }, caption), this.values[caption]);
    });

    this.scoreValue = h("div", { class: "score-value" }, "100");
    this.liveMap = new LiveMap();
    this._snapshot = null;
    this.message = h("div", { class: "trip-message" });
    this.pauseButton = h("button", { class: "action-button", onclick: () => this.togglePause() }, "Pause trip");
    this.endButton = h("button", { class: "action-button primary", onclick: () => this.endTrip() }, "End trip");

    root.append(
      h("div", { class: "panel stats" }, cells),
      h("div", { class: "panel score-panel" },
        h("div", { class: "label" }, "Efficiency"),
        h("div", { class: "score-line" }, this.scoreValue, h("span", { class: "score-caption" }, "out of 100")),
      ),
      this.liveMap.element,
      this.message,
      h("div", { class: "button-row" }, this.pauseButton, this.endButton),
    );
  }

  togglePause() {
    if (this.trip.paused) {
      this.trip.resume();
      this.pauseButton.textContent = "Pause trip";
    } else {
      this.trip.pause();
      this.pauseButton.textContent = "Resume trip";
    }
  }

  /** Saves the trip to History (if long enough) and starts a fresh one. */
  endTrip() {
    const record = this.trip.toRecord();
    if (record === null) {
      this.showMessage(`Trip too short to save (under ${MIN_SAVED_DISTANCE_KM} km).`);
    } else {
      this.store.addTrip(record);
      this.trip.referenceL100 = this.store.referenceConsumption();
      this.showMessage("Trip saved to History.");
    }
    this.trip.reset();
    this.trip.resume();
    this.store.clearCurrentTrip(); // the backup of the trip just ended is obsolete
    this.pauseButton.textContent = "Pause trip";
    this.update();
  }

  showMessage(text, durationMs = MESSAGE_DURATION_MS) {
    this.message.textContent = text;
    clearTimeout(this._messageTimer);
    this._messageTimer = setTimeout(() => { this.message.textContent = ""; }, durationMs);
  }

  update(snap) {
    if (snap) this._snapshot = snap; // End trip redraws without a new reading
    const trip = this.trip;
    const v = this.values;
    const position = this._snapshot && this._snapshot.position;
    this.liveMap.update(trip.route, position ? { lat: position.lat, lon: position.lon } : null, this.store.settings.mapTiles);
    v["Distance"].textContent = trip.distanceKm.toFixed(1) + " km";
    v["Time"].textContent = formatDuration(trip.elapsedS);
    v["Avg speed"].textContent = trip.avgSpeedKmh.toFixed(0) + " km/h";
    v["Max speed"].textContent = trip.maxSpeedKmh.toFixed(0) + " km/h";
    v["Fuel used"].textContent = trip.hasFuelData ? trip.fuelUsedL.toFixed(2) + " L" : NO_VALUE;
    const consumption = trip.avgConsumptionL100;
    v["Avg consumption"].textContent = consumption === null ? NO_VALUE : consumption.toFixed(1) + " L/100";
    this.scoreValue.textContent = String(trip.score);
  }
}
