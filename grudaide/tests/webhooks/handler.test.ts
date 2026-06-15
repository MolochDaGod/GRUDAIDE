/**
 * GRUDAIDE - Webhook Handler Tests
 */

import * as crypto from "crypto";
import { verifySignature } from "../../src/webhooks/handler";

const SECRET = "grudaide-test-secret";

function sign(payload: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
}

describe("verifySignature", () => {
  it("returns true for a valid signature", () => {
    const payload = Buffer.from(JSON.stringify({ action: "push" }));
    const sig = sign(payload.toString(), SECRET);
    expect(verifySignature(payload, sig, SECRET)).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    const payload = Buffer.from(JSON.stringify({ action: "push" }));
    expect(verifySignature(payload, "sha256=badhex", SECRET)).toBe(false);
  });

  it("returns false when signature is undefined", () => {
    const payload = Buffer.from("{}");
    expect(verifySignature(payload, undefined, SECRET)).toBe(false);
  });

  it("returns false for wrong secret", () => {
    const payload = Buffer.from(JSON.stringify({ action: "push" }));
    const sig = sign(payload.toString(), "different-secret");
    expect(verifySignature(payload, sig, SECRET)).toBe(false);
  });

  it("returns false for malformed signature (no algo prefix)", () => {
    const payload = Buffer.from("{}");
    expect(verifySignature(payload, "nohexhere", SECRET)).toBe(false);
  });
});
