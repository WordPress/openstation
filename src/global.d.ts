/**
 * Ambient type declarations for `window.wp.os`.
 *
 * **For external plugin authors:** include this package in your
 * tsconfig's `compilerOptions.types` array (or add a triple-slash
 * `/// <reference types="openstation" />` to one of your entry
 * files) and `window.wp.os` will be typed as `OpenStationPublicApi`
 * across your project — no per-call casts.
 *
 * ```jsonc
 * // tsconfig.json
 * {
 *   "compilerOptions": {
 *     "types": [ "openstation" ]
 *   }
 * }
 * ```
 *
 * ```ts
 * // anywhere in your plugin
 * window.wp?.os?.showToast( { message: 'Hello' } );
 * ```
 *
 * The declarations live in a `.d.ts` (not a `.ts`) on purpose: type-only
 * file, no runtime bundle impact. Consumers get the typings; nothing
 * from this file ends up in their compiled output.
 */

import type { OpenStationPublicApi } from './desktop';
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
		os?: OpenStationPublicApi;
		hooks?: WpHooks;
	}

	interface Window {
		wp?: WpGlobal;
	}
}

export {};
