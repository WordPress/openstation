import { doAction, HOOKS } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import * as registry from './registry';
import type { DesktopWidgetServerEntry } from '../types';
import type { WidgetLayer } from './layer';
import type { WidgetDef, WidgetTeardown, WidgetContext } from './types';
import { refreshWidgetPicker } from './picker';

type MountCallback = (
	container: HTMLElement,
	ctx: WidgetContext,
) => WidgetTeardown | Promise< WidgetTeardown >;

interface WidgetGlobals {
	openStationWidgets?: Record< string, MountCallback | undefined >;
}

export interface WidgetRegistrySyncDeps {
	layer: WidgetLayer | null;
}

export function createWidgetRegistrySync(
	deps: WidgetRegistrySyncDeps,
): ( list: DesktopWidgetServerEntry[] ) => Promise< void > {
	const { layer } = deps;

	const registered = new Set< string >();
	const loadedScripts = new Set< string >();

	const ensureScript = async (
		entry: DesktopWidgetServerEntry,
	): Promise< void > => {
		if ( ! entry.scriptUrl || loadedScripts.has( entry.scriptUrl ) ) {
			return;
		}
		try {
			await loadVendorScript( entry.scriptUrl, {
				translations: entry.scriptTranslations,
				l10n: entry.scriptL10n,
				before: entry.scriptBefore,
				after: entry.scriptAfter,

				deps: entry.scriptDeps,
			} );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'widget-script-load',
				id: entry.id,
				error: err,
			} );

			return;
		}
		loadedScripts.add( entry.scriptUrl );
	};

	const readMount = ( id: string ): MountCallback | null => {
		const globals =
			( window as unknown as WidgetGlobals ).openStationWidgets || {};
		return globals[ id ] ?? null;
	};

	const buildDefFromEntry = ( entry: DesktopWidgetServerEntry ): WidgetDef => {
		return {
			id: entry.id,
			label: entry.label,
			description: entry.description,
			icon: entry.icon,
			movable: entry.movable,
			resizable: entry.resizable,
			minWidth: entry.minWidth || undefined,
			minHeight: entry.minHeight || undefined,
			maxWidth: entry.maxWidth || undefined,
			maxHeight: entry.maxHeight || undefined,
			defaultWidth: entry.defaultWidth || undefined,
			defaultHeight: entry.defaultHeight || undefined,
			mount: async ( container, mountCtx ) => {
				await ensureScript( entry );
				const mount = readMount( entry.id );
				if ( ! mount ) {
					const error = new Error(
						`[openstation] No mount callback on window.openStationWidgets["${ entry.id }"]. Plugin script loaded but didn't register. Check the plugin's enqueue + global assignment.`,
					);
					doAction( HOOKS.SHELL_ERROR, {
						scope: 'widget-missing-mount',
						id: entry.id,
						error,
					} );
					throw error;
				}
				return mount( container, mountCtx );
			},
		};
	};

	const registerEntry = async (
		entry: DesktopWidgetServerEntry,
	): Promise< void > => {
		if ( registered.has( entry.id ) ) {
			return;
		}
		const def = buildDefFromEntry( entry );
		try {
			registry.register( def );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'widget-register',
				id: entry.id,
				error: err,
			} );
			return;
		}
		registered.add( entry.id );

		refreshWidgetPicker();
		if ( layer ) {
			layer.mountIfEnabled( entry.id );
		}
	};

	const unregisterEntry = ( id: string ): void => {
		if ( ! registered.has( id ) ) {
			return;
		}

		layer?.unmount( id );
		registry.unregister( id );
		registered.delete( id );
		refreshWidgetPicker();
	};

	return async ( list ) => {
		const incoming = new Set< string >();
		for ( const entry of list ) {
			incoming.add( entry.id );
		}

		for ( const id of Array.from( registered ) ) {
			if ( ! incoming.has( id ) ) {
				unregisterEntry( id );
			}
		}

		for ( const entry of list ) {
			if ( ! registered.has( entry.id ) ) {
				await registerEntry( entry );
			}
		}
	};
}
