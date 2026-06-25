import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn-svelte's canonical className combiner. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
