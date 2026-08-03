/**
 * Ambient `window.wp.os` global declaration for plugin
 * bundles that consume `@desktop-mode/types/global` via
 * `tsconfig.json -> compilerOptions.types`.
 *
 * The shell installs `window.wp.os` at module-load time;
 * plugin code that runs after the shell boots can reach the
 * full `OpenStationPublicApi` surface through `wp.os.*` with
 * no import.
 *
 * Intentionally diverges from the in-tree `src/global.d.ts`
 * (which only merges an optional `desktop?` slot into a shared
 * `WpGlobal` interface): this package additionally declares a
 * bare, non-optional `const wp.os` ambient. Plugin bundles
 * consuming this package run only after the shell has booted —
 * `window.wp.os` is guaranteed to exist — so the README's
 * bare `wp.os.*` examples type-check without optional
 * chaining or guards.
 */

import type { OpenStationPublicApi } from '../../../src/desktop';

declare global {
	interface Window {
		wp?: {
			os?: OpenStationPublicApi;
			[ key: string ]: unknown;
		};
	}

	const wp: {
		os: OpenStationPublicApi;
		[ key: string ]: unknown;
	};
}

export {};
