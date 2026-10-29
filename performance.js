"use strict";

/* Acceleration timing (0-50 and 0-100 km/h) from the live speed.
 *
 * For safe, legal conditions only. Also holds the trip efficiency score formula.
 * Web counterpart of performance.py.
 */

const TARGETS_KMH = [50, 100]; // ascending
const STOPPED_KMH = 1.0;       // at or below this the car counts as stopped
const ARM_HOLD_S = 1.0;        // the car must stay stopped this long before the timers arm
const MAX_RUN_ACCEL_KMH_PER_S = 40.0; // a run implying faster acceleration is discarded (~11 m/s2)
const MAX_RECENT_RUNS = 20;

const WAITING = "waiting";   // moving, or a run just finished: needs a stop to arm
const ARMED = "armed";       // stopped, timers ready
const RUNNING = "running";   // accelerating, timers counting
const FINISHED = "finished"; // all targets reached, needs a stop to arm again

/** `now` is a time in seconds (for example performance.now() / 1000). */
class AccelerationTimer {
  /** `recentRuns` (newest first, {targetKmh, seconds, finishedAt}) and `best` ({km/h: seconds}) restore saved data.
   *  `onRun` is called with each new run so it can be stored. */
  constructor({ recentRuns = [], best = {}, onRun = null } = {}) {
    this.state = WAITING;
    this.onRun = onRun;
    this.shape = null; // optional: an object with crossingTime(fraction, t0, t1, deltaKmh), see motion.js
    this.results = this._emptyResults(); // last run's times
    this.best = {};
    for (const target of TARGETS_KMH) this.best[target] = best[target] ?? null;
    this.recentRuns = recentRuns
      .filter((run) => TARGETS_KMH.includes(run.targetKmh))
      .slice(0, MAX_RECENT_RUNS); // newest first
    this.elapsedS = 0.0; // live time of the run in progress
    this._startTime = null;
    this._stoppedSince = null;
    this._prevSpeed = null;
    this._prevTime = null;
    this._lastReadingTime = null;
  }

  _emptyResults() {
    const results = {};
    for (const target of TARGETS_KMH) results[target] = null;
    return results;
  }

  /** Feed one speed reading. */
  update(speedKmh, now) {
    if (speedKmh === null) {
      this.state = WAITING;
      this._stoppedSince = null;
      this._prevSpeed = this._prevTime = null;
      return;
    }

    const prevSpeed = this._prevSpeed;
    const prevTime = this._prevTime;
    this._prevSpeed = speedKmh;
    this._prevTime = now;

    if (this.state === WAITING || this.state === FINISHED) {
      if (speedKmh > STOPPED_KMH) {
        this._stoppedSince = null;
      } else {
        if (this._stoppedSince === null) this._stoppedSince = now;
        if (now - this._stoppedSince >= ARM_HOLD_S) { // a single 0 reading is not a stop
          this.state = ARMED;
        }
      }
    } else if (this.state === ARMED) {
      if (speedKmh > STOPPED_KMH) this._startRun(speedKmh, now, prevSpeed, prevTime);
    } else if (this.state === RUNNING) {
      if (speedKmh <= STOPPED_KMH) { // stopped again: end the run, keep what was reached
        this.state = ARMED;
        return;
      }
      this.elapsedS = now - this._startTime;
      for (const target of TARGETS_KMH) {
        if (this.results[target] === null && speedKmh >= target) {
          const crossing = this._crossingTime(target, speedKmh, now, prevSpeed, prevTime);
          if (!this._record(target, crossing)) { // impossible time: a GPS glitch
            this.state = WAITING;
            return;
          }
        }
      }
      if (TARGETS_KMH.every((t) => this.results[t] !== null)) this.state = FINISHED;
    }
  }

  /** Feeds the speed from a telemetry snapshot. Every new reading is timed at the moment it was
   *  measured and a repeat of the same reading is skipped, so with a GPS that gives one reading a
   *  second the crossing times are still interpolated between readings, not rounded to the next one. */
  updateFromSnapshot(snap) {
    if (snap.speedKmh === null) {
      this._lastReadingTime = null;
      this.update(null, snap.time / 1000);
    } else if (snap.speedTimeS !== this._lastReadingTime) {
      this._lastReadingTime = snap.speedTimeS;
      this.update(snap.speedKmh, snap.speedTimeS);
    }
  }

  /** Forget all runs, best times and the last results. A run in progress is abandoned. */
  clear() {
    if (this.state === RUNNING) this.state = WAITING; // needs a stop to arm again
    this.recentRuns = [];
    for (const target of TARGETS_KMH) this.best[target] = null;
    this.results = this._emptyResults();
  }

  _startRun(speedKmh, now, prevSpeed, prevTime) {
    this._startTime = this._crossingTime(STOPPED_KMH, speedKmh, now, prevSpeed, prevTime);
    this.results = this._emptyResults();
    this.elapsedS = now - this._startTime;
    this.state = RUNNING;
  }

  /** Stores a finished run. Returns false (storing nothing) if the time is not believable. */
  _record(target, crossingTime) {
    const seconds = crossingTime - this._startTime;
    if (seconds <= 0 || target / seconds > MAX_RUN_ACCEL_KMH_PER_S) return false;
    this.results[target] = seconds;
    const best = this.best[target];
    if (best === null || seconds < best) this.best[target] = seconds;
    const run = { targetKmh: target, seconds, finishedAt: new Date() };
    this.recentRuns.unshift(run);
    this.recentRuns.length = Math.min(this.recentRuns.length, MAX_RECENT_RUNS);
    if (this.onRun) this.onRun(run);
    return true;
  }

  /** Time at which the speed crossed `level`, interpolated between two readings. With `shape` (the
   *  motion sensor) the crossing is placed where the sensor says the speed was gained; without it,
   *  or when the sensor is not trustworthy, the acceleration is assumed constant between readings. */
  _crossingTime(level, speed, now, prevSpeed, prevTime) {
    if (prevSpeed === null || speed === prevSpeed) return now;
    const fraction = Math.max(0, Math.min(1, (level - prevSpeed) / (speed - prevSpeed)));
    if (this.shape && fraction > 0 && fraction < 1) {
      const time = this.shape.crossingTime(fraction, prevTime, now, speed - prevSpeed);
      if (time !== null) return time;
    }
    return prevTime + (now - prevTime) * fraction;
  }

  /** Finished time, else the live time while running, else null. */
  displaySeconds(target) {
    if (this.results[target] !== null) return this.results[target];
    if (this.state === RUNNING) return this.elapsedS;
    return null;
  }
}

// --- Efficiency score -------------------------------------------------------
// Out of 100. Made of up to three parts, each scored 0-100 and averaged with the
// weights below. The consumption part only counts when fuel data and a reference
// exist; otherwise the remaining weights are re-scaled. All numbers are first
// guesses to be tuned after real drives.

const HARSH_ACCEL_KMH_PER_S = 6.0;   // accelerating faster than this counts as harsh (~1.7 m/s2)
const HARSH_BRAKE_KMH_PER_S = -8.0;  // braking harder than this counts as harsh (~2.2 m/s2)
const ACCEL_SHARE_BAD = 0.15;        // this share of moving time spent accelerating hard gives 0 points
const BRAKE_SHARE_BAD = 0.15;        // same for braking
const CONSUMPTION_GOOD_RATIO = 0.85; // at or below 85% of your usual consumption gives 100 points
const CONSUMPTION_BAD_RATIO = 1.30;  // at or above 130% of your usual consumption gives 0 points
const MIN_DISTANCE_FOR_CONSUMPTION_KM = 1.0; // consumption is too noisy over shorter distances
const SCORE_WEIGHTS = { accel: 0.35, brake: 0.35, consumption: 0.30 };

function sharePoints(share, badShare) {
  return 100 * (1 - Math.min(1, share / badShare));
}

/** Efficiency score 0-100 for a trip so far.
 *
 * movingS: seconds spent moving; harshAccelS / harshBrakeS: seconds of harsh acceleration / braking;
 * consumptionL100: the trip's average consumption, if known;
 * referenceL100: the driver's usual consumption from past trips, if known.
 */
function efficiencyScore(movingS, harshAccelS, harshBrakeS, distanceKm = 0, consumptionL100 = null, referenceL100 = null) {
  if (movingS < 1) return 100;

  const parts = {
    accel: sharePoints(harshAccelS / movingS, ACCEL_SHARE_BAD),
    brake: sharePoints(harshBrakeS / movingS, BRAKE_SHARE_BAD),
  };
  if (consumptionL100 !== null && referenceL100 && distanceKm >= MIN_DISTANCE_FOR_CONSUMPTION_KM) {
    const ratio = consumptionL100 / referenceL100;
    const position = (ratio - CONSUMPTION_GOOD_RATIO) / (CONSUMPTION_BAD_RATIO - CONSUMPTION_GOOD_RATIO);
    parts.consumption = 100 * (1 - Math.max(0, Math.min(1, position)));
  }

  let totalWeight = 0;
  let weighted = 0;
  for (const [name, points] of Object.entries(parts)) {
    totalWeight += SCORE_WEIGHTS[name];
    weighted += SCORE_WEIGHTS[name] * points;
  }
  return Math.max(0, Math.min(100, Math.round(weighted / totalWeight)));
}
