import { vi } from 'vitest';

export async function loadTwoBundleCopies< T >(
	loadA: () => Promise< T >,
	loadB: () => Promise< T >,
): Promise< [ T, T ] > {
	vi.resetModules();
	const bundleA = await loadA();
	vi.resetModules();
	const bundleB = await loadB();
	return [ bundleA, bundleB ];
}
