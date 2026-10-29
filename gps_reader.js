"use strict";

/* Reads speed from the phone's GPS through the browser (Geolocation API) and filters out glitches.
 *
 * Two layers, so each can be tested without a phone:
 *   GPSFilter - decides which fixes to trust
 *   GPSReader - owns the location watch; follows the GPS reader interface described in telemetry.js
 *
 * Web counterpart of gps_reader.py. The browser gives no NMEA text and no satellite count, so
 * the position accuracy it reports takes the place of the satellite and HDOP checks.
 */

const MS_TO_KMH = 3.6;

// --- Glitch protection: first guesses, to be tuned on real drives ---
const MAX_ACCURACY_M = 50;           // position accuracy worse than this: fix not trusted
const MAX_PLAUSIBLE_KMH = 400.0;     // anything above is a corrupted value
const NOISE_FLOOR_KMH = 1.0;         // a stationary receiver drifts; below this counts as 0
const MAX_ACCEL_KMH_PER_S = 30.0;    // faster speed-up than this is not physically believable
const MAX_DECEL_KMH_PER_S = 45.0;    // faster braking than this is not believable
const JUMP_MARGIN_KMH = 3.0;         // extra allowance on top of the acceleration limits
const JUMP_ACCEPT_AFTER = 5;         // this many suspicious readings in a row: accept the new level
const GPS_STALE_TIMEOUT_S = 3.0;     // no good fix for this long: no speed ("--") at all
                                     // (3 s, not the 2 s of the 10 Hz receiver, because a phone gives about 1 fix a second)

// Geolocation error codes
const PERMISSION_DENIED = 1;

/** Decides which fixes to trust and what speed to report. A fix is {speedKmh, valid, accuracyM}. */
class GPSFilter {
  constructor() {
    this._speed = null;       // last accepted speed
    this._acceptedAt = null;  // when it was accepted
    this._validAt = null;     // when the last good (not necessarily accepted) fix arrived
    this._rejects = 0;
  }

  /** `now` is a time in seconds (for example performance.now() / 1000). */
  update(fix, now) {
    if (this._validAt !== null && now - this._validAt > GPS_STALE_TIMEOUT_S) {
      this._speed = null; // signal was lost: start fresh instead of comparing to old data
    }

    if (!GPSFilter._isGood(fix)) return;
    this._validAt = now;
    const speed = fix.speedKmh < NOISE_FLOOR_KMH ? 0.0 : fix.speedKmh;

    if (this._speed !== null) {
      const seconds = Math.max(now - this._acceptedAt, 0.0);
      const change = speed - this._speed;
      const rate = change > 0 ? MAX_ACCEL_KMH_PER_S : MAX_DECEL_KMH_PER_S;
      if (Math.abs(change) > rate * seconds + JUMP_MARGIN_KMH) {
        this._rejects += 1;
        if (this._rejects < JUMP_ACCEPT_AFTER) return; // most likely a glitch: keep the previous speed
      }
    }
    this._speed = speed;
    this._acceptedAt = now;
    this._rejects = 0;
  }

  static _isGood(fix) {
    return fix.valid && (fix.accuracyM === null || fix.accuracyM <= MAX_ACCURACY_M);
  }

  /** The speed to report right now, or no speed and no fix if the data is stale.
   *  `time` is when that speed was measured, so a timer can tell a new reading from a repeat. */
  output(now) {
    if (this._validAt === null || this._speed === null || now - this._validAt > GPS_STALE_TIMEOUT_S) {
      return { speedKmh: null, hasFix: false };
    }
    return { speedKmh: this._speed, hasFix: true, time: this._acceptedAt };
  }
}

/** A browser position as a Fix. The browser reports speed in m/s, or null when it has none. */
function positionToFix(position) {
  const coords = position.coords;
  const speedKmh = typeof coords.speed === "number" ? coords.speed * MS_TO_KMH : null;
  const valid = speedKmh !== null && speedKmh >= 0 && speedKmh <= MAX_PLAUSIBLE_KMH;
  return {
    speedKmh: valid ? speedKmh : 0.0,
    valid,
    accuracyM: typeof coords.accuracy === "number" ? coords.accuracy : null,
  };
}

class GPSReader {
  /** `geolocation` and `clock` (seconds) can be replaced for testing. */
  constructor(geolocation = typeof navigator !== "undefined" ? navigator.geolocation : null,
              clock = () => performance.now() / 1000) {
    this._geolocation = geolocation;
    this._clock = clock;
    this._watchId = null;
    this._filter = new GPSFilter();
    this._connected = false;
    this.lastError = null;
  }

  get connected() {
    return this._connected;
  }

  /** Starts watching the location. Call again to reconnect. Returns at once: the phone asks the
   *  user for permission in the background, and a refusal shows up as `connected` turning false. */
  connect() {
    this.disconnect();
    if (!this._geolocation) {
      this.lastError = "This browser has no location support.";
      return false;
    }
    this._filter = new GPSFilter();
    this.lastError = null;
    this._connected = true;
    this._watchId = this._geolocation.watchPosition(
      (position) => this._filter.update(positionToFix(position), this._clock()),
      (error) => this._onError(error),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
    return true;
  }

  disconnect() {
    if (this._watchId !== null) this._geolocation.clearWatch(this._watchId);
    this._watchId = null;
    this._connected = false;
  }

  read() {
    return this._filter.output(this._clock());
  }

  _onError(error) {
    if (error.code === PERMISSION_DENIED) {
      this.lastError = "Location access was denied. Allow it in the phone's settings.";
      this.disconnect();
    }
    // Other errors (no position yet, timeout) leave the watch running: the GPS is connected
    // but has no fix, which the filter already reports.
  }
}
