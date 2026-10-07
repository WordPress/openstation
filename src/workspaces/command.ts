import { registerCommand, type CommandContext } from '../commands';
import { __, sprintf } from '../i18n';
import { createWorkspace, type WorkspaceDeps } from './manager';
import { listWorkspacePresets } from './presets';

const NEW_PREFIX = 'New: ';

const EDIT_LABEL = __( 'Edit this workspace…' );

const NEW_LABEL = __( 'New workspace…' );

const KEEP_LABEL = __( 'Keep this desk' );
const KEEP_DESCRIPTION = __(
	'Make this workspace open the way the desk is now — these windows where they are, these widgets, these apps.',
);

export function registerWorkspaceCommand(
	deps: WorkspaceDeps,
	edit: ( desktopId: string ) => void,
	create: () => void = () => undefined,
	save: ( desktopId?: string ) => boolean = () => false,
): void {
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

			const match =
				list.find( ( row ) => row.label.toLowerCase() === ql ) ??
				list.find( ( row ) => row.label.toLowerCase().includes( ql ) );
			if ( ! match ) {
				return sprintf(

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
