"use strict";

/* Keeps the phone's screen on while the app is open, using the browser's Screen Wake Lock.
 *
 * The browser drops the lock whenever the page is hidden, so it is asked for again when the
 * page comes back. It can also be refused (old iPhone software, battery saver), in which case
 * the phone's own Auto-Lock setting is the only fix, and `message` says so.
 */

class ScreenWakeLock {
  constructor() {
    this._lock = null;
    this._listeners = [];
    this.supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
    this.failed = false;
  }

  /** Calls `listener()` whenever `active` or `message` may have changed. */
  onChange(listener) {
    this._listeners.push(listener);
  }

  get active() {
    return this._lock !== null;
  }

  get message() {
    if (!this.supported) return "Not supported here. Set Auto-Lock to Never in the phone's Display & Brightness settings.";
    if (this.active) return "On: the screen stays on while the app is open.";
    if (this.failed) return "Refused by the phone. Set Auto-Lock to Never in Display & Brightness settings.";
    return "Not on yet.";
  }

  /** Asks for the lock now, and again whenever the page becomes visible or is touched. */
  start() {
    this.request();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.request();
    });
    // some browsers only grant it after a touch
    document.addEventListener("pointerdown", () => { if (!this.active) this.request(); });
  }

  async request() {
    if (!this.supported || this.active || document.visibilityState !== "visible") return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      this._lock = lock;
      this.failed = false;
      lock.addEventListener("release", () => {
        if (this._lock === lock) this._lock = null;
        this._notify();
      });
    } catch (error) {
      this.failed = true;
    }
    this._notify();
  }

  _notify() {
    for (const listener of this._listeners) listener();
  }
}
