import { Dock } from '../dock';
import type {
	DockRailController,
	DockRailMountDeps,
	DockRailRenderer,
} from './types';

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
			setZones: ( zones ) => dock.setZones( zones ),
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
