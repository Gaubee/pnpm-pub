/**
 * Ambient types for the native Barcode Detection API
 * (https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API).
 *
 * Supported in WebView2 (Chromium) and modern Safari — both of which this app
 * targets. TS's bundled lib.dom does not yet declare these, so we provide a
 * minimal surface used by totp-scanner.svelte. When the API is absent at
 * runtime the scanner falls back to html5-qrcode.
 */
declare type BarcodeFormat = 'qr_code' | 'code_128' | 'code_39' | 'ean_13' | 'ean_8' | 'upc_a';

declare interface BarcodeDetectorOptions {
	formats?: BarcodeFormat[];
}

declare interface DetectedBarcode {
	rawValue: string;
	boundingBox: DOMRectReadOnly;
	format: BarcodeFormat;
}

declare class BarcodeDetector {
	constructor(options?: BarcodeDetectorOptions);
	static getSupportedFormats(): Promise<BarcodeFormat[]>;
	detect(target: CanvasImageSource): Promise<DetectedBarcode[]>;
}
