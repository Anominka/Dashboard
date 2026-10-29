"use strict";

/* Reads the phone's motion sensor (accelerometer) to sharpen the acceleration timers.
 *
 * GPS gives one speed a second. Between two readings the sensor shows *when* the car speeded
 * up, for example the instant it left a standstill or the dip of a gear change. The timers still
 * take the speeds from GPS; the sensor only decides where inside the second a speed was crossed
 * (see `crossingTime`), and it is ignored whenever it looks unreliable.
 *
 * Assumption: the phone stands upright in portrait with its screen facing the driver, as on a
 * dashboard stand. Then the car's forward direction is the screen's normal pointing away from the
 * driver, flattened onto the horizontal plane (so the tilt of the stand does not matter). It does
 * not need to know which way the phone reports gravity: only the ratio of accelerations is used.
 */

const MOTION_GRAVITY_TAU_S = 1.0;     // gravity direction is smoothed over about this long
const MOTION_KEEP_S = 4.0;            // how much sensor history is kept
const MOTION_MAX_GAP_S = 0.25;        // a longer pause in the sensor data inside an interval: not usable
const MOTION_EDGE_S = 0.25;           // the data must reach this close to both ends of the interval
const MOTION_MIN_INTERVAL_S = 0.3;    // intervals between GPS readings outside this range: not usable
const MOTION_MAX_INTERVAL_S = 2.5;
const MOTION_MIN_SCALE = 0.4;         // the sensor's total speed change, relative to GPS's, must lie in
const MOTION_MAX_SCALE = 2.5;         //   this range (also catches a wrong forward direction)
const MOTION_SHAPE_SLACK = 0.15;      // the speed curve may overshoot 0..1 by this much (noise)
const MOTION_STALE_S = 1.5;           // no sensor data for this long: it counts as not delivering

class MotionSensor {
  /** `target` (where "devicemotion" events come from) and `clock` (seconds) can be replaced for testing. */
  constructor({ target = typeof window !== "undefined" ? window : null, clock = () => performance.now() / 1000 } = {}) {
    this._target = target;
    this._clock = clock;
    this._listening = false;
    this._denied = false;
    this._handler = (event) => this.handleMotion(event, this._clock());
    this._reset();
    this.supported = typeof DeviceMotionEvent !== "undefined" && target !== null;
  }

  _reset() {
    this._gravity = null;     // smoothed gravity vector in the phone's own axes
    this._lastTime = null;
    this._samples = [];       // [time, forward acceleration in m/s2]
    this.rateHz = 0;
    this.forward = 0;         // latest forward acceleration, m/s2 (sign depends on the phone), for display
    this.lastEventAt = null;
  }

  /** Starts listening. On iPhone this asks the user for permission, so call it from a tap. */
  async enable() {
    if (!this.supported) return false;
    if (this._listening) return true;
    this._denied = false;
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      let answer = "denied";
      try {
        answer = await DeviceMotionEvent.requestPermission();
      } catch (error) {
        answer = "denied";
      }
      if (answer !== "granted") {
        this._denied = true;
        return false;
      }
    }
    this._reset();
    this._target.addEventListener("devicemotion", this._handler);
    this._listening = true;
    return true;
  }

  disable() {
    if (this._listening) this._target.removeEventListener("devicemotion", this._handler);
    this._listening = false;
    this._denied = false;
    this._reset();
  }

  /** True while sensor data is arriving. */
  get delivering() {
    return this._listening && this.lastEventAt !== null && this._clock() - this.lastEventAt <= MOTION_STALE_S;
  }

  /** What to tell the user (see the Settings page). `wanted` is whether the user switched it on. */
  message(wanted) {
    if (!this.supported) return "Not available in this browser.";
    if (this._denied) return "Denied. To be asked again, close the app completely and open it again.";
    if (!wanted) return "Off. Turn it on for sharper acceleration timing.";
    if (!this._listening) return "On. It starts when you open Performance; the phone asks permission then.";
    if (!this.delivering) return "Allowed, but no motion data is arriving.";
    return `On: ${Math.round(this.rateHz)} readings a second, forward ${this.forward.toFixed(1)} m/s². Used for the acceleration timers.`;
  }

  /** Takes one "devicemotion" event. `now` is the time it arrived, in seconds. */
  handleMotion(event, now) {
    const withGravity = event.accelerationIncludingGravity;
    if (!withGravity || ![withGravity.x, withGravity.y, withGravity.z].every(Number.isFinite)) return;
    const own = event.acceleration;
    const hasOwn = own && [own.x, own.y, own.z].every(Number.isFinite);

    const dt = this._lastTime === null ? 0 : Math.max(now - this._lastTime, 1e-3);
    if (dt > 0) this.rateHz = this.rateHz === 0 ? 1 / dt : this.rateHz * 0.9 + (1 / dt) * 0.1;

    // Gravity: what the sensor feels minus the car's own acceleration, when the phone says it.
    // Otherwise it is the slowly smoothed total, which leaves the quick changes as acceleration.
    const rawGravity = hasOwn
      ? [withGravity.x - own.x, withGravity.y - own.y, withGravity.z - own.z]
      : [withGravity.x, withGravity.y, withGravity.z];
    if (this._gravity === null) {
      this._gravity = rawGravity;
    } else {
      const alpha = dt / (MOTION_GRAVITY_TAU_S + dt);
      this._gravity = this._gravity.map((g, i) => g + alpha * (rawGravity[i] - g));
    }
    this._lastTime = now;
    this.lastEventAt = now;

    const own3 = hasOwn
      ? [own.x, own.y, own.z]
      : [withGravity.x - this._gravity[0], withGravity.y - this._gravity[1], withGravity.z - this._gravity[2]];

    const forward = MotionSensor.forwardAxis(this._gravity);
    if (forward === null) return;
    const value = own3[0] * forward[0] + own3[1] * forward[1] + own3[2] * forward[2];
    this.forward = this.forward * 0.8 + value * 0.2;
    this._samples.push([now, value]);
    while (this._samples.length && now - this._samples[0][0] > MOTION_KEEP_S) this._samples.shift();
  }

  /** The car's forward direction in the phone's axes: the screen normal pointing away from the
   *  driver (the phone's -z axis), flattened onto the horizontal plane. Null if gravity is unknown. */
  static forwardAxis(gravity) {
    const size = Math.hypot(...gravity);
    if (size < 3) return null; // not a believable gravity reading
    const down = gravity.map((g) => g / size);
    const away = [0, 0, -1];
    const along = away[0] * down[0] + away[1] * down[1] + away[2] * down[2];
    const flat = away.map((a, i) => a - along * down[i]);
    const length = Math.hypot(...flat);
    return length < 0.3 ? null : flat.map((a) => a / length); // phone lying flat: no forward direction
  }

  /**
   * When, between two GPS readings, did the speed reach `fraction` (0 to 1, exclusive) of the change
   * between them? `t0` and `t1` are the times of the two readings and `deltaKmh` the speed change.
   * Returns a time between them, or null when the sensor data cannot be trusted, in which case the
   * caller should assume constant acceleration.
   */
  crossingTime(fraction, t0, t1, deltaKmh) {
    const span = t1 - t0;
    if (!(fraction > 0 && fraction < 1) || span < MOTION_MIN_INTERVAL_S || span > MOTION_MAX_INTERVAL_S) return null;

    const samples = this._samples.filter(([t]) => t >= t0 && t <= t1);
    if (samples.length < 3) return null;
    if (samples[0][0] - t0 > MOTION_EDGE_S || t1 - samples[samples.length - 1][0] > MOTION_EDGE_S) return null;

    // speed change since the first sample, by the sensor (trapezoid rule)
    const speeds = [0];
    for (let i = 1; i < samples.length; i++) {
      const gap = samples[i][0] - samples[i - 1][0];
      if (gap > MOTION_MAX_GAP_S) return null;
      speeds.push(speeds[i - 1] + 0.5 * (samples[i][1] + samples[i - 1][1]) * gap);
    }

    const total = speeds[speeds.length - 1];
    const gpsChange = Math.abs(deltaKmh) / 3.6; // m/s
    const scale = Math.abs(total) / gpsChange;
    if (!(scale >= MOTION_MIN_SCALE && scale <= MOTION_MAX_SCALE)) return null;

    // progress 0..1 of the speed change; the sign of the sensor cancels out here
    const progress = speeds.map((s) => s / total);
    if (progress.some((p) => p < -MOTION_SHAPE_SLACK || p > 1 + MOTION_SHAPE_SLACK)) return null;

    for (let i = 0; i < progress.length; i++) {
      if (progress[i] >= fraction) {
        if (i === 0) return samples[0][0];
        const before = progress[i - 1];
        const share = (fraction - before) / (progress[i] - before);
        return samples[i - 1][0] + share * (samples[i][0] - samples[i - 1][0]);
      }
    }
    return null;
  }
}
