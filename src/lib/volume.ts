// Volume axis for the journal (remediation item 15; see
// docs/volume-schema-design.md). A "volume" is a notebook: entries and
// recurrences belong to the active volume, and the server update log is
// partitioned by volume so opening a new volume never re-encrypts an old one.
//
// All current data lives in volume "v1". The default is chosen so the
// IndexedDB doc name stays byte-for-byte "journlet-journal-v1" — existing
// local journals are adopted as-is, no local migration.
//
// The close-a-volume ritual (opening the next volume, carrying open items and
// rules forward, and the permanent collections/habits store) is built later.
// This module is only the plumbing that keeps the model from assuming a single
// volume for good.

const ACTIVE_VOLUME_KEY = "journlet-active-volume";

export const DEFAULT_VOLUME = "v1";

export const getActiveVolume = (): string => {
  try {
    return localStorage.getItem(ACTIVE_VOLUME_KEY) || DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
};

export const setActiveVolume = (volume: string): void => {
  try {
    localStorage.setItem(ACTIVE_VOLUME_KEY, volume);
  } catch {
    // Storage unavailable — fall back to the default for this session.
  }
};

export const docNameForVolume = (volume: string): string =>
  `journlet-journal-${volume}`;
