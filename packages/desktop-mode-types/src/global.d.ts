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
 * Intentionally diverges from the in-tree `src/global.d.ts`
 * (which only merges an optional `desktop?` slot into a shared
 * `WpGlobal` interface): this package additionally declares a
 * bare, non-optional `const wp.desktop` ambient. Plugin bundles
 * consuming this package run only after the shell has booted —
 * `window.wp.desktop` is guaranteed to exist — so the README's
 * bare `wp.desktop.*` examples type-check without optional
 * chaining or guards.
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
