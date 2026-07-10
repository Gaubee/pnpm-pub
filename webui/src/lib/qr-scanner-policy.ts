/**
 * Camera and decoder policy for TOTP QR imports.
 *
 * The visible scan guide helps a person position a code. It must not become a
 * hidden crop: every live decode receives the complete captured frame.
 */
import { Html5QrcodeSupportedFormats } from "html5-qrcode";

export type CameraFacingMode = "environment" | "user";

export const QR_VIDEO_CONSTRAINTS = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  aspectRatio: { ideal: 4 / 3 },
} satisfies MediaTrackConstraints;

export const QR_SCANNER_CONFIG = {
  fps: 12,
  disableFlip: false,
  videoConstraints: QR_VIDEO_CONSTRAINTS,
};

export const QR_DECODER_CONFIG = {
  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
  // html5-qrcode's ZXing path is shared by live and still-image imports.
  useBarCodeDetectorIfSupported: false,
  verbose: false,
};

/** Creates a full-frame camera request while preserving the selected lens. */
export function createQrScannerConfig(facingMode: CameraFacingMode) {
  return {
    ...QR_SCANNER_CONFIG,
    videoConstraints: {
      ...QR_VIDEO_CONSTRAINTS,
      facingMode: { ideal: facingMode },
    },
  };
}
