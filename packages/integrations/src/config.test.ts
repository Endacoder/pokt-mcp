import { describe, expect, it } from "vitest";
import { chainToGoPlusId, chainToDefiLlama } from "./index.js";
import { loadDefiLlamaBaseUrl, loadPocketLcdUrl } from "./config.js";

describe("integrations config", () => {
  it("maps chain slugs for GoPlus", () => {
    expect(chainToGoPlusId("eth")).toBe(1);
    expect(chainToGoPlusId("base")).toBe(8453);
  });

  it("maps chain slugs for DeFiLlama", () => {
    expect(chainToDefiLlama("eth")).toBe("Ethereum");
    expect(chainToDefiLlama("base")).toBe("Base");
  });

  it("defaults DeFiLlama base URL", () => {
    expect(loadDefiLlamaBaseUrl()).toContain("llama.fi");
  });

  it("allows unset Pocket LCD", () => {
    const prev = process.env.POCKET_LCD_URL;
    delete process.env.POCKET_LCD_URL;
    expect(loadPocketLcdUrl()).toBeUndefined();
    if (prev) process.env.POCKET_LCD_URL = prev;
  });
});
