/**
 * Default dock rail renderer — wraps the shipped `Dock` class.
 *
 * The icon-strip renderer that ships with the shell. Plugin authors
 * can crib from this file to write their own — the key insight is
 * that the renderer is just a thin adapter between the
 * {@link DockRailRenderer} contract and whatever painting code
 * actually owns the rail's DOM. Our painting code lives in `Dock`;
 * a "ring" renderer's painting code might live in a single
 * 200-line file.
 *
 * The default renderer ignores the routing callbacks
 * (`openItem` / `openSystemItem` / `requestSubmenu`) because the
 * `Dock` class wires the equivalent behaviour itself — the
 * callbacks are there for custom renderers that don't want to
 * re-implement window-manager plumbing.
 */

import { Dock } from '../dock';
import type {
	DockRailController,
	DockRailMountDeps,
	DockRailRenderer,
} from './types';

/**
 * Internal escape hatch: the default renderer's controller exposes
 * the underlying `Dock` instance via this non-enumerable property
 * so the layout dispatcher can keep `wp.desktop.dock` /
 * `wp.desktop.sideDock` typed as `Dock | null` (backwards compat
 * with the documented public API). Custom renderers MUST NOT set
 * this property — the dispatcher checks for it before using it,
 * and a plugin pretending to be the default renderer with a fake
 * dock would silently break the public API.
 *
 * @internal
 */
export const DEFAULT_RENDERER_DOCK = Symbol.for(
	'desktop-mode/default-dock-rail-renderer/dock',
);

export interface DefaultRendererController extends DockRailController {
	readonly [ DEFAULT_RENDERER_DOCK ]: Dock;
}

export const defaultDockRailRenderer: DockRailRenderer = {
	id: 'default',
	label: 'Icon strip',
	description:
		'The shipped baseline — icon tiles with badges, tooltips, multi-instance chips, and attention animations.',
	icon: 'dashicons-menu-alt',
	apiVersion: 1,
	mount( deps: DockRailMountDeps ): DockRailController {
		const dock = new Dock(
			deps.container,
			deps.windowManager,
			deps.items,
			deps.adminUrl,
			deps.orientation,
		);
		const controller: DefaultRendererController = {
			[ DEFAULT_RENDERER_DOCK ]: dock,
			replaceItems: ( items ) => dock.replaceItems( items ),
			appendSystemItem: ( item ) => dock.appendSystemItem( item ),
			removeSystemItem: ( id ) => dock.removeSystemItem( id ),
			setBadge: ( itemId, count ) => dock.setBadge( itemId, count ),
			setAttention: ( itemId, mode, opts ) =>
				dock.setAttention( itemId, mode, opts ),
			setOrientation: ( orientation ) =>
				dock.setOrientation( orientation ),
			destroy: () => dock.destroy(),
		};
		return controller;
	},
};

/**
 * Recover the underlying `Dock` instance from a controller produced
 * by the default renderer. Returns `null` for any other renderer's
 * controller. Used by the layout dispatcher to keep
 * `wp.desktop.dock` typed as `Dock | null`.
 *
 * @internal
 */
export function unwrapDefaultDock(
	controller: DockRailController | null,
): Dock | null {
	if ( ! controller ) {
		return null;
	}
	const probe = controller as DefaultRendererController;
	const dock = probe[ DEFAULT_RENDERER_DOCK ];
	return dock instanceof Dock ? dock : null;
}
