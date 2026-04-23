/**
 * Server-driven command-palette sync.
 *
 * Mirrors `src/widgets/server-sync.ts` and `src/wallpapers/server-sync.ts`
 * for the command registry. Plugins opt in server-side with
 * `wp_desktop_register_command_script()` (and optionally
 * `wp_register_desktop_command()`); this module receives the list of
 * registered script URLs on every live refresh (plugins.php bridge or
 * boot-time from `config`) and:
 *
 *   - Injects each new `scriptUrl` into the shell page via
 *     `loadVendorScript`. The plugin's JS runs and calls
 *     `wp.desktop.registerCommand()` as normal. The command registry's
 *     existing `subscribeCommands` fan-out repaints any open palette —
 *     no palette-specific wiring needed here.
 *
 *   - On deactivation (a previously-seen `handle` is missing from the
 *     incoming payload), unregisters every command attributable to
 *     that handle. Attribution comes from two sources, unioned:
 *       1. The `owner` field set by the plugin's JS when calling
 *          `registerCommand({ …, owner: 'my-script-handle' })`.
 *       2. The slug↔handle mapping captured from the *previous*
 *          `serverCommands` payload. Plugins that declare their
 *          metadata via `wp_register_desktop_command()` with a
 *          `script` arg get this for free — no JS change required.
 *
 *     Plugins using neither mechanism keep their commands until the
 *     next page reload (graceful backwards-compat).
 *
 * We deliberately do NOT remove the `<script>` tag from the DOM on
 * deactivation: code that's been evaluated cannot be un-evaluated, so
 * the cleanup is a best-effort scope to the registry rather than the
 * runtime. Re-activating the plugin re-registers commands on the next
 * full page load through the usual enqueue path.
 *
 * @since 0.15.0
 */

import { doAction, HOOKS } from './../hooks';
import { loadVendorScript } from './../wallpapers/vendor-loader';
import { listCommands, unregisterCommand } from './../commands';
import type {
	DesktopCommandScriptServerEntry,
	DesktopCommandServerEntry,
} from './../types';

export function createCommandRegistrySync(): (
	scripts: DesktopCommandScriptServerEntry[],
	commands?: DesktopCommandServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();
	// Snapshot of the previous payload's slug↔handle mapping, used to
	// look up slugs declared by a handle that's about to leave.
	let prevSlugsByHandle = new Map< string, Set< string > >();

	const ensureScript = async (
		entry: DesktopCommandScriptServerEntry,
	): Promise< void > => {
		if ( ! entry.scriptUrl || loadedUrls.has( entry.scriptUrl ) ) {
			loadedHandles.add( entry.handle );
			return;
		}
		try {
			await loadVendorScript( entry.scriptUrl );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'command-script-load',
				handle: entry.handle,
				url: entry.scriptUrl,
				error: err,
			} );
			return;
		}
		loadedUrls.add( entry.scriptUrl );
		loadedHandles.add( entry.handle );
	};

	const slugsByHandleFrom = (
		commands: DesktopCommandServerEntry[] | undefined,
	): Map< string, Set< string > > => {
		const map = new Map< string, Set< string > >();
		if ( ! commands ) {
			return map;
		}
		for ( const entry of commands ) {
			if ( ! entry.scriptHandle || ! entry.slug ) {
				continue;
			}
			let set = map.get( entry.scriptHandle );
			if ( ! set ) {
				set = new Set< string >();
				map.set( entry.scriptHandle, set );
			}
			set.add( entry.slug );
		}
		return map;
	};

	const collectSlugsToRemove = (
		handle: string,
	): Set< string > => {
		const slugs = new Set< string >();
		// (B) owner-tagged JS registrations.
		for ( const cmd of listCommands() ) {
			if ( cmd.owner === handle ) {
				slugs.add( cmd.slug );
			}
		}
		// (A) PHP-declared metadata from the last known payload.
		const declared = prevSlugsByHandle.get( handle );
		if ( declared ) {
			for ( const slug of declared ) {
				slugs.add( slug );
			}
		}
		return slugs;
	};

	return async ( scripts, commands ) => {
		const incomingHandles = new Set< string >();
		for ( const entry of scripts ) {
			if ( entry.handle ) {
				incomingHandles.add( entry.handle );
			}
		}

		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			for ( const slug of collectSlugsToRemove( handle ) ) {
				unregisterCommand( slug );
			}
			loadedHandles.delete( handle );
		}

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}

		// Refresh the metadata snapshot AFTER processing removals so
		// `collectSlugsToRemove` reads the previous mapping, not the
		// new (post-deactivation) one.
		prevSlugsByHandle = slugsByHandleFrom( commands );
	};
}
