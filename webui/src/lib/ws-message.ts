import type {
	EventKind,
	EventPayload,
	EventStatus,
	Profile,
	PubEvent,
	PublishSource,
	PublishTarget,
	WorkspaceEntry,
	WsServerMessage,
} from './types.js';

const eventKinds = new Set<string>(['publish', 'setup-oidc', 'create-placeholder', 'refresh-token']);
const eventStatuses = new Set<string>(['pending', 'success', 'failed', 'expired', 'action-required', 'rejected']);
const toastLevels = new Set<string>(['info', 'success', 'error', 'warning']);

export function parseWsServerMessage(data: unknown): WsServerMessage | null {
	if (typeof data !== 'string') return null;
	try {
		const parsed: unknown = JSON.parse(data);
		return isWsServerMessage(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isWsServerMessage(value: unknown): value is WsServerMessage {
	if (!isRecord(value) || typeof value.type !== 'string') return false;
	switch (value.type) {
		case 'hello':
			return value.webTokenRequired === true;
		case 'events':
			return isArrayOf(value.events, isPubEvent);
		case 'event':
			return isPubEvent(value.event);
		case 'profiles':
			return typeof value.default === 'string' && isArrayOf(value.profiles, isProfile);
		case 'workspaces':
			return isArrayOf(value.workspaces, isWorkspaceEntry);
		case 'packages':
			return (
				typeof value.root === 'string' &&
				isArrayOf(value.packages, isPublishTarget) &&
				isOptionalString(value.riskyConfirmationToken)
			);
		case 'toast':
			return typeof value.level === 'string' && toastLevels.has(value.level) && typeof value.message === 'string';
		default:
			return false;
	}
}

function isProfile(value: unknown): value is Profile {
	return (
		isRecord(value) &&
		typeof value.username === 'string' &&
		isOptionalString(value.registry) &&
		isOptionalString(value.avatarUrl)
	);
}

function isWorkspaceEntry(value: unknown): value is WorkspaceEntry {
	return (
		isRecord(value) &&
		typeof value.path === 'string' &&
		typeof value.pinned === 'boolean' &&
		isMillisecondEpoch(value.addedAt)
	);
}

function isPubEvent(value: unknown): value is PubEvent {
	return (
		isRecord(value) &&
		isEventKind(value.kind) &&
		isEventStatus(value.status) &&
		typeof value.id === 'string' &&
		typeof value.profile === 'string' &&
		isMillisecondEpoch(value.createdAt) &&
		isOptionalString(value.profileOverride) &&
		isOptionalMillisecondEpoch(value.resolvedAt) &&
		isOptionalString(value.result) &&
		isOptionalBoolean(value.clockDriftRecovered) &&
		isOptionalEventPayload(value.payload)
	);
}

function isOptionalEventPayload(value: unknown): value is EventPayload | undefined {
	return value === undefined || isEventPayload(value);
}

function isEventPayload(value: unknown): value is EventPayload {
	if (!isRecord(value) || typeof value.kind !== 'string') return false;
	switch (value.kind) {
		case 'publish':
			return isRecord(value.data) && isPublishSource(value.data.source) && isStringArray(value.data.args) && isPublishTarget(value.data.target);
		case 'setup-oidc':
				return (
					isRecord(value.data) &&
					typeof value.data.repo === 'string' &&
					typeof value.data.name === 'string' &&
					isOptionalString(value.data.branch) &&
					typeof value.data.path === 'string' &&
					isOptionalBoolean(value.data.force)
				);
		case 'create-placeholder':
			return isRecord(value.data) && typeof value.data.name === 'string';
		case 'refresh-token':
			return isRecord(value.data) && typeof value.data.username === 'string';
		default:
			return false;
	}
}

function isPublishSource(value: unknown): value is PublishSource {
	return (
		isRecord(value) &&
		(value.kind === 'directory' || value.kind === 'tarball') &&
		typeof value.path === 'string'
	);
}

function isPublishTarget(value: unknown): value is PublishTarget {
	return (
		isRecord(value) &&
		typeof value.name === 'string' &&
		typeof value.version === 'string' &&
		typeof value.path === 'string' &&
		isOptionalString(value.previousVersion) &&
		isOptionalString(value.description) &&
		isOptionalString(value.repository) &&
		isOptionalPublishConfig(value.publishConfig) &&
		isOptionalBoolean(value.publishable)
	);
}

function isOptionalPublishConfig(value: unknown): value is PublishTarget['publishConfig'] {
	return (
		value === undefined ||
		(isRecord(value) &&
			isOptionalString(value.registry) &&
			isOptionalString(value.tag) &&
			isOptionalString(value.access))
	);
}

function isEventKind(value: unknown): value is EventKind {
	return typeof value === 'string' && eventKinds.has(value);
}

function isEventStatus(value: unknown): value is EventStatus {
	return typeof value === 'string' && eventStatuses.has(value);
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
	return Array.isArray(value) && value.every(guard);
}

function isStringArray(value: unknown): value is string[] {
	return isArrayOf(value, (item): item is string => typeof item === 'string');
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}

function isMillisecondEpoch(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOptionalMillisecondEpoch(value: unknown): value is number | undefined {
	return value === undefined || isMillisecondEpoch(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
	return value === undefined || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
