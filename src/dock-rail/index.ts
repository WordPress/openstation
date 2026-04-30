/**
 * Desktop Mode — Dock rail renderer barrel.
 *
 * Public re-exports so plugin authors only need one import path,
 * mirroring `src/submenu/index.ts`.
 */

export {
	register as registerDockRailRenderer,
	unregister as unregisterDockRailRenderer,
	unregisterByOwner as unregisterDockRailRenderersByOwner,
	get as getDockRailRenderer,
	list as listDockRailRenderers,
	subscribe as subscribeDockRailRenderers,
	setActiveRenderer as setActiveDockRailRenderer,
	getActiveRendererId as getActiveDockRailRendererId,
	resolveActive as resolveActiveDockRailRenderer,
	_resetForTests as _resetDockRailRenderersForTests,
} from './registry';

export {
	defaultDockRailRenderer,
	unwrapDefaultDock,
} from './default-renderer';

export type {
	DockRailController,
	DockRailMountDeps,
	DockRailRenderer,
} from './types';

import { register } from './registry';
import { defaultDockRailRenderer } from './default-renderer';

/**
 * Bootstrap the registry with the built-in `'default'` icon-strip
 * renderer. Idempotent — calling twice replaces the entry but
 * doesn't double up. Called from the shell boot path before any
 * plugin script runs, so plugins that want to *replace* the
 * default can register their own `id: 'default'` and override.
 */
export function installDefaultDockRailRenderer(): void {
	register( defaultDockRailRenderer );
}
