"use strict";

/* Settings page: theme, brightness, GPS and OBD status with Reconnect. */

const BRIGHTNESS_MIN = 10;
const BRIGHTNESS_MAX = 100;
const STATE_TEXT = {
  [CONNECTED]: "Connected",
  [NO_FIX]: "No GPS fix",
  [DISCONNECTED]: "Not connected",
};

class SettingsPage {
  /** `onThemeChange(name)` and `onBrightnessChange(percent)` apply the change to the whole app. */
  constructor(root, { store, telemetry, wakeLock, onThemeChange, onBrightnessChange }) {
    this.store = store;
    this.wakeLock = wakeLock;
    const settings = store.settings;

    this.themeButtons = [["Night", "night"], ["Day", "day"]].map(([label, name]) =>
      h("button", {
        class: "seg-button",
        onclick: () => {
          settings.theme = name;
          onThemeChange(name);
          this.refreshTheme();
          store.saveSettings();
        },
      }, label));

    this.slider = h("input", {
      type: "range", class: "slider", min: BRIGHTNESS_MIN, max: BRIGHTNESS_MAX, value: settings.brightness,
    });
    this.slider.addEventListener("input", () => {
      settings.brightness = Number(this.slider.value);
      onBrightnessChange(settings.brightness);
    });
    // while dragging, only the last value is stored (once, on release)
    this.slider.addEventListener("change", () => store.saveSettings());

    this.gps = this._deviceRow("GPS receiver", () => telemetry.reconnect("gps"));
    this.obd = this._deviceRow("OBD-II adapter", () => telemetry.reconnect("obd"));

    this.screenStatus = h("div", { class: "device-status" });
    this.installStatus = h("div", { class: "device-status" });
    wakeLock.onChange(() => this.refreshApp());

    this.storageText = h("div", { class: "muted-text" });
    this.backupMessage = h("div", { class: "backup-message" });
    this.fileInput = h("input", { type: "file", accept: "application/json,.json", hidden: "" });
    this.fileInput.addEventListener("change", () => this.importBackup());

    root.append(
      h("div", { class: "panel settings-panel" },
        h("div", { class: "setting-row" }, h("div", { class: "setting-label" }, "Theme"),
          h("div", { class: "seg-group" }, this.themeButtons)),
        h("div", { class: "setting-row" }, h("div", { class: "setting-label" }, "Brightness"), this.slider),
        this.gps.row,
        this.obd.row,
        h("div", { class: "setting-row" },
          h("div", {}, h("div", { class: "setting-label" }, "Keep screen on"), this.screenStatus)),
        h("div", { class: "setting-row" },
          h("div", {}, h("div", { class: "setting-label" }, "Home Screen"), this.installStatus)),
      ),
      h("div", { class: "panel backup-panel" },
        h("div", { class: "label" }, "Backup"),
        this.storageText,
        h("div", { class: "button-row" },
          h("button", { class: "action-button small", onclick: () => this.exportBackup() }, "Export"),
          h("button", { class: "action-button small", onclick: () => this.fileInput.click() }, "Import"),
        ),
        this.backupMessage,
        this.fileInput,
      ),
    );
    this.refreshTheme();
    this.show();
  }

  /** Whether the app was opened from the Home Screen icon (iPhone's own flag, or the standard one). */
  static isInstalled() {
    return navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  }

  refreshApp() {
    this.screenStatus.textContent = this.wakeLock.message;
    this.installStatus.textContent = SettingsPage.isInstalled()
      ? "Opened from the Home Screen."
      : "Not installed. In Safari tap Share, then Add to Home Screen.";
  }

  show() {
    this.refreshApp();
    const trips = this.store.trips("all").length;
    this.storageText.textContent = `${this.store.statusText} ${trips} ${trips === 1 ? "trip" : "trips"} stored.`;
  }

  /** Shares the backup file through the phone's share sheet (Files, iCloud, mail...), or downloads it. */
  exportBackup() {
    const name = `dashboard-backup-${dayToText(new Date())}.json`;
    const file = new File([JSON.stringify(this.store.exportData(), null, 1)], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).then(
        () => this.showBackupMessage("Backup exported."),
        (error) => { if (error.name !== "AbortError") this._download(file); },
      );
      return;
    }
    this._download(file);
  }

  _download(file) {
    const url = URL.createObjectURL(file);
    const link = h("a", { href: url, download: file.name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    this.showBackupMessage("Backup file created.");
  }

  async importBackup() {
    const file = this.fileInput.files[0];
    this.fileInput.value = "";
    if (!file) return;
    try {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (error) {
        throw new Error("This is not a valid backup file (not readable).");
      }
      const backup = MemoryStore.parseBackup(data);
      const question =
        `Replace everything on this phone with the backup?\n\n` +
        `Backup: ${backup.trips.length} trips, ${backup.runs.length} runs.\n` +
        `Now: ${this.store.trips("all").length} trips.`;
      if (!confirm(question)) return;
      await this.store.importData(backup);
      location.reload(); // starts the app again with the restored data
    } catch (error) {
      this.showBackupMessage(error.message);
    }
  }

  showBackupMessage(text) {
    this.backupMessage.textContent = text;
  }

  _deviceRow(name, onReconnect) {
    const status = h("div", { class: "device-status" }, STATE_TEXT[DISCONNECTED]);
    const row = h("div", { class: "setting-row" },
      h("div", {}, h("div", { class: "setting-label" }, name), status),
      h("button", { class: "action-button small", onclick: onReconnect }, "Reconnect"),
    );
    return { row, status };
  }

  refreshTheme() {
    ["night", "day"].forEach((name, index) => {
      this.themeButtons[index].classList.toggle("active", this.store.settings.theme === name);
    });
  }

  update(snap) {
    for (const [device, state, error] of [
      [this.gps, snap.gpsState, snap.gpsError],
      [this.obd, snap.obdState, snap.obdError],
    ]) {
      // a connection problem explains itself; otherwise just the state
      device.status.textContent = state === DISCONNECTED && error ? error : STATE_TEXT[state];
      device.status.className = "device-status " + stateClass(state);
    }
  }
}
