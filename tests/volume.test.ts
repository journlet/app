// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  DEFAULT_VOLUME,
  docNameForVolume,
  getActiveVolume,
  setActiveVolume,
} from "../src/lib/volume";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

test("defaults to v1 so the existing doc name is unchanged", () => {
  expect(getActiveVolume()).toBe("v1");
  expect(DEFAULT_VOLUME).toBe("v1");
  expect(docNameForVolume(getActiveVolume())).toBe("journlet-journal-v1");
});

test("persists and reads back the active volume", () => {
  setActiveVolume("v2");
  expect(getActiveVolume()).toBe("v2");
  expect(docNameForVolume("v2")).toBe("journlet-journal-v2");
});
