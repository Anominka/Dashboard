"use strict";

/* Running totals for the current trip, fed by live snapshots. Web counterpart of trip_tracker.py. */

const MIN_SAVED_DISTANCE_KM = 0.1; // shorter trips (e.g. an accidental End trip) are not saved
const MAX_STEP_S = 1.0;            // ignore long gaps (e.g. the page was frozen) instead of counting them
const MOVING_KMH = 1.0;            // above this the car counts as moving
const SUSTAINED_READINGS = 3;      // a speed must last this many readings to count as the trip's max
const ACCEL_WINDOW_S = 1.0;        // acceleration is measured over about this long, to smooth GPS noise

// The route: a point is added when the car has moved this far from the last one (slower than the
// minimum speed, GPS drift would draw a scribble), and recording stops at the maximum (about 8 hours).
const ROUTE_MIN_STEP_M = 8;
const ROUTE_MIN_SPEED_KMH = 3;
const ROUTE_MAX_POINTS = 30000;

/** Distance in metres between two places on the Earth (haversine). */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

class TripTracker {
  constructor() {
    this.paused = false;
    this.referenceL100 = null; // the driver's usual consumption, from past trips
    this.reset();
  }

  /** Start a fresh trip. Pause state and the reference consumption are kept. */
  reset() {
    this.startedOn = startOfToday();
    this.distanceKm = 0.0;
    this.elapsedS = 0.0;
    this.movingS = 0.0;
    this.maxSpeedKmh = 0.0;
    this.fuelUsedL = 0.0;
    this.hasFuelData = false;
    this.harshAccelS = 0.0;
    this.harshBrakeS = 0.0;
    this.route = [];    // [time as ms since 1970, latitude, longitude] of each point, in order
    this._lastRouteReading = null;
    this._forgetLastReading();
  }

  _forgetLastReading() {
    this._lastTime = null;
    this._samples = []; // [time, speed] of roughly the last second
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  update(snapshot) {
    const now = snapshot.time / 1000;
    const speed = snapshot.bestSpeedKmh;
    if (speed === null || this.paused) {
      this._forgetLastReading();
      return;
    }

    const accel = this._acceleration(now, speed);
    if (this._lastTime !== null) {
      const dt = Math.min(now - this._lastTime, MAX_STEP_S);
      this.elapsedS += dt;
      this.distanceKm += (speed * dt) / 3600;
      this.maxSpeedKmh = Math.max(this.maxSpeedKmh, this._sustainedSpeed());
      if (speed > MOVING_KMH) this.movingS += dt;
      if (snapshot.fuelRateLph !== null) {
        this.hasFuelData = true;
        this.fuelUsedL += (snapshot.fuelRateLph * dt) / 3600;
      }
      if (accel !== null) {
        if (accel > HARSH_ACCEL_KMH_PER_S) this.harshAccelS += dt;
        else if (accel < HARSH_BRAKE_KMH_PER_S) this.harshBrakeS += dt;
      }
    }
    this._lastTime = now;
    this._recordRoute(snapshot, speed);
  }

  /** Adds the car's position to the route when it is a new reading and the car has moved on. */
  _recordRoute(snapshot, speed) {
    const position = snapshot.position;
    if (!position || snapshot.speedTimeS === this._lastRouteReading) return;
    this._lastRouteReading = snapshot.speedTimeS;
    if (speed < ROUTE_MIN_SPEED_KMH || this.route.length >= ROUTE_MAX_POINTS) return;
    const last = this.route[this.route.length - 1];
    if (last && distanceMeters(last[1], last[2], position.lat, position.lon) < ROUTE_MIN_STEP_M) return;
    // six decimals are about 0.1 m, more than a phone's GPS can tell
    this.route.push([
      Math.round(snapshot.positionEpochMs),
      Math.round(position.lat * 1e6) / 1e6,
      Math.round(position.lon * 1e6) / 1e6,
    ]);
  }

  /** The lowest of the last few readings, so a one-reading spike never becomes the max. */
  _sustainedSpeed() {
    const recent = this._samples.slice(-SUSTAINED_READINGS).map(([, speed]) => speed);
    return recent.length === SUSTAINED_READINGS ? Math.min(...recent) : 0.0;
  }

  /** Speed change per second over the last ~second, or null if too little history. */
  _acceleration(now, speed) {
    this._samples.push([now, speed]);
    while (now - this._samples[0][0] > ACCEL_WINDOW_S) this._samples.shift();
    const [oldTime, oldSpeed] = this._samples[0];
    const span = now - oldTime;
    if (span < ACCEL_WINDOW_S / 2) return null;
    return (speed - oldSpeed) / span;
  }

  static STATE_FIELDS = [
    "distanceKm", "elapsedS", "movingS", "maxSpeedKmh",
    "fuelUsedL", "hasFuelData", "harshAccelS", "harshBrakeS",
  ];

  /** The trip's progress as a plain object, for backing it up. */
  toState() {
    const state = {};
    for (const name of TripTracker.STATE_FIELDS) state[name] = this[name];
    state.startedOn = dayToText(this.startedOn);
    state.route = this.route;
    return state;
  }

  /** Load progress saved by toState(). A backup made before routes were recorded has none. */
  restore(state) {
    for (const name of TripTracker.STATE_FIELDS) this[name] = state[name];
    this.startedOn = textToDay(state.startedOn) || startOfToday();
    this.route = Array.isArray(state.route) ? state.route : [];
  }

  /** The finished trip as a record, or null if too short to be worth saving. */
  toRecord() {
    if (this.distanceKm < MIN_SAVED_DISTANCE_KM) return null;
    return {
      day: this.startedOn,
      distanceKm: this.distanceKm,
      durationS: this.elapsedS,
      lPer100km: this.avgConsumptionL100,
      score: this.score,
      route: this.route,
    };
  }

  get avgSpeedKmh() {
    return this.elapsedS <= 0 ? 0.0 : this.distanceKm / (this.elapsedS / 3600);
  }

  /** null until the trip is long enough, or when fuel data is not available. */
  get avgConsumptionL100() {
    if (this.distanceKm < 0.05 || this.fuelUsedL <= 0) return null;
    return (this.fuelUsedL / this.distanceKm) * 100;
  }

  /** Efficiency score out of 100 (see efficiencyScore). */
  get score() {
    return efficiencyScore(
      this.movingS, this.harshAccelS, this.harshBrakeS,
      this.distanceKm, this.avgConsumptionL100, this.referenceL100,
    );
  }
}
