/**
 * Server-driven widget registry sync.
 *
 * Symmetrical to the native-window sync (`src/native-windows.ts`):
 * plugins declare their widget metadata server-side via
 * `openstation_register_widget()`, and this module diffs the shell's
 * current registry against the fresh payload on every live refresh.
 * Removed entries unregister the def AND unmount any live instance
 * while leaving the user's enablement intact (so re-activating the
 * plugin re-mounts through the normal `hydrate()` path).
 *
 * **The plugin's bundle is not loaded to register its widget.**
 * Everything the picker shows is server-declared metadata; the only
 * thing the bundle contributes is the `mount` callback, so the def
 * is assembled from the payload and its mount loads the script on
 * first use. A widget the user has never enabled therefore costs
 * nothing but a row in the picker — which is what the nine built-in
 * widget bundles (Drafts at 46 KB, Focus Timer at 41 KB, Notes at
 * 31 KB, …) used to charge every admin page for, enabled or not.
 *
 * Widgets that register purely client-side — built-ins, or
 * plugins that call `wp.os.registerWidget()` from JS without
 * going through the PHP helper — are untouched by this sync and
 * keep their existing self-managed lifecycle.
 */

import { doAction, HOOKS } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import * as registry from './registry';
import type { DesktopWidgetServerEntry } from '../types';
import type { WidgetLayer } from './layer';
import type { WidgetDef, WidgetTeardown, WidgetContext } from './types';
import { refreshWidgetPicker } from './picker';

/** Mount callback convention: plugins register on this global. */
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

/**
 * Build a `syncServerWidgets( list )` closure bound to the shell
 * instance. Keeps per-shell state (which ids we've registered,
 * which scripts we loaded) in the closure so tests can mount
 * multiple shells in sequence cleanly.
 */
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
				// The packages this widget declares. WordPress resolves
				// a script's dependencies when it ENQUEUES it; a widget
				// bundle is delivered lazily and never goes through
				// that, so one declaring `wp-api-fetch` found
				// `wp.apiFetch` undefined at mount. Anything already on
				// the page is skipped.
				deps: entry.scriptDeps,
			} );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'widget-script-load',
				id: entry.id,
				error: err,
			} );
			// Don't mark the URL as loaded — a transient load failure
			// should be re-fetched on the next sync.
			return;
		}
		loadedScripts.add( entry.scriptUrl );
	};

	const readMount = ( id: string ): MountCallback | null => {
		const globals =
			( window as unknown as WidgetGlobals ).openStationWidgets || {};
		return globals[ id ] ?? null;
	};

	/**
	 * Build the def from server metadata alone.
	 *
	 * Everything the picker shows — label, description, icon, size
	 * constraints — is declared in PHP, so the only thing the
	 * plugin's bundle contributes is `mount`. That makes the whole
	 * def buildable without the script, and the mount here loads it
	 * on first use and delegates.
	 *
	 * This is the entire deferral for widgets: the picker lists a
	 * widget the user has never enabled without downloading a byte
	 * of it, and a widget they HAVE enabled pulls its bundle in when
	 * the layer mounts it. `mountIfEnabled()` runs right after
	 * registration, so an enabled widget still lands on screen in
	 * the same beat.
	 */
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
					// Script declared but didn't register a callback —
					// surface the mismatch to the plugin author. The
					// layer's failure handling paints the card's error
					// state from the throw.
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
		// Refresh the picker so the new widget shows up in its
		// available list right away. If the user had this widget
		// in their enabled list (from a prior activation or an
		// earlier session), `mountIfEnabled` brings it back on
		// screen — without opting a first-time user in automatically.
		refreshWidgetPicker();
		if ( layer ) {
			layer.mountIfEnabled( entry.id );
		}
	};

	const unregisterEntry = ( id: string ): void => {
		if ( ! registered.has( id ) ) {
			return;
		}
		// Tear down the visible mount (if any) BEFORE dropping the
		// def. `layer.unmount` keeps `enabledIds` intact, so when
		// the plugin re-activates the widget re-mounts through
		// hydrate().
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

		// Removals first so a stale def is gone before a same-id
		// re-register can collide.
		for ( const id of Array.from( registered ) ) {
			if ( ! incoming.has( id ) ) {
				unregisterEntry( id );
			}
		}

		// Additions — serialised so a shared vendor bundle doesn't
		// race to define globals.
		for ( const entry of list ) {
			if ( ! registered.has( entry.id ) ) {
				await registerEntry( entry );
			}
		}
	};
}
