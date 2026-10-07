import { applyFilters } from './hooks';
import {
	registerCommand,
	type CommandContext,
	type CommandSuggestion,
	type DesktopCommand,
} from './commands';
import type { DockItemConfig, DesktopConfig } from './types';

export interface OpenableWindow {

	id: string;

	label: string;

	description?: string;

	icon?: string;

	open: () => void;
}

interface WindowManagerLite {
	open( cfg: {
		id?: string;
		baseId?: string;
		url: string;
		title: string;
		icon?: string;
	} ): unknown;
}

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

const openCommand: DesktopCommand = {
	slug: 'open',
	label: 'Open',
	description: 'Open an admin page or registered window.',
	hint: '[window]',
	icon: 'dashicons-external',

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
	},
};

export function registerBuiltInCommands(): void {
	registerCommand( openCommand );
}
