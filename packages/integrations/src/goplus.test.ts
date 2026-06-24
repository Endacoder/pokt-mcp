import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signGoPlusRequestForTest } from "./goplus.js";

describe("GoPlus auth", () => {
  it("signs app_key + time + app_secret with sha1", () => {
    const sign = signGoPlusRequestForTest("mBOMg20QW11BbtyH4Zh0", 1647847498, "V6aRfxlPJwN3ViJSIFSCdxPvneajuJsh");
    expect(sign).toBe(
      createHash("sha1")
        .update("mBOMg20QW11BbtyH4Zh01647847498V6aRfxlPJwN3ViJSIFSCdxPvneajuJsh")
        .digest("hex"),
    );
    expect(sign).toBe("7293d385b9225b3c3f232b76ba97255d0e21063e");
  });
});
