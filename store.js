"use strict";

/* Where finished trips, Performance runs, settings and the running trip's backup are kept.
 *
 * MemoryStore keeps everything in memory (optionally with sample trips, for ?demo).
 * PersistentStore is the same thing, written through to IndexedDB on the phone, so the
 * data survives closing the app. Both follow the same interface; the pages only read
 * from memory, which is loaded once when the app starts.
 */

const PERIOD_DAYS = { week: 7, month: 30, all: null };
const BACKUP_VERSION = 1;

// [days ago, km, minutes, L/100 km, score], the same sample trips as trip_database.py
const SAMPLE_TRIPS = [
  [70, 14.2, 24, 7.0, 72], [45, 36.4, 52, 6.0, 89], [33, 9.9, 18, 7.5, 66],
  [20, 27.3, 41, 6.3, 84], [13, 18.6, 30, 6.8, 77], [9, 42.0, 58, 5.9, 91],
  [6, 5.1, 11, 7.8, 64], [4, 15.3, 27, 6.6, 79], [3, 24.7, 38, 6.1, 88],
  [2, 8.2, 15, 7.2, 69], [1, 31.0, 46, 6.9, 74], [0, 12.4, 21, 6.4, 82],
];

/** A Date as "YYYY-MM-DD" in local time, and back. */
function dayToText(day) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

function textToDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(day.getTime()) ? null : day;
}

class MemoryStore {
  constructor({ sampleTrips = false } = {}) {
    this._trips = []; // oldest first
    this._runs = [];  // newest first
    this._currentTrip = null;
    this.settings = { theme: "night", brightness: 100, motion: false };
    this.persistent = false;
    this.statusText = "Not saved: the data is lost when the page closes.";
    if (sampleTrips) this._seedSampleTrips();
  }

  _seedSampleTrips() {
    const today = startOfToday();
    for (const [ago, km, minutes, l100, score] of SAMPLE_TRIPS) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ago);
      this.addTrip({ day, distanceKm: km, durationS: minutes * 60, lPer100km: l100, score });
    }
  }

  // --- trips ---

  addTrip(trip) {
    this._trips.push(trip);
  }

  /** Trips newest first. `period` is "week", "month" or "all". */
  trips(period = "all") {
    const days = PERIOD_DAYS[period];
    const today = startOfToday();
    const cutoff = days === null ? null : new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
    return this._trips
      .map((trip, index) => ({ trip, index }))
      .filter(({ trip }) => cutoff === null || trip.day > cutoff)
      .sort((a, b) => b.trip.day - a.trip.day || b.index - a.index)
      .map(({ trip }) => trip);
  }

  /** The driver's usual L/100 km: average of the last `count` saved trips with fuel data.
   *  null until there are at least `minimum` such trips. */
  referenceConsumption(count = 10, minimum = 3) {
    const values = this.trips("all")
      .map((trip) => trip.lPer100km)
      .filter((value) => value !== null)
      .slice(0, count);
    if (values.length < minimum) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  // --- Performance runs ---

  addRun(run) {
    this._runs.unshift(run);
  }

  recentRuns(count) {
    return this._runs.slice(0, count);
  }

  bestTimes() {
    const best = {};
    for (const run of this._runs) {
      if (best[run.targetKmh] === undefined || run.seconds < best[run.targetKmh]) {
        best[run.targetKmh] = run.seconds;
      }
    }
    return best;
  }

  clearRuns() {
    this._runs = [];
  }

  // --- settings: change `this.settings`, then call saveSettings() ---

  saveSettings() {}

  // --- backup of the trip in progress (survives the page being closed by the system) ---

  /** Stores the running trip's progress (a plain object), replacing the previous backup. */
  saveCurrentTrip(state) {
    this._currentTrip = state;
  }

  /** The backed-up trip's progress, or null if there is no backup. */
  loadCurrentTrip() {
    return this._currentTrip;
  }

  clearCurrentTrip() {
    this._currentTrip = null;
  }

  // --- backup file ---

  /** Everything as plain data that can be written to a JSON file. */
  exportData() {
    return {
      app: "dashboard",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: { ...this.settings },
      trips: this._trips.map((trip) => ({
        day: dayToText(trip.day),
        distanceKm: trip.distanceKm,
        durationS: trip.durationS,
        lPer100km: trip.lPer100km,
        score: trip.score,
      })),
      runs: this._runs.map((run) => ({
        targetKmh: run.targetKmh,
        seconds: run.seconds,
        finishedAt: run.finishedAt.toISOString(),
      })),
    };
  }

  /** Checks a parsed backup file. Returns {trips, runs, settings} ready to load, or throws an Error
   *  with a message for the user. */
  static parseBackup(data) {
    const fail = (why) => { throw new Error("This is not a valid backup file (" + why + ")."); };
    if (!data || data.app !== "dashboard") fail("wrong file");
    if (data.version !== BACKUP_VERSION) fail("unknown version");
    if (!Array.isArray(data.trips) || !Array.isArray(data.runs)) fail("missing data");

    const finite = (value) => typeof value === "number" && Number.isFinite(value);
    const trips = data.trips.map((t) => {
      const day = textToDay(t && t.day);
      const okConsumption = t && (t.lPer100km === null || finite(t.lPer100km));
      if (!day || !finite(t.distanceKm) || !finite(t.durationS) || !okConsumption || !Number.isInteger(t.score)) {
        fail("a trip is damaged");
      }
      return { day, distanceKm: t.distanceKm, durationS: t.durationS, lPer100km: t.lPer100km, score: t.score };
    });
    const runs = data.runs.map((r) => {
      const finishedAt = new Date(r && r.finishedAt);
      if (!r || !TARGETS_KMH.includes(r.targetKmh) || !finite(r.seconds) || Number.isNaN(finishedAt.getTime())) {
        fail("a run is damaged");
      }
      return { targetKmh: r.targetKmh, seconds: r.seconds, finishedAt };
    });
    const s = data.settings || {};
    const settings = {
      theme: s.theme === "day" ? "day" : "night",
      brightness: finite(s.brightness) ? Math.max(10, Math.min(100, Math.round(s.brightness))) : 100,
      motion: s.motion === true,
    };
    return { trips, runs, settings };
  }

  /** Replaces all trips, runs and settings with a parsed backup (see parseBackup). */
  async importData({ trips, runs, settings }) {
    this._trips = trips;
    this._runs = runs;
    Object.assign(this.settings, settings);
    await this._rewriteAll();
  }

  async _rewriteAll() {}
}

// --- IndexedDB ---

const DB_NAME = "dashboard";
const DB_VERSION = 1;
const CURRENT_TRIP_KEY = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("trips", { autoIncrement: true });
      db.createObjectStore("runs", { autoIncrement: true });
      db.createObjectStore("settings");      // key: setting name
      db.createObjectStore("current_trip");  // key: CURRENT_TRIP_KEY
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("the database is blocked by another tab"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

class PersistentStore extends MemoryStore {
  constructor(db) {
    super();
    this._db = db;
    this.persistent = true;
    this.writeFailed = false;
  }

  /** Opens the database and loads everything into memory. Rejects if the phone won't allow storage. */
  static async open() {
    const store = new PersistentStore(await openDatabase());
    await store._load();

    // Ask the browser not to clear this data when the phone is short on space.
    let protectedStorage = false;
    try {
      protectedStorage = !!(navigator.storage && navigator.storage.persist && (await navigator.storage.persist()));
    } catch (error) {
      protectedStorage = false;
    }
    store.statusText = protectedStorage
      ? "Saved on this phone."
      : "Saved on this phone, but the browser may clear it. Add the app to the Home Screen and keep a backup.";
    return store;
  }

  async _load() {
    const read = (name) => requestResult(this._db.transaction(name).objectStore(name).getAll());
    const setting = (name) => requestResult(this._db.transaction("settings").objectStore("settings").get(name));
    const [trips, runs, theme, brightness, motion, current] = await Promise.all([
      read("trips"),
      read("runs"),
      setting("theme"),
      setting("brightness"),
      setting("motion"),
      requestResult(this._db.transaction("current_trip").objectStore("current_trip").get(CURRENT_TRIP_KEY)),
    ]);
    this._trips = trips;
    this._runs = runs.reverse(); // stored oldest first; kept newest first
    if (theme === "day" || theme === "night") this.settings.theme = theme;
    if (Number.isFinite(brightness)) this.settings.brightness = Math.max(10, Math.min(100, brightness));
    this.settings.motion = motion === true;
    this._currentTrip = current === undefined ? null : current;
  }

  /** Runs `work(objectStore...)` in one write transaction; resolves when it is stored. Never rejects:
   *  a failed write is remembered in `writeFailed` and logged. */
  _write(storeNames, work) {
    return new Promise((resolve) => {
      try {
        const tx = this._db.transaction(storeNames, "readwrite");
        work(...[].concat(storeNames).map((name) => tx.objectStore(name)));
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => {
          this.writeFailed = true;
          console.error("Could not save to the phone's storage", tx.error);
          resolve();
        };
      } catch (error) {
        this.writeFailed = true;
        console.error("Could not save to the phone's storage", error);
        resolve();
      }
    });
  }

  addTrip(trip) {
    super.addTrip(trip);
    this._write("trips", (trips) => trips.add(trip));
  }

  addRun(run) {
    super.addRun(run);
    this._write("runs", (runs) => runs.add(run));
  }

  clearRuns() {
    super.clearRuns();
    this._write("runs", (runs) => runs.clear());
  }

  saveSettings() {
    this._write("settings", (settings) => {
      settings.put(this.settings.theme, "theme");
      settings.put(this.settings.brightness, "brightness");
      settings.put(this.settings.motion, "motion");
    });
  }

  saveCurrentTrip(state) {
    super.saveCurrentTrip(state);
    this._write("current_trip", (current) => current.put(state, CURRENT_TRIP_KEY));
  }

  clearCurrentTrip() {
    super.clearCurrentTrip();
    this._write("current_trip", (current) => current.clear());
  }

  async _rewriteAll() {
    await this._write(["trips", "runs", "settings"], (trips, runs, settings) => {
      trips.clear();
      runs.clear();
      for (const trip of this._trips) trips.add(trip);
      for (const run of [...this._runs].reverse()) runs.add(run); // oldest first
      settings.put(this.settings.theme, "theme");
      settings.put(this.settings.brightness, "brightness");
      settings.put(this.settings.motion, "motion");
    });
  }
}
