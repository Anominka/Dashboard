"use strict";

/* Simulated GPS and OBD readers with fake driving data.
 *
 * They follow the same interface as the real readers will (see telemetry.js),
 * so the real ones can replace them without changing the screens.
 * Web counterpart of simulated_source.py; same numbers.
 */

// [seconds, km/h] waypoints of one repeating drive: stop, accelerate to 120 (so the
// 0-50 and 0-100 timers both complete), slow down, speed up again, brake to a stop.
// Speeds are smoothed between points.
const DRIVE_CYCLE = [
  [0, 0], [4, 0], [20, 120], [28, 120], [40, 60], [46, 60],
  [58, 100], [64, 100], [74, 30], [84, 0], [88, 0],
];
const CYCLE_LENGTH_S = DRIVE_CYCLE[DRIVE_CYCLE.length - 1][0];

const IDLE_RPM = 850;
// [upper speed limit km/h, rpm per km/h] for each gear
const GEARS = [[15, 90], [30, 55], [45, 38], [65, 28], [9999, 22]];

const COOLANT_START_C = 60;
const COOLANT_RUNNING_C = 90;
const COOLANT_WARMUP_S = 60;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/** Fake vehicle state as a function of time since it was created. */
class DriveSimulator {
  constructor() {
    this._t0 = performance.now();
  }

  elapsed() {
    return (performance.now() - this._t0) / 1000;
  }

  speedAt(t) {
    t = ((t % CYCLE_LENGTH_S) + CYCLE_LENGTH_S) % CYCLE_LENGTH_S;
    for (let i = 0; i < DRIVE_CYCLE.length - 1; i++) {
      const [t0, v0] = DRIVE_CYCLE[i];
      const [t1, v1] = DRIVE_CYCLE[i + 1];
      if (t0 <= t && t <= t1) {
        let x = (t - t0) / (t1 - t0);
        x = x * x * (3 - 2 * x); // smoothstep: gentle start and end
        return v0 + (v1 - v0) * x;
      }
    }
    return 0;
  }

  /** Returns speed (km/h), acceleration (km/h per s), rpm, coolant, fuel rate (L/h). */
  state() {
    const t = this.elapsed();
    const speed = this.speedAt(t);
    const accel = (speed - this.speedAt(t - 0.2)) / 0.2;

    const rpmPerKmh = GEARS.find(([limit]) => speed < limit)[1];
    const rpm = Math.max(IDLE_RPM, speed * rpmPerKmh) + (Math.random() * 30 - 15);

    const coolant =
      COOLANT_START_C +
      (COOLANT_RUNNING_C - COOLANT_START_C) * Math.min(1, t / COOLANT_WARMUP_S);
    const fuelRate = 0.6 + (rpm / 1000) * 0.6 + Math.max(accel, 0) * 0.35 + speed * 0.02;
    return { speed, accel, rpm, coolant, fuelRate };
  }
}

class SimulatedGPS {
  constructor(simulator = new DriveSimulator()) {
    this.sim = simulator;
    this.connected = false;
  }

  connect() {
    this.connected = true;
    return true;
  }

  read() {
    return { speedKmh: this.sim.state().speed, hasFix: true };
  }
}

class SimulatedOBD {
  constructor(simulator = new DriveSimulator(), fuelRateSupported = true) {
    this.sim = simulator;
    this.fuelRateSupported = fuelRateSupported;
    this.connected = false;
  }

  connect() {
    this.connected = true;
    return true;
  }

  read() {
    const { speed, rpm, coolant, fuelRate } = this.sim.state();
    return {
      rpm,
      coolantC: coolant,
      fuelRateLph: this.fuelRateSupported ? fuelRate : null,
      speedKmh: speed,
    };
  }

  parameters() {
    const { speed, accel, rpm, coolant, fuelRate } = this.sim.state();
    const throttle = clamp(12 + accel * 6 + speed * 0.1, 0, 100);
    return [
      { name: "Engine RPM", value: rpm, unit: "rpm", supported: true },
      { name: "Vehicle speed", value: speed, unit: "km/h", supported: true },
      { name: "Coolant temperature", value: coolant, unit: "°C", supported: true },
      { name: "Throttle position", value: throttle, unit: "%", supported: true },
      { name: "Engine load", value: clamp(20 + accel * 7 + speed * 0.2, 0, 100), unit: "%", supported: true },
      { name: "Intake air temperature", value: 28.0, unit: "°C", supported: true },
      {
        name: "Fuel rate",
        value: this.fuelRateSupported ? fuelRate : null,
        unit: "L/h",
        supported: this.fuelRateSupported,
      },
      { name: "Oil temperature", value: null, unit: "°C", supported: false },
      { name: "Ambient air temperature", value: null, unit: "°C", supported: false },
    ];
  }
}
