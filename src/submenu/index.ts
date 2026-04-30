/**
 * Desktop Mode — Submenu renderer barrel.
 *
 * Public re-exports so plugin authors only need one import path:
 *
 * ```ts
 * import {
 *     registerSubmenuRenderer,
 *     type SubmenuRenderer,
 *     type SubmenuMountDeps,
 *     type SubmenuController,
 *     type SubmenuItem,
 * } from 'wp-desktop/submenu';   // resolved from `wp.desktop.*` at runtime
 * ```
 *
 * The shell wires the same exports into `wp.desktop.*` (see
 * `desktop.ts`) so plugins can use either entry point depending on
 * whether they're bundled with the shell types or not.
 */

export {
	register as registerSubmenuRenderer,
	unregister as unregisterSubmenuRenderer,
	unregisterByOwner as unregisterSubmenuRenderersByOwner,
	get as getSubmenuRenderer,
	list as listSubmenuRenderers,
	subscribe as subscribeSubmenuRenderers,
	setActiveRenderer as setActiveSubmenuRenderer,
	getActiveRendererId as getActiveSubmenuRendererId,
	resolveActive as resolveActiveSubmenuRenderer,
	_resetForTests as _resetSubmenuRenderersForTests,
} from './registry';

export { defaultSubmenuRenderer } from './default-renderer';

export type {
	SubmenuController,
	SubmenuItem,
	SubmenuMountDeps,
	SubmenuRenderer,
} from './types';

import { register } from './registry';
import { defaultSubmenuRenderer } from './default-renderer';

/**
 * Bootstrap the registry with the built-in `'default'` renderer.
 * Idempotent — calling twice replaces the entry but doesn't double
 * up. Called from the shell boot path before any plugin script
 * runs, so plugins that want to *replace* the default can register
 * their own `id: 'default'` and override.
 */
export function installDefaultSubmenuRenderer(): void {
	register( defaultSubmenuRenderer );
}
