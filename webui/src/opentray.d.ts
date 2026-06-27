interface OverlayGeometry {
	getTitlebarAreaRect(): Promise<{ x: number; y: number; width: number; height: number }>;
	addEventListener?(event: string, handler: (e: { titlebarAreaRect: { x: number; y: number; width: number; height: number } }) => void): void;
	removeEventListener?(event: string, handler: (e: { titlebarAreaRect: { x: number; y: number; width: number; height: number } }) => void): void;
	listen?(event: string, handler: (e: { titlebarAreaRect: { x: number; y: number; width: number; height: number } }) => void): Promise<() => Promise<void>>;
}

interface OpentrayWindowBridge {
	overlay?: OverlayGeometry;
	startAppRegionDrag?(opts?: { x?: number; y?: number; pointerId?: number }): Promise<unknown>;
}

declare global {
	interface Navigator {
		opentrayWindow?: OpentrayWindowBridge;
		opentray?: {
			window?: OpentrayWindowBridge;
		};
	}
}

export {};
