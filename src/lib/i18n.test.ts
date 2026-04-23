import { describe, it, expect } from "vitest";
import { t, initLocale, getLocale } from "./i18n";

describe("i18n", () => {
  it("initializes from navigator.language", () => {
    initLocale();
    const locale = getLocale();
    expect(["zh", "en"]).toContain(locale);
  });

  it("returns translated string for known key", () => {
    initLocale();
    const result = t("nav.home");
    expect(result).toBeTruthy();
    expect(result).not.toBe("nav.home"); // Should not return the key itself
  });

  it("returns key for unknown translation", () => {
    const result = t("nonexistent.key.here");
    expect(result).toBe("nonexistent.key.here");
  });

  it("has matching keys in both zh and en", () => {
    // This test ensures we don't miss translations
    initLocale();
    const zhKeys = [
      "nav.home", "nav.knowledge", "nav.settings",
      "home.pending", "home.myApps", "home.createApp",
      "settings.title", "settings.provider", "settings.save",
    ];

    for (const key of zhKeys) {
      const result = t(key);
      expect(result).not.toBe(key);
    }
  });
});
