/**
 * Server-driven widget registry sync.
 *
 * Symmetrical to the native-window sync (`src/native-windows.ts`):
 * plugins declare their widget metadata server-side via
 * `desktop_mode_register_widget()`, and this module diffs the shell's
 * current registry against the fresh payload on every live refresh.
 * New entries trigger dynamic script loading so the plugin's mount
 * callback (`window.wpDesktopWidgets[ id ]`) becomes available
 * without reloading the shell; removed entries unregister the def
 * AND unmount any live instance while leaving the user's
 * enablement intact (so re-activating the plugin re-mounts through
 * the normal `hydrate()` path).
 *
 * Widgets that register purely client-side — built-ins, or
 * plugins that call `wp.desktop.registerWidget()` from JS without
 * going through the PHP helper — are untouched by this sync and
 * keep their existing self-managed lifecycle.
 *
 * @since 0.10.0
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
	wpDesktopWidgets?: Record< string, MountCallback | undefined >;
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
			await loadVendorScript( entry.scriptUrl );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'widget-script-load',
				id: entry.id,
				error: err,
			} );
		}
		loadedScripts.add( entry.scriptUrl );
	};

	const buildDefFromEntry = ( entry: DesktopWidgetServerEntry ): WidgetDef | null => {
		const globals =
			( window as unknown as WidgetGlobals ).wpDesktopWidgets || {};
		const mount = globals[ entry.id ];
		if ( ! mount ) {
			// Script declared but didn't register a callback — log
			// so the plugin author sees the mismatch. Don't
			// register the def (picker can't usefully show a
			// no-op widget).
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'widget-missing-mount',
				id: entry.id,
				error: new Error(
					`[wp-desktop-mode] No mount callback on window.wpDesktopWidgets["${ entry.id }"]. Plugin script loaded but didn't register. Check the plugin's enqueue + global assignment.`,
				),
			} );
			return null;
		}
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
			mount,
		};
	};

	const registerEntry = async (
		entry: DesktopWidgetServerEntry,
	): Promise< void > => {
		if ( registered.has( entry.id ) ) {
			return;
		}
		await ensureScript( entry );
		const def = buildDefFromEntry( entry );
		if ( ! def ) {
			// Missing mount callback — retry on the next sync fire
			// in case the plugin script is slow-loading. Don't
			// mark as registered so the next payload attempt tries
			// again.
			return;
		}
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
