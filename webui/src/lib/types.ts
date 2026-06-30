/**
 * WebUI mirror of the daemon protocol types (see src/shared/index.ts).
 *
 * These are duplicated (rather than imported) so the SvelteKit bundle contains
 * no Node-only code. Keep in sync with the daemon side.
 */

export interface Profile {
	username: string;
	registry?: string;
	avatarUrl?: string;
	ciPreferences?: Record<string, unknown>;
}

export interface WorkspaceEntry {
	path: string;
	pinned: boolean;
	addedAt: number;
}

export interface PublishConfig {
	registry?: string;
	tag?: string;
	access?: string;
}

export interface PublishTarget {
	name: string;
	version: string;
	previousVersion?: string;
	description?: string;
	path: string;
	repository?: string;
	publishConfig?: PublishConfig;
	publishable?: boolean;
}

export type PublishSource =
	| { kind: 'directory'; path: string }
	| { kind: 'tarball'; path: string };

export interface PublishContext {
	source: PublishSource;
	args: string[];
	target: PublishTarget;
}

export interface OidcContext {
	repo: string;
	name: string;
	branch?: string;
	path: string;
	force?: boolean;
}

export interface CreatePlaceholderContext {
	name: string;
}

export interface RefreshTokenContext {
	username: string;
}

export type EventKind =
	| 'publish'
	| 'setup-oidc'
	| 'create-placeholder'
	| 'refresh-token';

export type EventStatus = 'pending' | 'success' | 'failed' | 'expired' | 'action-required' | 'rejected';

export type EventPayload =
	| { kind: 'publish'; data: PublishContext }
	| { kind: 'setup-oidc'; data: OidcContext }
	| { kind: 'create-placeholder'; data: CreatePlaceholderContext }
	| { kind: 'refresh-token'; data: RefreshTokenContext };

/** Payload data shape for one concrete Event kind. */
export type EventPayloadData<K extends EventKind> = Extract<EventPayload, { kind: K }>['data'];

export interface PubEvent {
	id: string;
	kind: EventKind;
	status: EventStatus;
	profile: string;
	profileOverride?: string;
	createdAt: number;
	resolvedAt?: number;
	payload?: EventPayload;
	result?: string;
	clockDriftRecovered?: boolean;
}

export interface BackupBundle {
	profiles: string[];
	salt: string;
	iv: string;
	ciphertext: string;
}

export type WsServerMessage =
	| { type: 'hello'; webTokenRequired: true }
	| { type: 'events'; events: PubEvent[] }
	| { type: 'event'; event: PubEvent }
	| { type: 'profiles'; default: string; profiles: Profile[] }
	| { type: 'workspaces'; workspaces: WorkspaceEntry[] }
	| { type: 'packages'; root: string; packages: PublishTarget[]; riskyConfirmationToken?: string }
	| { type: 'toast'; level: 'info' | 'success' | 'error' | 'warning'; message: string };

export type WsClientMessage =
	| { type: 'auth'; webToken: string }
	| { type: 'select-profile'; username: string }
	| { type: 'confirm-event'; id: string }
	| { type: 'reject-event'; id: string }
	| { type: 'scan-workspace'; root: string }
	| { type: 'create-event'; kind: EventKind; payload: unknown };
