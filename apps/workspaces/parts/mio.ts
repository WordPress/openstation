/**
 * MIO in the Workspaces window — build and edit workspaces by asking.
 *
 * "A workspace for my users with the posts list on the left half, Add
 * New Post in the top right and Orders in the bottom right" becomes a
 * `create_workspace` call with three windows on the 6 × 6 grid.
 *
 * Every action here is WINDOW-SCOPED: registered on this window's MIO
 * lease, offered to the model only while the Workspaces window is the
 * one being talked to, never registered as a WordPress ability. Writes
 * go through `wp.os.workspaces` — the same calls the window's own
 * buttons make — and every argument is validated again before it runs.
 * Nothing destructive is offered: no delete, no links, no recipients.
 */

import type {
	MioAbility,
	MioDocument,
	MioOperation,
	MioResponseAction,
	MioWindowLease,
} from '../../../src/mio/assistant/types';
import type { NavItem } from '../../../src/nav/types';
import type { Desktop, GridSpan } from '../../../src/types';
import type { WorkspaceLaunch, WorkspaceProfile } from '../../../src/workspaces/types';
import type { WorkspacesApi } from '../../../src/workspaces/api';
import { workspaceAppCatalog, type WorkspaceApp } from '../../../src/workspaces/match';
import help from '../help/index.md?raw';
import { newNoteId } from '../../../src/workspaces/notes';
import {
	acceptStep,
	currentStep,
	draftProfile,
	newDraft,
	proposeApps,
	proposeLayout,
	proposeNotes,
	proposeWidgets,
	type DraftStep,
	type WorkspaceDraft,
} from './draft';

/** The grid every workspace window is placed on. */
export const GRID = 6;

/** Named places on the grid: column, row, columns spanned, rows spanned. */
export const POSITIONS: Readonly< Record< string, readonly [ number, number, number, number ] > > = {
	full: [ 0, 0, 6, 6 ],
	'left-half': [ 0, 0, 3, 6 ],
	'right-half': [ 3, 0, 3, 6 ],
	'top-half': [ 0, 0, 6, 3 ],
	'bottom-half': [ 0, 3, 6, 3 ],
	'top-left': [ 0, 0, 3, 3 ],
	'top-right': [ 3, 0, 3, 3 ],
	'bottom-left': [ 0, 3, 3, 3 ],
	'bottom-right': [ 3, 3, 3, 3 ],
	'left-third': [ 0, 0, 2, 6 ],
	'center-third': [ 2, 0, 2, 6 ],
	'right-third': [ 4, 0, 2, 6 ],
	'left-two-thirds': [ 0, 0, 4, 6 ],
	'right-two-thirds': [ 2, 0, 4, 6 ],
};

/** The glyphs MIO may choose from — the same set the cards offer. */
const ICONS = [
	'dashicons-desktop',
	'dashicons-cart',
	'dashicons-edit-page',
	'dashicons-format-image',
	'dashicons-admin-users',
	'dashicons-chart-bar',
	'dashicons-admin-comments',
	'dashicons-welcome-learn-more',
	'dashicons-megaphone',
	'dashicons-portfolio',
	'dashicons-groups',
	'dashicons-sos',
];

/** What the prompt and the buttons need from the window. */
export interface WorkspacesMioHost {
	host: HTMLElement;
	windowId: string;
	/** The workspace the chat was opened on, or ''. */
	target: () => string;
}

interface Shell {
	workspaces?: WorkspacesApi;
	getNavItems?: () => NavItem[];
	config?: { adminUrl?: string };
	mio?: {
		registerWindow?: ( id: string, context: Record< string, unknown > ) => MioWindowLease;
	};
}

function shell(): Shell {
	return ( window.wp?.os ?? {} ) as unknown as Shell;
}

function adminUrl(): string {
	return (
		shell().config?.adminUrl ??
		( window as unknown as { openStationConfig?: { adminUrl?: string } } ).openStationConfig?.adminUrl ??
		''
	);
}

/** One app MIO can put on a desk. */
export interface MioApp {
	id: string;
	title: string;
	icon: string;
	/**
	 * Its screens, admin-relative: the main page first, then its tabs.
	 * Empty for an app that is a window of its own.
	 */
	pages: Array< { title: string; url: string } >;
	/** True when it opens as a window of its own rather than a page. */
	window: boolean;
	/** Whether it has a dock icon a workspace can keep. */
	dock: boolean;
}

/**
 * Every app a workspace can use on this site, native or not — the
 * shell's catalogue (`wp.os.workspaces.apps()`): admin menus with their
 * tabs, plugin launchers, desktop icons, Trash, and the native apps
 * with no menu of their own. `items` scans a given navigation instead
 * (tests, or a shell without the catalogue).
 */
export function scanApps( items?: readonly NavItem[] ): MioApp[] {
	const catalogue = items ? null : shell().workspaces?.apps?.();
	const source: WorkspaceApp[] =
		catalogue && catalogue.length
			? catalogue
			: workspaceAppCatalog( items ?? shell().getNavItems?.() ?? [], [], new Set(), adminUrl() );
	return source.map( ( app ) => ( {
		id: app.id,
		title: app.title,
		icon: app.icon,
		pages: app.pages,
		window: ! app.pages.length,
		dock: app.dock,
	} ) );
}

/** A position or explicit cells, as the grid span a workspace stores. */
export function toGridSpan( window: { position?: unknown; cells?: unknown } ): GridSpan | null {
	let box: readonly [ number, number, number, number ] | null = null;
	if ( 'string' === typeof window.position && POSITIONS[ window.position ] ) {
		box = POSITIONS[ window.position ];
	} else if ( window.cells && 'object' === typeof window.cells ) {
		const c = window.cells as Record< string, unknown >;
		const n = [ c.col, c.row, c.cols, c.rows ];
		if ( n.every( ( v ) => Number.isInteger( v ) ) ) {
			box = n as unknown as [ number, number, number, number ];
		}
	}
	if ( ! box ) {
		return null;
	}
	const [ col, row, cols, rows ] = box;
	if ( col < 0 || row < 0 || cols < 1 || rows < 1 || col + cols > GRID || row + rows > GRID ) {
		return null;
	}
	return {
		anchor: { col, row },
		cursor: { col: col + cols - 1, row: row + rows - 1 },
		cols: GRID,
		rows: GRID,
	};
}

/** Where a stored window sits, in the words the model uses. */
function describeSpan( span: GridSpan | undefined ): string {
	if ( ! span ) {
		return 'unplaced';
	}
	const box = [ span.anchor.col, span.anchor.row, span.cursor.col - span.anchor.col + 1, span.cursor.row - span.anchor.row + 1 ];
	const named = Object.entries( POSITIONS ).find( ( [ , p ] ) => p.every( ( v, i ) => v === box[ i ] ) );
	return named ? named[ 0 ] : `cells col ${ box[ 0 ] } row ${ box[ 1 ] }, ${ box[ 2 ] }×${ box[ 3 ] }`;
}

// -------------------------------------------------------------- schema

const WINDOW_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: [ 'app' ],
	properties: {
		app: { type: 'string', description: 'An app id from list_apps. On its own, the window is the app itself — what its dock icon opens, with its tabs.' },
		page: { type: 'string', description: 'Only when the user names one specific screen of the app: one of its page urls from list_apps.' },
		title: { type: 'string', maxLength: 128 },
		position: { type: 'string', enum: Object.keys( POSITIONS ) },
		cells: {
			type: 'object',
			additionalProperties: false,
			required: [ 'col', 'row', 'cols', 'rows' ],
			properties: {
				col: { type: 'integer', minimum: 0, maximum: 5 },
				row: { type: 'integer', minimum: 0, maximum: 5 },
				cols: { type: 'integer', minimum: 1, maximum: 6 },
				rows: { type: 'integer', minimum: 1, maximum: 6 },
			},
		},
	},
};

const FIELDS = {
	name: { type: 'string', minLength: 1, maxLength: 64 },
	icon: { type: 'string', enum: ICONS },
	color: { type: 'string', description: '#rrggbb, or empty for the shell accent.' },
	apps: {
		type: 'array',
		items: { type: 'string' },
		description: 'App ids from list_apps with dock: true to keep on the dock. The apps the windows use are added. Omit to keep every app.',
	},
	windows: { type: 'array', maxItems: 12, items: WINDOW_SCHEMA },
	hide_settings: { type: 'boolean', description: 'Leave out Settings, Preferences, plugins, themes, tools, users and updates.' },
};

function schema( properties: Record< string, unknown >, required: string[] = [] ): Record< string, unknown > {
	return { type: 'object', additionalProperties: false, required, properties };
}

function onlyKeys( args: Record< string, unknown >, allowed: string[] ): boolean {
	return Object.keys( args ).every( ( k ) => allowed.includes( k ) );
}

// ----------------------------------------------------------- validation

/**
 * Checks the fields both writes share against the LIVE site: app ids
 * and pages must exist here, positions must land on the grid.
 */
export function validFields( args: Record< string, unknown >, apps: readonly MioApp[] = scanApps() ): boolean {
	const byId = new Map( apps.map( ( a ) => [ a.id, a ] ) );
	if ( 'name' in args && ( 'string' !== typeof args.name || ! args.name.trim() || args.name.length > 64 ) ) {
		return false;
	}
	if ( 'icon' in args && ! ICONS.includes( args.icon as string ) ) {
		return false;
	}
	if ( 'color' in args && ! ( '' === args.color || /^#[0-9a-f]{6}$/i.test( String( args.color ) ) ) ) {
		return false;
	}
	for ( const key of [ 'apps', 'add_apps', 'remove_apps' ] ) {
		// Only an app with a dock icon can be kept on the dock.
		if ( key in args && ! ( Array.isArray( args[ key ] ) && ( args[ key ] as unknown[] ).every( ( id ) => true === byId.get( id as string )?.dock ) ) ) {
			return false;
		}
	}
	if ( 'hide_settings' in args && 'boolean' !== typeof args.hide_settings ) {
		return false;
	}
	if ( 'windows' in args ) {
		if ( ! Array.isArray( args.windows ) || args.windows.length > 12 ) {
			return false;
		}
		for ( const raw of args.windows as unknown[] ) {
			if ( ! raw || 'object' !== typeof raw ) {
				return false;
			}
			const win = raw as Record< string, unknown >;
			const app = byId.get( win.app as string );
			if (
				! app ||
				! onlyKeys( win, [ 'app', 'page', 'title', 'position', 'cells' ] ) ||
				( 'page' in win && ! app.pages.some( ( p ) => p.url === win.page ) ) ||
				( 'title' in win && 'string' !== typeof win.title ) ||
				( ( 'position' in win || 'cells' in win ) && ! toGridSpan( win ) )
			) {
				return false;
			}
		}
	}
	return true;
}

/** Validated windows, as launch entries on the grid. */
export function toLaunches( windows: unknown[], apps: readonly MioApp[] = scanApps() ): WorkspaceLaunch[] {
	const byId = new Map( apps.map( ( a ) => [ a.id, a ] ) );
	return windows.map( ( raw ) => {
		const win = raw as Record< string, unknown >;
		const app = byId.get( win.app as string )!;
		// No page named: the window is THE APP — what its dock icon
		// opens, with all its tabs — so it stores the app and nothing
		// else, and opens through the app's own URL and remap.
		const entry: WorkspaceLaunch = { match: app.id };
		const page = win.page as string | undefined;
		if ( page ) {
			entry.url = page;
		}
		entry.title =
			( win.title as string | undefined ) ??
			( page ? app.pages.find( ( p ) => p.url === page )?.title : undefined ) ??
			app.title;
		const span = toGridSpan( win );
		if ( span ) {
			entry.gridSpan = span;
		}
		return entry;
	} );
}

/**
 * Apply the shared fields onto a profile. `apps` narrows the dock to
 * those apps plus every app a window uses — a window whose app is
 * hidden would be a window the fence refuses for a pinned user.
 */
export function applyFields( base: WorkspaceProfile, args: Record< string, unknown > ): WorkspaceProfile {
	const next: WorkspaceProfile = { ...base };
	if ( 'string' === typeof args.icon ) {
		next.icon = args.icon;
	}
	if ( 'string' === typeof args.color ) {
		next.color = args.color;
	}
	if ( Array.isArray( args.windows ) ) {
		next.windows = toLaunches( args.windows );
		next.layout = 'free';
		next.provisioned = false;
	}
	let ids: string[] | null = Array.isArray( args.apps ) ? [ ...( args.apps as string[] ) ] : null;
	if ( ! ids && 'only' === base.apps.mode ) {
		ids = [ ...base.apps.ids ];
	}
	if ( ids ) {
		for ( const id of ( args.add_apps as string[] | undefined ) ?? [] ) {
			ids.push( id );
		}
		const drop = new Set( ( args.remove_apps as string[] | undefined ) ?? [] );
		ids = ids.filter( ( id ) => ! drop.has( id ) );
		for ( const win of next.windows ) {
			ids.push( win.match );
		}
		next.apps = { mode: 'only', ids: [ ...new Set( ids ) ] };
	}
	if ( 'boolean' === typeof args.hide_settings ) {
		next.restricted = args.hide_settings;
	}
	return next;
}

function summarize( desk: Desktop ): Record< string, unknown > {
	const p = desk.profile;
	return {
		desktop_id: desk.id,
		name: desk.label,
		icon: p?.icon,
		apps: p && 'only' === p.apps.mode ? p.apps.ids : 'all',
		hide_settings: !! p?.restricted,
		windows: ( p?.windows ?? [] ).map( ( w ) => ( { app: w.match, page: w.url, title: w.title, position: describeSpan( w.gridSpan ) } ) ),
	};
}

// ------------------------------------------------------------ abilities

/**
 * A confirmed write, in the shape MIO's session records as confirmed:
 * a receipt unique to this write, mapped by the window to the desk it
 * touched so a response button can name it without trusting prose.
 */
function confirmed(
	receipts: Map< string, string >,
	desktopId: string,
	data: Record< string, unknown >,
): Record< string, unknown > {
	const receipt = `workspace:${ desktopId }:${ receipts.size + 1 }`;
	receipts.set( receipt, desktopId );
	return { effect: 'write', status: 'confirmed', receipt, ...data };
}

/** A draft change: memory only, recorded as a completed no-write. */
function done( data: Record< string, unknown > ): Record< string, unknown > {
	return { effect: 'none', status: 'completed', ...data };
}

/** A refusal the model can read and recover from. */
function refused( message: string ): Record< string, unknown > {
	return {
		effect: 'none',
		status: 'rejected',
		retryable: true,
		errors: [ { code: 'step_not_ready', path: '$', message } ],
	};
}

/** Where the draft is, for the model. */
export function describeDraft( draft: WorkspaceDraft | null ): Record< string, unknown > {
	if ( ! draft ) {
		return { draft: null };
	}
	return {
		draft: {
			editing: draft.target || null,
			name: draft.name,
			step: currentStep( draft ),
			accepted: draft.accepted,
			windows: draft.windows.map( ( w ) => ( { app: w.match, page: w.url, title: w.title, position: describeSpan( w.gridSpan ) } ) ),
			dock_apps: draft.apps,
			widgets: draft.widgets,
			notes: draft.notes?.map( ( n ) => ( { text: n.text, size: n.size } ) ) ?? null,
			hide_settings: draft.hideSettings,
		},
	};
}

/** What the actions need from the window: the draft and a repaint. */
export interface DraftHost {
	get: () => WorkspaceDraft | null;
	set: ( draft: WorkspaceDraft | null ) => void;
	/** The preview repaints. */
	changed: () => void;
}

/** Every widget, as the picker lists them. */
export function listWidgets(): Array< { id: string; label: string; description: string; icon: string } > {
	return ( window.wp?.os as { widgets?: { list?: () => Array< { id: string; label: string; description: string; icon: string } > } } | undefined )?.widgets?.list?.() ?? [];
}

/**
 * Make the workspace an accepted draft describes — or save it over the
 * one it was reworking. The draft is cleared after.
 */
export function commitDraft( draft: WorkspaceDraft, receipts: Map< string, string > ): Record< string, unknown > {
	const api = shell().workspaces!;
	if ( draft.target ) {
		const desk = api.list().find( ( d ) => d.id === draft.target );
		if ( ! desk ) {
			return refused( 'The workspace being edited no longer exists.' );
		}
		if ( draft.name && draft.name !== desk.label ) {
			api.rename( desk.id, draft.name );
		}
		api.setProfile( desk.id, draftProfile( draft, desk.profile ) );
		if ( api.active()?.id === desk.id ) {
			api.provision( desk.id, { force: true } );
		}
		return confirmed( receipts, desk.id, { saved: summarize( api.list().find( ( d ) => d.id === desk.id )! ) } );
	}
	const created = api.create( { label: draft.name || 'Workspace', profile: draftProfile( draft ), activate: false } );
	return confirmed( receipts, created.id, { created: summarize( api.list().find( ( d ) => d.id === created.id ) ?? created ) } );
}

/**
 * The actions MIO is offered in this window.
 *
 * Building is three proposals, each accepted before the next — the
 * layout, the dock apps, the widgets — then the workspace is made. The
 * steps are enforced here, not left to the prompt: a proposal or the
 * final create out of order is refused with a message saying what is
 * waiting.
 *
 * @param host     The draft, and the preview's repaint.
 * @param receipts Receipt → desktop id, filled by every confirmed write.
 */
export function workspacesMioAbilities(
	host: DraftHost,
	receipts: Map< string, string > = new Map(),
): MioAbility[] {
	const api = (): WorkspacesApi => {
		const w = shell().workspaces;
		if ( ! w ) {
			throw new Error( 'Workspaces are not available.' );
		}
		return w;
	};
	const workspaceDesks = (): Desktop[] => api().list().slice( 1 ).filter( ( d ) => !! d.profile );
	const allowed = (): boolean => !! shell().workspaces && ! shell().workspaces!.isPinned();
	const widgetIds = (): string[] => listWidgets().map( ( w ) => w.id );
	const touch = ( result: Record< string, unknown > ): Record< string, unknown > => {
		host.changed();
		return result;
	};

	return [
		{
			name: 'list_apps',
			effect: 'read',
			description: 'List every app on this site, native or not (admin menus, plugin apps, Trash, OpenStation apps): id, title, its screens (pages: main page first, then its tabs) and whether it has a dock icon (dock). Read this before proposing a layout or dock apps.',
			parameters: schema( {} ),
			validate: ( args ) => onlyKeys( args, [] ),
			run: () => ( { grid: `${ GRID }x${ GRID }`, positions: Object.keys( POSITIONS ), apps: scanApps() } ),
		},
		{
			name: 'list_widgets',
			effect: 'read',
			description: 'List the widgets a workspace can put in its column: id, label, description.',
			parameters: schema( {} ),
			validate: ( args ) => onlyKeys( args, [] ),
			run: () => ( { widgets: listWidgets() } ),
		},
		{
			name: 'list_workspaces',
			effect: 'read',
			description: 'List the existing workspaces: id, name, dock apps, whether settings are hidden, and each window with its position.',
			parameters: schema( {} ),
			validate: ( args ) => onlyKeys( args, [] ),
			run: () => ( { workspaces: workspaceDesks().map( summarize ) } ),
		},
		{
			name: 'get_draft',
			effect: 'read',
			description: 'Read the draft being built: its step, what is accepted, and what the user may have changed in the preview (unticked apps or widgets). Call this at the start of every reply while a draft exists.',
			parameters: schema( {} ),
			validate: ( args ) => onlyKeys( args, [] ),
			run: () => describeDraft( host.get() ),
		},
		{
			name: 'propose_layout',
			effect: 'none',
			description: 'Step 1. Propose the windows of a workspace and where each sits on the 6x6 grid. Shows a preview the user must accept. Starts a new draft (or reworks desktop_id). Proposing again replaces the layout and resets the later steps.',
			parameters: schema(
				{
					name: FIELDS.name,
					desktop_id: { type: 'string', description: 'Rework this existing workspace instead of making a new one.' },
					icon: FIELDS.icon,
					color: FIELDS.color,
					windows: { type: 'array', minItems: 1, maxItems: 12, items: { ...WINDOW_SCHEMA, required: [ 'app' ] } },
					hide_settings: FIELDS.hide_settings,
				},
				[ 'windows' ],
			),
			validate: ( args ) =>
				onlyKeys( args, [ 'name', 'desktop_id', 'icon', 'color', 'windows', 'hide_settings' ] ) &&
				Array.isArray( args.windows ) &&
				args.windows.length > 0 &&
				( args.windows as Array< Record< string, unknown > > ).every( ( w ) => !! toGridSpan( w ) ) &&
				( ! ( 'desktop_id' in args ) || workspaceDesks().some( ( d ) => d.id === args.desktop_id ) ) &&
				validFields( args ),
			allowed,
			run: ( args ) => {
				const existing = host.get();
				const target = ( args.desktop_id as string | undefined ) ?? existing?.target ?? '';
				const desk = target ? workspaceDesks().find( ( d ) => d.id === target ) : undefined;
				const draft =
					existing && existing.target === target
						? existing
						: newDraft( {
							target,
							name: desk?.label ?? '',
							icon: desk?.profile?.icon ?? 'dashicons-desktop',
							color: desk?.profile?.color ?? '',
							hideSettings: !! desk?.profile?.restricted,
						} );
				if ( 'string' === typeof args.name && args.name.trim() ) {
					draft.name = args.name.trim();
				}
				if ( 'string' === typeof args.icon ) {
					draft.icon = args.icon;
				}
				if ( 'string' === typeof args.color ) {
					draft.color = args.color;
				}
				if ( 'boolean' === typeof args.hide_settings ) {
					draft.hideSettings = args.hide_settings;
				}
				const windows = toLaunches( args.windows as unknown[] );
				// The same layout again — MIO repeating itself after a
				// "yes" — is not a new proposal: keep every step the user
				// already accepted. Only a layout that actually changed
				// sends the draft back to step 1.
				if ( draft !== existing || JSON.stringify( windows ) !== JSON.stringify( draft.windows ) ) {
					proposeLayout( draft, windows );
				}
				host.set( draft );
				if ( 'layout' !== currentStep( draft ) ) {
					return touch( done( { ...describeDraft( draft ), next: `The layout is unchanged and still accepted. Continue with step "${ currentStep( draft ) }".` } ) );
				}
				return touch( done( { ...describeDraft( draft ), next: 'Ask the user to check the preview and accept the layout.' } ) );
			},
		},
		{
			name: 'propose_apps',
			effect: 'none',
			description: 'Step 2, after the layout is accepted. Propose which apps the dock shows (ids from list_apps). The apps the windows use are always included. The user reviews the icons and accepts.',
			parameters: schema( { apps: { type: 'array', items: { type: 'string' } } }, [ 'apps' ] ),
			validate: ( args ) => onlyKeys( args, [ 'apps' ] ) && validFields( args ),
			allowed,
			run: ( args ) => {
				const draft = host.get();
				if ( ! draft || ! proposeApps( draft, args.apps as string[] ) ) {
					return refused( 'The layout has not been accepted yet. Ask the user to accept it first.' );
				}
				return touch( done( { ...describeDraft( draft ), next: 'Ask the user to check the dock icons and accept them.' } ) );
			},
		},
		{
			name: 'propose_widgets',
			effect: 'none',
			description: 'Step 3, after the dock apps are accepted. Propose the widgets for the column (ids from list_widgets; an empty list means no widgets). The user reviews and accepts.',
			parameters: schema( { widgets: { type: 'array', items: { type: 'string' } } }, [ 'widgets' ] ),
			validate: ( args ) =>
				onlyKeys( args, [ 'widgets' ] ) &&
				Array.isArray( args.widgets ) &&
				( args.widgets as unknown[] ).every( ( id ) => widgetIds().includes( id as string ) ),
			allowed,
			run: ( args ) => {
				const draft = host.get();
				if ( ! draft || ! proposeWidgets( draft, args.widgets as string[] ) ) {
					return refused( 'The dock apps have not been accepted yet. Ask the user to accept them first.' );
				}
				return touch( done( { ...describeDraft( draft ), next: 'Ask the user to check the widgets and accept them.' } ) );
			},
		},
		{
			name: 'propose_notes',
			effect: 'none',
			description: 'Step 4, after the widgets are accepted. Propose read-only notes pinned on the desk for the people using it — a welcome, what goes where, who to ask. Use size "xl" for a longer note. An empty list means no notes. The user reviews and accepts.',
			parameters: schema(
				{
					notes: {
						type: 'array',
						maxItems: 8,
						items: {
							type: 'object',
							additionalProperties: false,
							required: [ 'text' ],
							properties: {
								text: { type: 'string', minLength: 1, maxLength: 2000 },
								size: { type: 'string', enum: [ 'normal', 'xl' ] },
								color: { type: 'string', enum: [ 'butter', 'sky', 'mint', 'blush', 'lilac', 'peach' ] },
								position: { type: 'string', enum: Object.keys( POSITIONS ), description: 'Where on the desk it hangs; defaults to the top left.' },
							},
						},
					},
				},
				[ 'notes' ],
			),
			validate: ( args ) =>
				onlyKeys( args, [ 'notes' ] ) &&
				Array.isArray( args.notes ) &&
				args.notes.length <= 8 &&
				( args.notes as Array< Record< string, unknown > > ).every(
					( n ) =>
						!! n &&
						onlyKeys( n, [ 'text', 'size', 'color', 'position' ] ) &&
						'string' === typeof n.text &&
						!! n.text.trim() &&
						n.text.length <= ( 'xl' === n.size ? 2000 : 1000 ) &&
						( ! ( 'size' in n ) || [ 'normal', 'xl' ].includes( n.size as string ) ) &&
						( ! ( 'color' in n ) || [ 'butter', 'sky', 'mint', 'blush', 'lilac', 'peach' ].includes( n.color as string ) ) &&
						( ! ( 'position' in n ) || !! POSITIONS[ n.position as string ] ),
				),
			allowed,
			run: ( args ) => {
				const draft = host.get();
				const notes = ( args.notes as Array< Record< string, unknown > > ).map( ( n, i ) => {
					const box = POSITIONS[ ( n.position as string ) ?? 'top-left' ] ?? POSITIONS[ 'top-left' ];
					return {
						id: newNoteId(),
						text: ( n.text as string ).trim(),
						size: 'xl' === n.size ? ( 'xl' as const ) : ( 'normal' as const ),
						color: ( n.color as string ) ?? [ 'butter', 'sky', 'mint', 'blush' ][ i % 4 ],
						x: Math.min( 0.9, box[ 0 ] / GRID + 0.02 + i * 0.02 ),
						y: Math.min( 0.9, box[ 1 ] / GRID + 0.04 + i * 0.02 ),
					};
				} );
				if ( ! draft || ! proposeNotes( draft, notes ) ) {
					return refused( 'The widgets have not been accepted yet. Ask the user to accept them first.' );
				}
				return touch( done( { ...describeDraft( draft ), next: 'Ask the user to check the notes and accept them.' } ) );
			},
		},
		{
			name: 'accept_step',
			effect: 'none',
			description: 'Accept the step waiting on the user — ONLY when the user has just clearly said yes to it in this chat. They can also accept with the button in the preview; read get_draft to see.',
			parameters: schema( { step: { type: 'string', enum: [ 'layout', 'apps', 'widgets', 'notes' ] } }, [ 'step' ] ),
			validate: ( args ) => onlyKeys( args, [ 'step' ] ) && [ 'layout', 'apps', 'widgets', 'notes' ].includes( args.step as string ),
			allowed,
			run: ( args ) => {
				const draft = host.get();
				// Already accepted (most often with the preview's button):
				// nothing to do, and nothing to undo — say where it is.
				if ( draft && draft.accepted[ args.step as DraftStep ] ) {
					return done( { ...describeDraft( draft ), next: `"${ String( args.step ) }" is already accepted. Continue with step "${ currentStep( draft ) }".` } );
				}
				if ( ! draft || ! acceptStep( draft, args.step as DraftStep ) ) {
					return refused( `That is not the step waiting; the draft is at "${ draft ? currentStep( draft ) : 'none' }".` );
				}
				return touch( done( describeDraft( draft ) ) );
			},
		},
		{
			name: 'create_workspace',
			effect: 'write',
			description: 'Last step: make the workspace from the draft — only when layout, dock apps, widgets and notes are all accepted. For a draft reworking an existing workspace, this saves it.',
			parameters: schema( {} ),
			validate: ( args ) => onlyKeys( args, [] ),
			allowed,
			run: () => {
				const draft = host.get();
				if ( ! draft || 'ready' !== currentStep( draft ) ) {
					return refused( `Not every step is accepted; the draft is at "${ draft ? currentStep( draft ) : 'none' }".` );
				}
				const result = commitDraft( draft, receipts );
				host.set( null );
				return touch( result );
			},
		},
		{
			name: 'update_workspace',
			effect: 'write',
			description: 'Small change to an existing workspace that needs no preview: its name, glyph, colour, hide_settings, or add_apps / remove_apps on the dock. To move windows, use propose_layout with its desktop_id.',
			parameters: schema(
				{
					desktop_id: { type: 'string' },
					name: FIELDS.name,
					icon: FIELDS.icon,
					color: FIELDS.color,
					hide_settings: FIELDS.hide_settings,
					add_apps: { type: 'array', items: { type: 'string' } },
					remove_apps: { type: 'array', items: { type: 'string' } },
				},
				[ 'desktop_id' ],
			),
			validate: ( args ) =>
				onlyKeys( args, [ 'desktop_id', 'name', 'icon', 'color', 'hide_settings', 'add_apps', 'remove_apps' ] ) &&
				workspaceDesks().some( ( d ) => d.id === args.desktop_id ) &&
				validFields( args ),
			allowed,
			run: ( args ) => {
				const w = api();
				const id = args.desktop_id as string;
				const desk = workspaceDesks().find( ( d ) => d.id === id )!;
				if ( 'string' === typeof args.name && args.name.trim() ) {
					w.rename( id, args.name.trim() );
				}
				w.setProfile( id, applyFields( desk.profile!, args ) );
				return confirmed( receipts, id, { updated: summarize( w.list().find( ( d ) => d.id === id )! ) } );
			},
		},
		{
			name: 'open_workspace',
			effect: 'none',
			description: 'Switch to a workspace desk so the user can see it.',
			parameters: schema( { desktop_id: { type: 'string' } }, [ 'desktop_id' ] ),
			validate: ( args ) =>
				onlyKeys( args, [ 'desktop_id' ] ) && workspaceDesks().some( ( d ) => d.id === args.desktop_id ),
			allowed,
			run: ( args ) => {
				api().switchTo( args.desktop_id as string );
				return done( { opened: args.desktop_id } );
			},
		},
	];
}

const DOCUMENTS: MioDocument[] = [ { id: 'index.md', title: 'Workspaces', markdown: help } ];

/**
 * Put MIO in this window. Returns the lease (null when MIO is not
 * installed), whose `dispose` the app's teardown calls.
 */
export function mountWorkspacesMio( host: WorkspacesMioHost, drafts: DraftHost ): MioWindowLease | null {
	const register = shell().mio?.registerWindow;
	if ( ! register ) {
		return null;
	}
	const receipts = new Map< string, string >();
	return register( host.windowId, {
		host: host.host,
		title: 'Workspaces',
		// Docked beside the list: the preview has to stay in view
		// while the user talks it into shape.
		chatLayout: 'side',
		prompt: () => {
			const target = host.target();
			const desk = target ? shell().workspaces?.list().find( ( d ) => d.id === target ) : undefined;
			const draft = drafts.get();
			return [
				'You are MIO inside the Workspaces window of OpenStation, a desktop for WordPress admin.',
				'You build workspaces WITH the user, one accepted step at a time, and a live preview in the window shows each proposal:',
				'1) propose_layout — the windows and where they sit on the 6x6 grid; 2) propose_apps — the dock icons; 3) propose_widgets — the widget column; 4) propose_notes — read-only notes for the people using the desk (offer a short welcome; an empty list is fine); then create_workspace.',
				'After each proposal, STOP: say in one sentence what you proposed and ask the user to check the preview and accept it (with the button there, or by saying so). Never propose the next step in the same reply.',
				'At the start of every reply while a draft exists, call get_draft: the user may have accepted with the preview button, or unticked apps or widgets there.',
				'Call accept_step only when the user has just clearly agreed in this chat. When they ask for a change instead, propose again.',
				'"I accepted the …" in the chat means the user pressed Accept in the preview: that step is done — do not accept it again and never re-propose it. Go straight to proposing the next step.',
				'Never go back to an earlier step on your own: re-propose a step only when the user asks to change it. A step that is accepted stays accepted.',
				'Before proposing apps, call list_apps; before proposing widgets, call list_widgets. Suggest a sensible set for the job, and ask which the user wants when it is not obvious.',
				'Map words to positions: "left half" is left-half, "top right" top-right, "last quadrant" or "bottom right" bottom-right; exact cells only when no name fits.',
				'An app is what its dock icon opens. "The posts app on the left" is the Posts app itself — the window with All Posts, Add Post, Categories and Tags as its tabs — so give just the app, no page. Give a page only when the user names one specific screen ("Add new post" is post-new.php).',
				'list_apps is every app on this site, native or not — admin menus, plugin apps, Trash, OpenStation apps like Preferences. Any of them can be a window; only apps with dock: true can be dock icons. System, Workspaces and MIO are on every dock already. If something is not in list_apps, say it is not on this site instead of guessing.',
				'You cannot delete workspaces, change share links or release people.',
				desk
					? `The chat was opened on the workspace "${ desk.label }" (desktop_id ${ desk.id }): rework it with propose_layout and its desktop_id, or use update_workspace for small changes.`
					: 'No workspace is selected: a request describes a new workspace.',
				draft ? `A draft exists and is at step "${ currentStep( draft ) }".` : 'There is no draft yet.',
				'Be brief and warm.',
			].join( ' ' );
		},
		documents: DOCUMENTS,
		abilities: () => workspacesMioAbilities( drafts, receipts ),
		// A button to the desk this turn actually wrote — from its
		// confirmed receipts, never from what the reply says.
		responseActions: ( context: { operations: readonly MioOperation[] } ): MioResponseAction[] => {
			const written = [ ...context.operations ]
				.reverse()
				.find( ( op ) => 'confirmed' === op.status && op.receipt && receipts.has( op.receipt ) );
			const id = written?.receipt ? receipts.get( written.receipt )! : '';
			if ( ! id ) {
				return [];
			}
			const exists = (): boolean => !! shell().workspaces?.list().some( ( d ) => d.id === id );
			return [
				{
					id: 'go-to-workspace',
					label: 'Go to workspace',
					icon: 'dashicons-desktop',
					emphasis: 'primary',
					effect: 'navigate',
					allowed: exists,
					run: () => shell().workspaces?.switchTo( id ),
				},
			];
		},
	} );
}
