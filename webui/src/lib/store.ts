/**
 * Global daemon connection — a long-lived WebSocket client carrying the
 * WebToken (Chapter 3.2.2 / 4.4.3).
 *
 * The store exposes reactive Svelte state for profiles / workspaces / events
 * and helper methods for every action verb in the protocol. The WebToken is
 * injected via the URL hash by the opentray host (Chapter 3.2.2 安全分发).
 */
import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type {
	WsServerMessage,
	WsClientMessage,
	PubEvent,
	Profile,
	WorkspaceEntry,
	PublishTarget,
	EventKind,
	EventPayloadData,
} from './types';
import { filterVisibleEvents, sortEvents } from './event-projection.js';
import { parseOkResponse } from './rest-response.js';
import { parseWsServerMessage } from './ws-message.js';

/** Exposed so pages can build authenticated REST requests (Chapter 3.2.2). */
export function readWebToken(): string {
	if (!browser) return '';
	const hash = window.location.hash.replace(/^#/, '');
	const params = new URLSearchParams(hash);
	return params.get('token') ?? '';
}

function derivePort(): string {
	if (!browser) return '0';
	// The daemon serves on a random port; opentray loads /#token=... on whatever
	// port it was told. We just use the current window location.
	return window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
}

export interface DaemonState {
	connected: boolean;
	authed: boolean;
	/**
	 * True after the daemon has sent the authoritative profiles frame. Transport
	 * connection is only a projection; route gates must wait for this source.
	 */
	profilesLoaded: boolean;
	profiles: Profile[];
	defaultProfile: string;
	workspaces: WorkspaceEntry[];
	events: PubEvent[];
	packages: PublishTarget[];
	scannedRoot: string | null;
	/** Staged confirmation token for a risky-workspace add (Chapter 5.3.2). */
	riskyConfirmationToken: string | null;
	toast: { level: 'info' | 'success' | 'error' | 'warning'; message: string; id: number } | null;
}

function createState(): DaemonState {
	return {
		connected: false,
		authed: false,
		profilesLoaded: false,
		profiles: [],
		defaultProfile: '',
		workspaces: [],
		events: [],
		packages: [],
		scannedRoot: null,
		riskyConfirmationToken: null,
		toast: null,
	};
}

export const daemon = writable<DaemonState>(createState());

/**
 * Ephemeral UI state — NOT protocol data. Drives the global Add Profile dialog
 * (used when at least one profile exists and the user adds another). When there
 * are NO profiles, the app forces the dedicated `/add-profile` route instead.
 */
export const ui = writable<{ addProfileOpen: boolean }>({ addProfileOpen: false });

export function openAddProfile(): void {
	ui.set({ addProfileOpen: true });
}

export function closeAddProfile(force = false): void {
	if (!force) {
		const { profiles } = get(daemon);
		if (profiles.length === 0) return;
	}
	ui.set({ addProfileOpen: false });
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function send(msg: WsClientMessage): void {
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify(msg));
	}
}

/** Open (or reopen) the daemon WebSocket and authenticate with the WebToken. */
export function connect(): void {
	if (!browser) return;
	if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
		return;
	}
	const token = readWebToken();
	const port = derivePort();
	const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
	// /ws is a dedicated upgrade path so the vite dev server can proxy it to the
	// daemon without colliding with the SPA's root route. The daemon validates by
	// ?token= query, not path, so it accepts /ws unchanged.
	const url = `${proto}://${window.location.hostname}:${port}/ws?token=${encodeURIComponent(token)}`;
	try {
		socket = new WebSocket(url);
	} catch {
		scheduleReconnect();
		return;
	}
	socket.onopen = () => {
		daemon.update((s) => ({ ...s, connected: true }));
		// Immediately authenticate so the daemon will honour action verbs.
		send({ type: 'auth', webToken: token });
	};
	socket.onmessage = (ev) => {
		const msg = parseWsServerMessage(ev.data);
		if (!msg) return;
		handleServerMessage(msg);
	};
	socket.onclose = () => {
		daemon.update((s) => ({ ...s, connected: false, authed: false }));
		socket = null;
		scheduleReconnect();
	};
	socket.onerror = () => {
		try {
			socket?.close();
		} catch {
			/* ignore */
		}
	};
}

function scheduleReconnect(): void {
	if (reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, 1500);
}

function handleServerMessage(msg: WsServerMessage): void {
	switch (msg.type) {
		case 'hello':
			// daemon requires auth; we already sent it on open.
			break;
		case 'profiles':
			daemon.update((s) => ({
				...s,
				profilesLoaded: true,
				profiles: msg.profiles,
				defaultProfile: msg.default,
			}));
			break;
		case 'workspaces':
			daemon.update((s) => ({ ...s, workspaces: msg.workspaces }));
			break;
		case 'events':
			daemon.update((s) => ({ ...s, events: sortEvents(msg.events) }));
			break;
		case 'event':
			daemon.update((s) => {
				const others = s.events.filter((e) => e.id !== msg.event.id);
				return { ...s, events: sortEvents([msg.event, ...others]) };
			});
			break;
		case 'packages':
			daemon.update((s) => ({
				...s,
				packages: msg.packages,
				scannedRoot: msg.root,
				riskyConfirmationToken: msg.riskyConfirmationToken ?? null,
			}));
			break;
		case 'toast':
			daemon.update((s) => ({ ...s, toast: { ...msg, id: Date.now() } }));
			break;
	}
}

// ----- Derived selectors -----

export const visibleEvents = derived(daemon, ($d) => filterVisibleEvents($d.events, $d.defaultProfile));
export const pendingEvents = derived(visibleEvents, ($events) => $events.filter((e) => e.status === 'pending'));
export const historyEvents = derived(visibleEvents, ($events) => $events.filter((e) => e.status !== 'pending'));
export const activeProfile = derived(daemon, ($d) =>
	$d.profiles.find((p) => p.username === $d.defaultProfile) ?? null,
);

// ----- Action helpers (Chapter 6.2 / 6.3) -----

export const actions = {
	selectProfile(username: string): void {
			// Chapter 6.1.1: switching identity clears the client store and
			// re-fetches the target profile's data so workspaces/packages are
			// re-scoped (profile isolation). A pending CLI profile override can
			// still surface through the visible-events projection.
			daemon.update((s) => ({
				...s,
				defaultProfile: username,
				workspaces: [],
				packages: [],
				scannedRoot: null,
				riskyConfirmationToken: null,
			}));
			send({ type: 'select-profile', username });
		},
	async deleteProfile(username: string): Promise<boolean> {
		const res = await fetch('/api/profiles', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${readWebToken()}` },
			body: JSON.stringify({ username }),
		});
		const json = parseOkResponse(await res.json());
		return json?.ok ?? false;
	},
	confirm(id: string): void {
		send({ type: 'confirm-event', id });
	},
	reject(id: string): void {
		send({ type: 'reject-event', id });
	},
	scanWorkspace(root: string): void {
		send({ type: 'scan-workspace', root });
	},
	/** Confirm a staged risky-workspace add (Chapter 5.3.2). */
	async confirmRiskyWorkspace(token: string): Promise<boolean> {
		const res = await fetch('/api/workspace/confirm', {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${readWebToken()}` },
			body: JSON.stringify({ token }),
		});
		const json = parseOkResponse(await res.json());
		if (json?.ok) daemon.update((s) => ({ ...s, riskyConfirmationToken: null }));
		return json?.ok ?? false;
	},
	/** Cancel a staged risky-workspace add (Chapter 5.3.2). */
	cancelRiskyWorkspace(token: string): Promise<void> {
		daemon.update((s) => ({ ...s, riskyConfirmationToken: null }));
		return fetch('/api/workspace/cancel', {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${readWebToken()}` },
			body: JSON.stringify({ token }),
		}).then(() => undefined, () => undefined);
	},
	createEvent<K extends EventKind>(kind: K, payload: EventPayloadData<K>): void {
		send({ type: 'create-event', kind, payload });
	},
	// import/export are handled via REST (/api/export, /api/import), not WS.
};

/** Convenience: are we waiting on any pending event? (Tray keepOnTop hint.) */
export function hasPending(): boolean {
	return get(daemon).events.some((e) => e.status === 'pending');
}
