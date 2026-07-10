/**
 * Feature: WebUI QR scanner capture policy
 *
 * Camera frames are the source image for the decoder. The visible guide is
 * only a positioning aid, so it must never silently reduce the decoded field.
 */
import { describe, expect, it } from "vite-plus/test";
import { QR_SCANNER_CONFIG, QR_VIDEO_CONSTRAINTS } from "../../webui/src/lib/qr-scanner-policy.js";

describe("Feature: WebUI QR scanner capture policy", () => {
  it("Scenario: Given a QR inside the visible guide, When live scanning begins, Then the complete camera frame remains decodable", () => {
    expect("qrbox" in QR_SCANNER_CONFIG).toBe(false);
  });

  it("Scenario: Given a detailed phone-screen QR, When requesting a camera stream, Then high-resolution capture is preferred", () => {
    expect(QR_VIDEO_CONSTRAINTS.width).toEqual({ ideal: 1920 });
    expect(QR_VIDEO_CONSTRAINTS.height).toEqual({ ideal: 1080 });
  });
});
