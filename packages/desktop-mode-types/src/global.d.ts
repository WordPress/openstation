/**
 * Ambient `window.wp.desktop` global declaration for plugin
 * bundles that consume `@desktop-mode/types/global` via
 * `tsconfig.json -> compilerOptions.types`.
 *
 * The shell installs `window.wp.desktop` at module-load time;
 * plugin code that runs after the shell boots can reach the
 * full `WpDesktopPublicApi` surface through `wp.desktop.*` with
 * no import.
 *
 * Mirrors the existing in-tree `src/global.d.ts` but namespaced
 * for npm distribution.
 *
 * @since 0.8.1
 */

import type { WpDesktopPublicApi } from '../../../src/desktop';

declare global {
	interface Window {
		wp?: {
			desktop?: WpDesktopPublicApi;
			[ key: string ]: unknown;
		};
	}

	const wp: {
		desktop: WpDesktopPublicApi;
		[ key: string ]: unknown;
	};
}

export {};
