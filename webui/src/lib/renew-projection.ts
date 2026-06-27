export type RenewReason = 'expired' | 'action-required' | 'direct';

export interface RenewProjection {
	heading: string;
	intro: string;
	documentTitle: string;
	submitLabel: string;
	busyLabel: string;
	defaultError: string;
}

const expiredProjection: RenewProjection = {
	heading: 'Renew Token',
	intro: 'The current token has expired. Re-apply to continue publishing.',
	documentTitle: 'Renew Token · pnpm-pub',
	submitLabel: 'Renew token',
	busyLabel: 'Renewing…',
	defaultError: 'Renew failed.',
};

const credentialProjection: RenewProjection = {
	heading: 'Re-apply Credentials',
	intro: 'Re-apply credentials before publishing can continue.',
	documentTitle: 'Re-apply Credentials · pnpm-pub',
	submitLabel: 'Re-apply credentials',
	busyLabel: 'Re-applying…',
	defaultError: 'Credential re-apply failed.',
};

const projections: Record<RenewReason, RenewProjection> = {
	expired: expiredProjection,
	'action-required': credentialProjection,
	direct: credentialProjection,
};

export function toRenewReason(value: string | null): RenewReason {
	if (value === 'expired' || value === 'action-required') return value;
	return 'direct';
}

export function getRenewProjection(reason: RenewReason): RenewProjection {
	return projections[reason];
}
