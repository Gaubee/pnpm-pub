import Root from './badge.svelte';
import { type VariantProps, tv } from 'tailwind-variants';

export const badgeVariants = tv({
	base: 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
	variants: {
		variant: {
			default: 'border-transparent bg-primary text-primary-foreground',
			secondary: 'border-transparent bg-secondary text-secondary-foreground',
			destructive: 'border-transparent bg-destructive text-destructive-foreground',
			outline: 'text-foreground',
			success: 'border-transparent bg-success/15 text-success',
			warning: 'border-transparent bg-warning/15 text-warning',
			brand: 'border-transparent bg-brand/15 text-brand',
		},
	},
	defaultVariants: {
		variant: 'default',
	},
});

export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];

export { Root, Root as Badge };
