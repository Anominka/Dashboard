"use strict";

/* Common data shapes and the poller that feeds live vehicle data to the UI.
 *
 * Any GPS reader or OBD reader (simulated or real) must follow the interfaces
 * described here. The UI only talks to `Telemetry`, so swapping the simulated
 * readers for real ones does not change the screens. (Web counterpart of telemetry.py.)
 *
 * GPS reader interface (see simulated_source.js):
 *     connect() -> bool or Promise<bool>   (may be called again to reconnect)
 *     connected -> bool (property)
 *     read() -> { speedKmh, hasFix, time } (synchronous: returns the latest value; `time` is
 *                                           optional: when the speed was measured, in seconds on the
 *                                           performance.now() clock. A reader that measures
 *                                           continuously leaves it out.)
 *
 * OBD reader interface:
 *     connect() -> bool or Promise<bool>   (may be called again to reconnect)
 *     connected -> bool (property)
 *     read() -> { rpm, coolantC, fuelRateLph, speedKmh }
 *     parameters() -> [{ name, value, unit, supported }]
 *
 * Both readers may also have `lastError` (a message for the user, or null).
 * A value of null means "no value" (for example the car does not report fuel rate).
 *
 * Snapshot (what the screens receive):
 *     time               performance.now() when it was taken, in ms
 *     gpsConnected, gpsFix, obdConnected
 *     gpsState, obdState "connected" | "no_fix" | "disconnected"
 *     gpsError, obdError message for the user, or null
 *     speedKmh           from GPS only (accurate; used for the timers)
 *     speedTimeS         when speedKmh was measured, in seconds (see above); null without a speed
 *     obdSpeedKmh        the car's own speed
 *     bestSpeedKmh       GPS speed, or the car's own speed when GPS has none
 *     rpm, coolantC, fuelRateLph, fuelLPer100km
 *     parameters         list for the Diagnostics page
 */

const CONNECTED = "connected";
const NO_FIX = "no_fix";             // GPS connected, but no trustworthy position fix
const DISCONNECTED = "disconnected";

const POLL_INTERVAL_MS = 100;
const MIN_SPEED_FOR_CONSUMPTION_KMH = 3.0;

/** A reader that is never connected, for a data source that does not exist (yet). */
class NotConnected {
  constructor(message = null) {
    this.connected = false;
    this.lastError = message;
  }

  connect() {
    return false;
  }

  read() {
    return { rpm: null, coolantC: null, fuelRateLph: null, speedKmh: null };
  }

  parameters() {
    return [];
  }
}

class Telemetry {
  constructor(gps, obd) {
    this.gps = gps;
    this.obd = obd;
    this._listeners = [];
    this._timer = null;
  }

  /** Calls `listener(snapshot)` on every update. */
  onUpdate(listener) {
    this._listeners.push(listener);
  }

  async start() {
    await Promise.all([this.gps.connect(), this.obd.connect()]);
    if (this._timer === null) {
      this._timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
    }
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  /** Used by the Settings page Reconnect buttons. `which` is "gps" or "obd". */
  async reconnect(which) {
    return { gps: this.gps, obd: this.obd }[which].connect();
  }

  _poll() {
    const snap = {
      time: performance.now(),
      gpsConnected: this.gps.connected,
      gpsFix: true,
      gpsError: this.gps.lastError || null,
      obdConnected: this.obd.connected,
      obdError: this.obd.lastError || null,
      speedKmh: null,
      speedTimeS: null,
      obdSpeedKmh: null,
      rpm: null,
      coolantC: null,
      fuelRateLph: null,
      fuelLPer100km: null,
      parameters: [],
    };
    if (snap.gpsConnected) {
      const gps = this.gps.read();
      snap.speedKmh = gps.speedKmh;
      snap.speedTimeS = gps.speedKmh === null ? null : gps.time ?? snap.time / 1000;
      snap.gpsFix = gps.hasFix;
    }
    if (snap.obdConnected) {
      const obd = this.obd.read();
      snap.rpm = obd.rpm;
      snap.coolantC = obd.coolantC;
      snap.fuelRateLph = obd.fuelRateLph;
      snap.obdSpeedKmh = obd.speedKmh;
      snap.parameters = this.obd.parameters();
    }

    snap.bestSpeedKmh = snap.speedKmh !== null ? snap.speedKmh : snap.obdSpeedKmh;
    snap.gpsState = !snap.gpsConnected ? DISCONNECTED : snap.gpsFix ? CONNECTED : NO_FIX;
    snap.obdState = snap.obdConnected ? CONNECTED : DISCONNECTED;

    // L/100 km = fuel rate (L/h) / speed (km/h) x 100, only meaningful when moving
    if (
      snap.fuelRateLph !== null &&
      snap.bestSpeedKmh !== null &&
      snap.bestSpeedKmh >= MIN_SPEED_FOR_CONSUMPTION_KMH
    ) {
      snap.fuelLPer100km = (snap.fuelRateLph / snap.bestSpeedKmh) * 100;
    }

    for (const listener of this._listeners) listener(snap);
  }
}
