/**
 * `/workspace` — desks, from the keyboard.
 *
 * One command for one question — *which desk?* — with every answer in
 * the list: the desks that exist, then saving the main desk as a new
 * workspace, then the Workspaces app, which is where a workspace is
 * renamed, shared and deleted.
 *
 * There is no "new blank workspace" row, and no template rows either.
 * A workspace is made one way: by setting up the main desk and saving
 * it. `/save-workspace` is that act as its own command.
 */

import { registerCommand, type CommandContext } from '../commands';
import { __, sprintf } from '../i18n';
import type { WorkspaceDeps } from './manager';

/** The suggestion that clones the main desk into a new workspace. */
const SAVE_AS_LABEL = __( 'Save desk as new workspace' );
const SAVE_AS_DESCRIPTION = __(
	'Copy the main desk — its windows, widgets, apps and look — into a new workspace.',
);

/** The suggestion that opens the Workspaces app. */
const MANAGE_LABEL = __( 'Manage workspaces…' );

/**
 * "Keep this desk" — save the desk as it is into its workspace.
 *
 * Not "save layout": a layout is what `cascade` and `tile` are, and
 * this keeps more than one — the windows and where they are, the
 * widgets, the apps. Not "save workspace" either, because the
 * workspace is already saved; what is being kept is the DESK, and the
 * workspace is what it is kept into.
 */
const KEEP_LABEL = __( 'Keep this desk' );
const KEEP_DESCRIPTION = __(
	'Make this workspace open the way the desk is now — these windows where they are, these widgets, these apps.',
);

/**
 * Register `/workspace`, `/save-workspace` and `/keep-desk`.
 *
 * @param deps        Bound workspace operations.
 * @param manage      Open the Workspaces app, on a desk when one is named.
 * @param saveAs      Clone the main desk into a new workspace; `null` when
 *                    there is nothing to save (a pinned user).
 * @param save        Save a desk into its workspace.
 * @param restoreMain Put the main desk back the way a fresh install
 *                    starts it (asks first).
 */
export function registerWorkspaceCommand(
	deps: WorkspaceDeps,
	manage: ( desktopId?: string ) => void,
	saveAs: () => unknown = () => null,
	save: ( desktopId?: string ) => boolean = () => false,
	restoreMain: () => void = () => undefined,
): void {
	/** Every row the command can offer, as `{ label, run }`. */
	const entries = (): Array< {
		label: string;
		description: string;
		icon: string;
		run: () => void;
	} > => {
		const activeId = deps.manager.getActiveDesktopId();
		const countOn = ( desktopId: string ): number =>
			deps.manager
				.getAll()
				.filter(
					( w ) => ( w.config.desktopId || activeId ) === desktopId,
				).length;
		const describe = ( desktopId: string ): string => {
			if ( desktopId === activeId ) {
				return __( 'You are here' );
			}
			// translators: %d is a number of open windows.
			return sprintf( __( '%d open' ), countOn( desktopId ) );
		};
		const rows = deps.manager.getDesktops().map( ( d ) => ( {
			label: d.label,
			description: describe( d.id ),
			icon: d.profile?.icon || 'dashicons-desktop',
			run: () => deps.manager.switchDesktop( d.id ),
		} ) );

		rows.push( {
			label: SAVE_AS_LABEL,
			description: SAVE_AS_DESCRIPTION,
			icon: 'dashicons-images-alt2',
			run: () => {
				saveAs();
			},
		} );

		rows.push( {
			label: MANAGE_LABEL,
			description: __( 'Rename, share and delete workspaces, and see who uses them.' ),
			icon: 'dashicons-admin-generic',
			run: () => manage( deps.manager.getActiveDesktopId() ),
		} );

		rows.push( {
			label: KEEP_LABEL,
			description: KEEP_DESCRIPTION,
			icon: 'dashicons-saved',
			run: () => {
				save( deps.manager.getActiveDesktopId() );
			},
		} );

		return rows;
	};

	registerCommand( {
		slug: 'restore-main-desk',
		label: __( 'Restore main desk' ),
		description: __(
			'Put the main desk back the way it was when OpenStation was installed — windows, look, settings and widgets.',
		),
		icon: 'dashicons-image-rotate',
		run( _args: string, ctx: CommandContext ) {
			ctx.close();
			restoreMain();
		},
	} );

	registerCommand( {
		slug: 'save-workspace',
		label: SAVE_AS_LABEL,
		description: SAVE_AS_DESCRIPTION,
		icon: 'dashicons-images-alt2',
		run( _args: string, ctx: CommandContext ) {
			if ( ! saveAs() ) {
				return __( 'There is no desk to save.' );
			}
			ctx.close();
		},
	} );

	// Its own command as well as a row, because it is the one the user
	// reaches for while LOOKING at the desk they mean — the natural
	// moment to keep a layout is when it is in front of you, not after
	// opening a picker to find the row.
	registerCommand( {
		slug: 'keep-desk',
		label: KEEP_LABEL,
		description: KEEP_DESCRIPTION,
		icon: 'dashicons-saved',
		run( _args: string, ctx: CommandContext ) {
			if ( ! save( deps.manager.getActiveDesktopId() ) ) {
				return __( 'There is no desk to keep.' );
			}
			ctx.close();
		},
	} );

	registerCommand( {
		slug: 'workspace',
		label: __( 'Workspace' ),
		description: __( 'Switch workspace, save the main desk as one, or manage them.' ),
		hint: '[name]',
		icon: 'dashicons-desktop',

		suggest( args: string ) {
			const q = args.trim().toLowerCase();
			const list = entries();
			const hits = list.filter(
				( row ) => ! q || row.label.toLowerCase().includes( q ),
			);
			return hits.slice( 0, 12 ).map( ( row ) => ( {
				value: row.label,
				label: row.label,
				description: row.description,
				icon: row.icon,
			} ) );
		},

		run( args: string, ctx: CommandContext ) {
			const q = args.trim();
			if ( ! q ) {
				return __( 'Type a workspace name to switch to it.' );
			}
			const ql = q.toLowerCase();
			const list = entries();
			// Exact first, then substring — so a desk named exactly what
			// was typed wins over one that merely contains it.
			const match =
				list.find( ( row ) => row.label.toLowerCase() === ql ) ??
				list.find( ( row ) => row.label.toLowerCase().includes( ql ) );
			if ( ! match ) {
				return sprintf(
					// translators: %s is what the user typed.
					__(
						'No workspace matching **%s** — try `/workspace` alone to see them all.',
					),
					q,
				);
			}
			match.run();
			ctx.close();
		},
	} );
}
