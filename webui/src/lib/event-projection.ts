import type { PubEvent } from './types.js';

export function sortEvents(events: PubEvent[]): PubEvent[] {
	return [...events].sort((a, b) => b.createdAt - a.createdAt);
}

export function isEventVisibleForProfile(event: PubEvent, activeProfile: string): boolean {
	if (event.profile === activeProfile) return true;
	return event.status === 'pending' && event.profileOverride !== undefined && event.profileOverride.length > 0;
}

export function filterVisibleEvents(events: PubEvent[], activeProfile: string): PubEvent[] {
	return sortEvents(events.filter((event) => isEventVisibleForProfile(event, activeProfile)));
}
