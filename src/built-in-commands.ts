/**
 * Built-in slash-commands shipped by the shell.
 *
 * Registered once at init time via {@link registerBuiltInCommands}.
 * Currently one command:
 *
 *   /open [window]  — autocompletes from every dock item plus any
 *                     entry plugins contribute via the
 *                     `os.open-command.items` filter. Picking
 *                     a suggestion opens the matching window.
 *
 * Keeping this in a separate module from `commands.ts` (which holds the
 * registry primitives) means the registry stays dependency-free — it
 * never has to reach into the shell config or window manager.
 */

import { applyFilters } from './hooks';
import {
	registerCommand,
	type CommandContext,
	type CommandSuggestion,
	type DesktopCommand,
} from './commands';
import type { DockItemConfig, DesktopConfig } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * An openable window surfaced by the `/open` command. Either
 * `os.open-command.items` subscribers contribute these, or
 * the built-in collector derives them from `config.dockItems`.
 */
export interface OpenableWindow {
	/** Stable id — used for exact-match fallback in `run()`. */
	id: string;
	/** Human label, also what the user sees in the autocomplete. */
	label: string;
	/** Dim secondary text in the autocomplete list. */
	description?: string;
	/** Dashicon class. */
	icon?: string;
	/**
	 * Actually open the window. Called when the user selects this
	 * entry in the `/open` autocomplete and presses Enter.
	 */
	open: () => void;
}

/** Minimal shape of the window manager we use. */
interface WindowManagerLite {
	open( cfg: {
		id?: string;
		baseId?: string;
		url: string;
		title: string;
		icon?: string;
	} ): unknown;
}

// ---------------------------------------------------------------------------
// Collect openables
// ---------------------------------------------------------------------------

/**
 * Build the list of openable windows the `/open` command offers.
 *
 * Starts with every admin-menu entry the shell already knows about
 * (dock items), then runs it through the
 * `os.open-command.items` filter so plugins can prepend,
 * append, or replace entries. Example (plugin JS):
 *
 * ```js
 * wp.hooks.addFilter(
 *     'os.open-command.items',
 *     'my-plugin',
 *     ( items ) => [
 *         ...items,
 *         {
 *             id: 'jorvy',
 *             label: 'Jorvy',
 *             description: 'Marvel quotes',
 *             icon: 'dashicons-star-filled',
 *             open: () => wp.os.windowManager.focus( 'jorvy' ),
 *         },
 *     ],
 * );
 * ```
 *
 * Re-evaluated every time `/open`'s `suggest()` fires so menu changes
 * (plugin activation, live refresh) are picked up automatically —
 * no subscription wiring needed.
 */
function collectOpenables(): OpenableWindow[] {
	const desktop = ( window as unknown as {
		wp?: {
			os?: {
				config?: DesktopConfig;
				windowManager?: WindowManagerLite;
			};
		};
	} ).wp?.os;

	if ( ! desktop ) {
		return [];
	}

	const wm = desktop.windowManager;
	const config = desktop.config;
	if ( ! wm || ! config ) {
		return [];
	}

	const items: OpenableWindow[] = [];

	const fromMenu = ( item: DockItemConfig, group: string ) => ( {
		id: item.id,
		label: item.title,
		description: group,
		icon: item.icon,
		open: () =>
			wm.open( {
				id: item.id,
				baseId: item.id,
				url: item.url,
				title: item.title,
				icon: item.icon,
			} ),
	} );

	for ( const item of config.dockItems ?? [] ) {
		items.push( fromMenu( item, 'Admin menu' ) );
	}

	const filtered = applyFilters< OpenableWindow[], unknown[] >(
		'os.open-command.items',
		items,
	);
	return Array.isArray( filtered ) ? filtered : items;
}

// ---------------------------------------------------------------------------
// /open command definition
// ---------------------------------------------------------------------------

const openCommand: DesktopCommand = {
	slug: 'open',
	label: 'Open',
	description: 'Open an admin page or registered window.',
	hint: '[window]',
	icon: 'dashicons-external',

	/**
	 * Suggest matching windows as the user types args. Simple
	 * case-insensitive substring match against label AND id so
	 * "add" finds "Add New Post" and "jorvy" finds Jorvy whether
	 * the plugin listed it with a friendly label or the slug.
	 */
	suggest( args: string ): CommandSuggestion[] {
		const q = args.trim().toLowerCase();
		const list = collectOpenables();
		const hits = q === ''
			? list
			: list.filter(
				( w ) =>
					w.label.toLowerCase().includes( q ) ||
					w.id.toLowerCase().includes( q ),
			);
		return hits.slice( 0, 12 ).map( ( w ) => ( {
			value: w.label,
			label: w.label,
			description: w.description,
			icon: w.icon ?? 'dashicons-external',
		} ) );
	},

	run( args: string, ctx: CommandContext ) {
		const q = args.trim();
		if ( ! q ) {
			return 'Type the name of a window to open, for example `/open Posts`.';
		}
		const list = collectOpenables();
		const ql = q.toLowerCase();

		// Exact label or id match first, then case-insensitive substring
		// fallback so "/open post" opens the first "post"-y window rather
		// than complaining about no exact hit.
		const match =
			list.find( ( w ) => w.label.toLowerCase() === ql || w.id.toLowerCase() === ql ) ??
			list.find(
				( w ) =>
					w.label.toLowerCase().includes( ql ) ||
					w.id.toLowerCase().includes( ql ),
			);

		if ( ! match ) {
			return `No window matching **${ q }** — try \`/open\` alone to see available options.`;
		}

		match.open();
		ctx.close();
		// Return void for silent success — the window opening is
		// feedback enough.
	},
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Register every built-in command. Called once from `desktop.ts` after
 * the public API has been mounted.
 */
export function registerBuiltInCommands(): void {
	registerCommand( openCommand );
}
