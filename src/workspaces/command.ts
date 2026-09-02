/**
 * `/workspace` — the switcher, from the keyboard.
 *
 * The pill at the desk's top-leading corner is the discoverable route
 * and it sits under the window layer, which is the right trade for a
 * floating affordance and the wrong one for the only way in. This
 * command is the other route: ⌘K, type, Enter, and the desk changes
 * whatever is maximized over the pill.
 *
 * One command rather than three (`/workspace`, `/workspace-new`,
 * `/workspace-edit`) because they are one question — *which desk?* —
 * and the answer list is short enough to hold every option: the desks
 * that exist, the templates that could become one, and the editor.
 */

import { registerCommand, type CommandContext } from '../commands';
import { __, sprintf } from '../i18n';
import { createWorkspace, type WorkspaceDeps } from './manager';
import { listWorkspacePresets } from './presets';

/** Prefix marking a suggestion as "make a desk from this template". */
const NEW_PREFIX = 'New: ';

/** The suggestion that opens the wizard on the current desk. */
const EDIT_LABEL = __( 'Edit this workspace…' );

/** The suggestion that opens the wizard to make a desk. */
const NEW_LABEL = __( 'New desktop…' );

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
 * Register `/workspace`.
 *
 * @param deps   Bound workspace operations.
 * @param edit   Open the wizard on a desktop.
 * @param create Open the wizard to make a desk.
 * @param save   Save a desk into its workspace.
 */
export function registerWorkspaceCommand(
	deps: WorkspaceDeps,
	edit: ( desktopId: string ) => void,
	create: () => void = () => undefined,
	save: ( desktopId?: string ) => boolean = () => false,
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

		for ( const preset of listWorkspacePresets() ) {
			rows.push( {
				label: `${ NEW_PREFIX }${ preset.label }`,
				description: preset.description,
				icon: preset.icon,
				run: () => {
					createWorkspace( deps, { preset: preset.id } );
				},
			} );
		}

		rows.push( {
			label: NEW_LABEL,
			description: __( 'Blank, or set up for a job — the wizard asks.' ),
			icon: 'dashicons-plus-alt2',
			run: create,
		} );

		rows.push( {
			label: EDIT_LABEL,
			description: __( 'Name, apps, widgets, look and windows.' ),
			icon: 'dashicons-admin-generic',
			run: () => edit( deps.manager.getActiveDesktopId() ),
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
		description: __( 'Switch, create or edit a workspace.' ),
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
				return __(
					'Type a workspace name to switch to it, or pick a template to create one.',
				);
			}
			const ql = q.toLowerCase();
			const list = entries();
			// Exact first, then substring — so "/workspace woo" lands on
			// the Commerce desk rather than on "New: Commerce" when
			// both exist.
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
