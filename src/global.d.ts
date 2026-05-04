/**
 * Ambient type declarations for `window.wp.desktop`.
 *
 * **For external plugin authors:** include this package in your
 * tsconfig's `compilerOptions.types` array (or add a triple-slash
 * `/// <reference types="desktop-mode" />` to one of your entry
 * files) and `window.wp.desktop` will be typed as `WpDesktopPublicApi`
 * across your project — no per-call casts.
 *
 * ```jsonc
 * // tsconfig.json
 * {
 *   "compilerOptions": {
 *     "types": [ "desktop-mode" ]
 *   }
 * }
 * ```
 *
 * ```ts
 * // anywhere in your plugin
 * window.wp?.desktop?.showToast( { message: 'Hello' } );
 * ```
 *
 * The declarations live in a `.d.ts` (not a `.ts`) on purpose: type-only
 * file, no runtime bundle impact. Consumers get the typings; nothing
 * from this file ends up in their compiled output.
 *
 * @since 0.23.0
 */

import type { WpDesktopPublicApi } from './desktop';
import type { WpHooks } from './hooks';

declare global {
	/**
	 * Merged `window.wp` namespace. Each module that contributes to
	 * `window.wp.*` extends this interface via declaration merging —
	 * matching the pattern WordPress core uses with `wp.hooks`,
	 * `wp.i18n`, etc. so a plugin that already declares its own
	 * `wp.<name>` slot composes cleanly.
	 */
	interface WpGlobal {
		desktop?: WpDesktopPublicApi;
		hooks?: WpHooks;
	}

	interface Window {
		wp?: WpGlobal;
	}
}

export {};
