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

export function installDefaultDockRailRenderer(): void {
	register( defaultDockRailRenderer );
}
