"use strict";

const PAGES = ["live", "performance", "trip", "history", "diagnostics", "settings"];

const AUTOSAVE_INTERVAL_MS = 10_000;
const RECOVERED_MESSAGE = "A trip from last time was not ended; it was saved to History.";
const RECOVERED_MESSAGE_MS = 30_000;

/** The phone's storage, or sample data with ?demo, or memory only if the browser refuses storage. */
async function openStore() {
  if (new URLSearchParams(location.search).has("demo")) {
    const store = new MemoryStore({ sampleTrips: true });
    store.statusText = "Demo data: nothing is saved.";
    return store;
  }
  try {
    return await PersistentStore.open();
  } catch (error) {
    console.error("Storage unavailable", error);
    const store = new MemoryStore();
    store.statusText = "Not saved: this browser does not allow storage (private browsing?). Use Export to keep your data.";
    return store;
  }
}

/** Turns a backed-up trip left by a closed page into a History entry. Returns true if one was recovered. */
function recoverLeftoverTrip(store) {
  const state = store.loadCurrentTrip();
  if (state === null) return false;
  const leftover = new TripTracker();
  leftover.restore(state);
  const record = leftover.toRecord();
  if (record !== null) store.addTrip(record);
  store.clearCurrentTrip();
  return record !== null;
}

async function main() {
  fitToScreen();
  for (const name of ["resize", "orientationchange", "pageshow"]) window.addEventListener(name, fitToScreen);
  const store = await openStore();
  const recovered = recoverLeftoverTrip(store);

  // Normally the phone's own GPS. There is no OBD reader yet, so OBD stays "not connected".
  // With ?sim both are simulated: one fake vehicle shared by the GPS and OBD readers.
  let gps, obd;
  const simulated = new URLSearchParams(location.search).has("sim");
  if (simulated) {
    const simulator = new DriveSimulator();
    gps = new SimulatedGPS(simulator);
    obd = new SimulatedOBD(simulator);
  } else {
    gps = new GPSReader();
    obd = new NotConnected();
  }
  const telemetry = new Telemetry(gps, obd);
  const trip = new TripTracker();
  trip.referenceL100 = store.referenceConsumption();

  const wakeLock = new ScreenWakeLock();
  const motion = new MotionSensor();

  const applyTheme = (name) => {
    document.documentElement.dataset.theme = name;
    // the browser's own bars (where there are any) follow the app's background
    const background = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
    document.querySelector('meta[name="theme-color"]').setAttribute("content", background);
  };
  // The page can't change the phone's real brightness, so this dims the app with a black layer.
  const applyBrightness = (percent) => {
    document.getElementById("dim").style.opacity = String(1 - percent / 100);
  };

  const context = { telemetry, store, trip, wakeLock, motion, onThemeChange: applyTheme, onBrightnessChange: applyBrightness };
  const pages = {
    live: new LivePage(document.getElementById("page-live"), context),
    performance: new PerformancePage(document.getElementById("page-performance"), context),
    trip: new TripPage(document.getElementById("page-trip"), context),
    history: new HistoryPage(document.getElementById("page-history"), context),
    diagnostics: new DiagnosticsPage(document.getElementById("page-diagnostics"), context),
    settings: new SettingsPage(document.getElementById("page-settings"), context),
  };

  // The motion sensor places the timers' crossings inside a GPS second. It belongs to the real GPS
  // only: the simulated drive has no matching phone motion.
  if (!simulated) pages.performance.timer.shape = motion;
  // The phone asks for motion permission after every launch of the app, so ask only when it matters:
  // the first time the Performance page is opened (a tap, which the phone requires). Once per launch.
  let motionAsked = false;
  function startMotionIfWanted() {
    if (motionAsked || !store.settings.motion) return;
    motionAsked = true;
    motion.enable();
  }

  let activePage = "live";
  let lastSnapshot = null;

  function showPage(name) {
    if (!PAGES.includes(name)) name = "live";
    activePage = name;
    for (const page of PAGES) {
      document.getElementById("page-" + page).classList.toggle("active", page === name);
    }
    for (const button of document.querySelectorAll("#nav button")) {
      button.classList.toggle("active", button.dataset.page === name);
    }
    document.getElementById("page-title").textContent =
      document.getElementById("page-" + name).dataset.title;
    if (pages[name].show) pages[name].show();
    if (lastSnapshot) pages[name].update(lastSnapshot);
  }

  // Status dots: "connected", "no_fix" (GPS connected, no fix) or "disconnected".
  function setStatus(dotId, state) {
    const dot = document.getElementById(dotId);
    dot.classList.toggle("connected", state === CONNECTED);
    dot.classList.toggle("warning", state === NO_FIX);
  }

  telemetry.onUpdate((snap) => {
    lastSnapshot = snap;
    setStatus("gps-dot", snap.gpsState);
    setStatus("obd-dot", snap.obdState);

    // The trip and the acceleration timers keep running whichever page is open.
    trip.update(snap);
    pages.performance.timer.updateFromSnapshot(snap);
    pages[activePage].update(snap);
  });

  document.getElementById("nav").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.page === "performance") startMotionIfWanted();
    showPage(button.dataset.page);
  });

  // Back up the running trip regularly, and whenever the page is hidden: the phone can
  // close a page in the background without warning.
  function autosaveTrip() {
    if (trip.elapsedS > 0) store.saveCurrentTrip(trip.toState());
    else store.clearCurrentTrip();
  }
  setInterval(autosaveTrip, AUTOSAVE_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") autosaveTrip();
  });
  window.addEventListener("pagehide", autosaveTrip);

  applyTheme(store.settings.theme);
  applyBrightness(store.settings.brightness);
  showPage("live");
  if (recovered) pages.trip.showMessage(RECOVERED_MESSAGE, RECOVERED_MESSAGE_MS);
  telemetry.start();
  wakeLock.start();

  // Lets the app start without a network. Needs HTTPS (or localhost); skipped quietly otherwise.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((error) => console.error("No offline start", error));
  }

  window.dashboard = { store, trip, telemetry, pages, showPage, wakeLock, motion }; // handle for debugging in the console
}

main();
