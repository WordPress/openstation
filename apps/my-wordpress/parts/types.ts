/**
 * My WordPress — the client half's shared contracts.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry (plain `.ts` on purpose — only `*.os.ts`
 * files are app bundle entries to the Vite build). This part owns the
 * SHAPES: the payload the server ships, the state schema both sides
 * share, the per-window transient UI bag, and the shell surface the
 * view reaches through `wp.os`.
 *
 * @public
 */

import type {
	Ability,
	Agent,
	HookSuggestion,
	MioLook,
	PreviewAgent,
	RoleChoice,
	Trigger,
	TriggerKindDescriptor,
} from '../../../src/agents-types';
import {
	createPagedList,
	type PagedList,
	type PageEnvelope,
	type TemplateResult,
	type ViewContext,
} from '@openstation/app';
import type { DragManagerApi } from '../../../src/drag';

// ------------------------------------------------------------- types

export interface SectionDef extends Record< string, unknown > {
	id: string;
	label: string;
	icon: string;
	kind: 'post' | 'media' | 'user' | 'agent';
	post_type: string;
	thumbnails: boolean;
	count: number;
	/**
	 * A post-kind section with no detail folder behind its tiles —
	 * its rows are not posts (Woo's Orders). Navigate into, the Edit…
	 * modal and Trash stand down; double-click opens the row's own
	 * admin screen.
	 */
	flat?: boolean;
	/** A tree-shaped post type — the list view offers a Parent column. */
	hierarchical?: boolean;
	/**
	 * User kind only: the toolbar offers Add user, which opens Core's
	 * user-new.php as a window — on multisite that screen is the
	 * invite flow (Add Existing User, confirmation emails, the
	 * network's Add Users setting). Follows Core's own menu gate.
	 */
	canAdd?: boolean;
	/** REST collection path — what a bin-drop's DELETE runs against. */
	restPath?: string;
	group?: string | null;
	groupLabel?: string | null;
	groupIcon?: string | null;
	groupOrder?: number | null;
}

export interface GroupDef {
	id: string;
	label: string;
	icon: string;
	order: number;
}

/**
 * One list row. Post-kind rows also carry the REST-visible extras
 * plugin hook subscribers read — `meta` (registered `show_in_rest`
 * values) and one term-id array per REST-exposed taxonomy, keyed by
 * `rest_base` — hence the open index signature.
 */
export interface ListItem extends Record< string, unknown > {
	id: number;
	title: string;
	/** User rows also carry the REST spelling of their display name. */
	name?: string;
	subtitle: string;
	status: string;
	/** Clamped excerpt for the hover card — '' for media and users. */
	excerpt: string;
	thumb: string;
	link: string;
	mime: string;
	lockedBy: string;
	canEdit: boolean;
	canDelete: boolean;
	meta?: Record< string, unknown >;
	// ---- the list view's facts (post and media kinds) --------------
	/** `post_name` — what tells a `-2` slug from the post it shadows. */
	slug?: string;
	author?: string;
	authorId?: number;
	/** ISO-8601 with the site offset. */
	date?: string;
	/** ISO-8601 with the site offset. */
	modified?: string;
	comments?: number;
	/** The `?p=<id>` link that survives a permalink change. */
	shortlink?: string;
	parent?: number;
	parentTitle?: string;
	words?: number;
	// ---- media only ---------------------------------------------------
	file?: string;
	bytes?: number;
	size?: string;
	dimensions?: string;
	// ---- user kind ----------------------------------------------------
	login?: string;
	email?: string;
	roles?: string[];
	/** ISO-8601 with the site offset. */
	registered?: string;
	posts?: number;
}

/**
 * One column of the list view. Built-ins come from
 * `parts/list-table.ts`; plugins add their own through the
 * `os.my-wordpress.list-columns` filter, rendering from the row's
 * REST-visible fields (`meta`, taxonomy term ids, the facts above).
 */
export interface ListColumn {
	id: string;
	label: string;
	/**
	 * The server orders the column can sort by — two `sortOptions`
	 * keys, and which one a first click applies. A column whose keys
	 * the section's `sortOptions` lacks renders as a plain heading.
	 */
	sort?: { asc: string; desc: string; first: 'asc' | 'desc' };
	align?: 'start' | 'end';
	/** Tabular figures in the kit's monospace — ids, slugs, counts. */
	mono?: boolean;
	/** Hidden until the user turns it on in the column chooser. */
	hidden?: boolean;
	/** A CSS width for the column, `auto` (the default) or `1fr` for the one that stretches. */
	width?: string;
	/** Never offered in the column chooser (the title, the actions). */
	locked?: boolean;
	render: ( item: ListItem, section: SectionDef ) => TemplateResult | string | number;
}

/**
 * Banded list layout, supplied by the `os.my-wordpress.list-bands`
 * filter — WP Explorer's contract, verbatim: bands in render order,
 * and an assigner mapping each row to one of them (null, or an
 * unknown id, drops the row into an unlabelled band at the end).
 */
export interface ListBanding {
	bands: Array< {
		id: string;
		label: string;
		order?: number;
		tone?: 'warn' | 'danger';
		count?: number;
	} >;
	assign: ( item: ListItem ) => string | null;
}

/** One server page of list rows — `Os::page()`'s envelope. */
export type ListPage = PageEnvelope< ListItem >;

export interface DetailFacts {
	kind: 'post' | 'media' | 'user';
	id: number;
	title: string;
	/**
	 * `[ label, value ]` rows; a user's facts carry a third element —
	 * WP Explorer's dossier-section id (`bio`, `stats`, …) — so the
	 * shared `os.my-wordpress.user-dossier-sections` filter can drop
	 * whole blocks.
	 */
	facts: Array< [ string, string ] | [ string, string, string ] >;
	/** A user's aggregated dossier — WP Explorer's user-stats blob. */
	stats?: StatsPayload | null;
	canEdit: boolean;
	canDelete: boolean;
	image?: string;
	full?: string;
	avatar?: string;
	mime?: string;
	content?: string;
	lockedBy?: string;
	usedIn?: Array< { title: string; usedAs: string } >;
}

export interface PreviewAction {
	id: string;
	label: string;
	icon?: string;
	sections?: string[];
	mime?: string;
	onSelect?: ( ctx: PreviewActionContext ) => void;
}

/**
 * One button in the user preview pane's action row — WP Explorer's
 * `UserPreviewAction` contract, verbatim: the built-ins run through
 * the shared `os.my-wordpress.user-preview-actions` filter before
 * they render, so a section serving people who buy can drop
 * "View activity footprint" and add its own.
 */
export interface UserPreviewAction {
	id: string;
	label: string;
	title?: string;
	variant?: 'primary' | 'secondary';
	onSelect: () => void;
}

export interface PreviewActionContext {
	entityId: string;
	kind: string;
	postType: string;
	mime?: string;
	item: Record< string, unknown >;
	itemId?: number;
	surface: 'pane' | 'menu';
}

export interface AppState extends Record< string, unknown > {
	group: string;
	section: string;
	item: number;
	/** Post navigated INTO — the detail folder view. */
	into: number;
	/** Relation sub-folder open inside `into`. */
	relation: string;
	/** User whose activity footprint fills the body; 0 when closed. */
	footprint: number;
	/** Their name, for the breadcrumb before the payload lands. */
	fpName: string;
	query: string;
	page: number;
	sort: string;
	selected: number[];
	/** How a section lists: the tile canvas or the sortable table. */
	view: 'icons' | 'list';
	/** Agents: which detail tab is open. */
	pane: 'define' | 'tools' | 'triggers';
	/** Agents: whether the create wizard is on. */
	casting: boolean;
	/** Agents: which wizard station. Describe, Meet, Powers, Summon, Launch. */
	wstep: 0 | 1 | 2 | 3 | 4;
	/** Agents: the agent taking shape in the wizard. */
	cast: CastDraft | null;
	/** Agents: the message rail no field owns. */
	agentNotice: string;
	/** Agents: shown under the Describe brief. */
	briefError: string;
}

/**
 * The agent taking shape in the wizard — WP Explorer's `CastDraft`,
 * declared as app state so the server can draft into it and create
 * from it. It carries its own face so the picker has something to page
 * through, and its own triggers so Summon can wire the agent up before
 * it exists.
 */
export interface CastDraft extends Record< string, unknown > {
	/** The plain-language ask typed into Describe. */
	brief: string;
	name: string;
	description: string;
	vibes: string;
	instructions: string;
	role: string;
	abilities: string[];
	triggers: Trigger[];
	/** Which agent this was copied from, if any. */
	copiedFrom: string;
	faceSeed: number;
	face: MioLook;
	/** First seed of the strip the picker is showing. */
	stripSeed: number;
	/** True while the AI draft request is in flight. */
	drafting: boolean;
}

/**
 * The Agents payload `my-wordpress.os.php` ships while the section is
 * open: WP Explorer's section config plus the cast and the catalogues,
 * settled server-side on every render.
 */
export interface AgentsPayload {
	enabled: boolean;
	canEnable: boolean;
	canManage: boolean;
	canInvoke: boolean;
	aiAvailable: boolean;
	/** The provider probe, answered in-process. */
	aiReady: boolean;
	connectorsUrl: string;
	runWindowId: string;
	restRoot: string;
	restNonce: string;
	list: Agent[];
	roleLabels: Record< string, string >;
	abilities: Ability[];
	triggerKinds: TriggerKindDescriptor[];
	hooks: HookSuggestion[];
	/** Assignable roles — null for a read-only viewer. */
	roles: RoleChoice[] | null;
	/** The cast this site would be seeded with, sent only while off. */
	preview?: PreviewAgent[];
}

export type AppAgent = Agent & { profileUrl?: string };

export interface RelationFolder {
	relation: string;
	label: string;
	icon: string;
	count: number;
	disabled?: boolean;
}

export interface FolderPayload {
	id: number;
	title: string;
	status: string;
	content: string;
	folders: RelationFolder[];
}

export interface SubRow {
	id: number;
	title: string;
	subtitle: string;
	icon?: string;
	thumb?: string;
	editUrl: string;
}

export interface SubPayload {
	label: string;
	rows: SubRow[];
}

export interface StatsRecentPost {
	id: number;
	title: string;
	date: string;
	status?: string;
}

/** WP Explorer's stats payloads, consumed defensively. */
export interface StatsPayload {
	profile?: {
		name?: string;
		taxonomyLabel?: string;
		link?: string;
		description?: string;
		registered?: string;
		roleLabels?: string[];
	};
	counts?: {
		posts?: Record< string, number >;
		pages?: Record< string, number >;
		commentsReceived?: number;
		commentsLeft?: number;
		distinctAuthors?: number;
	} & Record< string, unknown >;
	topTerms?: Array< { id: number; name: string; count: number } >;
	recent?: StatsRecentPost[];
	topAuthors?: Array< { userId: number; userName: string; userAvatarUrl: string; count: number } >;
	coTerms?: Array< { id: number; name: string; count: number } >;
	activity?: Array< { ym: string; count: number } >;
	milestones?: Record< string, string | null >;
	comment?: { content?: string; date?: string; status?: string } & Record< string, unknown >;
	author?: { name?: string; totalApprovedComments?: number } & Record< string, unknown >;
	post?: { id?: number; title?: string } & Record< string, unknown >;
}

export type SubDetail =
	| { kind: 'term'; stats: StatsPayload }
	| { kind: 'user'; detail: DetailFacts; stats: StatsPayload | null }
	| { kind: 'comment'; stats: StatsPayload }
	| { kind: 'media'; detail: DetailFacts }
	| { kind: 'revision'; title: string; author: string; date: string; content: string };

export interface AppData {
	siteName: string;
	/** Whether the agents routes exist — gates the Send-to warm-up. */
	agentsEnabled: boolean;
	sections: SectionDef[];
	groups: GroupDef[];
	sortOptions: Record< string, string >;
	list: ListPage | null;
	detail: DetailFacts | null;
	folder: FolderPayload | null;
	sub: SubPayload | null;
	subDetail: SubDetail | null;
	authors: Array< { id: number; name: string } >;
	/** Category terms in `<os-category-picker>`'s item shape. */
	categories: Array< { id: number; name: string; parent: number } >;
	/** Tag terms — the Edit… modal's local suggestion pool. */
	tags: Array< { id: number; name: string } >;
	previewActions: PreviewAction[];
	agents: AgentsPayload | null;
	/** The list view's remembered column choices: section id → hidden column ids. */
	hiddenColumns: Record< string, string[] >;
}

/** One context-menu row — builtins and plugin-injected alike. */
export interface MenuOption {
	id: string;
	label: string;
	icon?: string;
	danger?: boolean;
	disabled?: boolean;
	/** A non-interactive section header — renders, never fires. */
	heading?: boolean;
	onSelect?: ( () => void ) | null;
}

/**
 * What every render helper receives — the framework's view context,
 * typed to this app's state and data. `ctx.ui( … )`, `ctx.repaint()`,
 * `ctx.fetch()` and `ctx.host` are the framework's, not ours.
 */
export type Ctx = ViewContext< AppState, AppData >;

// ------------------------------------------------------------- shell

export interface OsShell {
	dragManager?: {
		start: ( opts: {
			payload: { type: string; source: HTMLElement; data: Record< string, unknown > };
			origin: PointerEvent;
		} ) => unknown;
	} & Partial< DragManagerApi >;
	hooks?: {
		applyFilters: ( hook: string, value: unknown, ...args: unknown[] ) => unknown;
		doAction?: ( hook: string, ...args: unknown[] ) => void;
		addAction?: ( hook: string, ns: string, cb: ( ...args: unknown[] ) => void ) => void;
		removeAction?: ( hook: string, ns: string ) => void;
	};
	showToast?: ( o: { message: string } ) => void;
	openWindow?: ( id: string, opts?: {
		source?: string;
		params?: Record< string, string | number | boolean >;
	} ) => boolean;
	deriveWindowId?: ( url: string ) => string;
	windowManager?: {
		open: ( opts: { id: string; url: string; title: string; icon: string } ) => unknown;
	};
	openOsSettings?: ( opts?: { tabId?: string } ) => void;
	files?: {
		rest?: {
			createPlacement?: ( body: {
				type: string;
				ref: string;
				x: number;
				y: number;
			} ) => Promise< Record< string, unknown > >;
		};
		store?: {
			getState?: () => { placementsByFolder?: Map< number, unknown[] > };
			upsertPlacement?: ( placement: Record< string, unknown > ) => void;
		};
	};
}

export function shell(): OsShell {
	return ( ( window as { wp?: { os?: OsShell } } ).wp?.os ?? {} ) as OsShell;
}

// ------------------------------------------------- per-window UI state

/**
 * Transient UI that must not travel to the server: the open context
 * menu, the zoom overlay, the in-flight infinite-scroll guard, the
 * accumulated pages, and the Agents section's ephemera. Keyed by mount
 * root, so two windows of the app never share it.
 */
export interface UiState {
	/** Open context menu — on an item, or (item null) on the canvas. */
	menu: { x: number; y: number; item: ListItem | null } | null;
	/**
	 * Finder-style visual selection on the folder canvases (root
	 * sections, groups, relation folders): single click selects,
	 * double click navigates.
	 */
	folderSel: string | null;
	/** The Edit… quick-edit modal: which items, and the picked values. */
	quickEdit: {
		ids: number[];
		status: string;
		comments: string;
		author: string;
		sticky: string;
		categories: number[];
		/** Picked tag tokens — labels are what the server consumes. */
		tags: Array< { id?: number; label: string } >;
	} | null;
	zoom: boolean;
	/** The list view's column chooser, open at these coordinates. */
	columnsMenu: { x: number; y: number } | null;
	/** After a view switch: scroll the open / selected row into sight once. */
	revealSelection: boolean;
	/**
	 * The framework's infinitely scrolled list: page accumulation,
	 * the one-page-per-gesture sentinel, skeletons, the short-list
	 * deadlock guard. See `createPagedList()` in `@openstation/app`.
	 */
	list: PagedList< ListItem >;
	/** Agents: free-text filter over the ability catalogue. */
	abilityQuery: string;
	/**
	 * Agents: ability groups the user explicitly opened or closed.
	 * Absent means "however the collapse threshold says to start".
	 */
	abilityOpen: Map< string, boolean >;
	/** Agents: inline error under the Meet step's name field. */
	nameError: string;
	/** Agents: the Define pane's draft edits, and whose they are. */
	agentDraft: { name: string; description: string; instructions: string; role: string } | null;
	agentDraftFor: number;
	/** Agents: a mutation dispatch is in flight. */
	agentBusy: boolean;
	/** Agents: ids already offered a face backfill this window. */
	agentBackfilled: Set< number >;
	/** Agents: live drop-target deregisters, keyed by agent id. */
	agentDropTargets: Map< number, () => void >;
	/** Agents: last roster identity `os.agents.roster-changed` fired for. */
	rosterStamp: string;
	/** Agents: open the chat window once the pending create lands. */
	chatAfterCreate: boolean;
	/** Footprint: the one-round-trip payload, cached per user. */
	fp: {
		userId: number;
		status: 'loading' | 'error' | 'ready';
		payload: UserFootprint | null;
	} | null;
}

function freshUi(): UiState {
	return {
		menu: null,
		folderSel: null,
		quickEdit: null,
		zoom: false,
		columnsMenu: null,
		revealSelection: false,
		list: createPagedList< ListItem >(),
		abilityQuery: '',
		abilityOpen: new Map(),
		nameError: '',
		agentDraft: null,
		agentDraftFor: 0,
		agentBusy: false,
		agentBackfilled: new Set(),
		agentDropTargets: new Map(),
		rosterStamp: '',
		chatAfterCreate: false,
		fp: null,
	};
}

/** This app's slice of the framework's per-view client-only bag. */
export function uiOf( ctx: Pick< Ctx, 'ui' > ): UiState {
	return ctx.ui( freshUi );
}

/**
 * Per-user activity footprint payload returned by
 * `/desktop-mode/v1/user-footprint/<id>`. Drives the right-click
 * "View activity footprint" surface.
 */
export interface UserFootprint {
	profile: {
		id: number;
		name: string;
		avatarUrl: string;
		link: string;
		roleLabels?: string[];
		registered?: string;
	};
	range: {
		/** YYYY-MM-DD, inclusive. */
		from: string;
		/** YYYY-MM-DD, inclusive. */
		to: string;
		/** Count of day buckets (length of `daily`). */
		days: number;
	};
	daily: Array< {
		/** YYYY-MM-DD. */
		date: string;
		posts: number;
		comments: number;
		/**
		 * Revisions saved by the user that day, excluding the initial
		 * save of brand-new posts (those count under `posts`), so
		 * the heatmap registers update activity, not just
		 * publications and comments.
		 */
		updates: number;
	} >;
	/** Sunday-indexed weekday distribution; length 7. */
	weekday: number[];
	/** Hour-of-day distribution in site timezone; length 24. */
	hour: number[];
	streak: {
		longest: number;
		current: number;
		longestRange: { from: string; to: string };
	};
	timeline: Array< {
		/** `'post-update'` rows are most-recent-save-per-parent rollups. */
		kind: 'post' | 'comment' | 'post-update';
		date: string;
		title: string;
		link: string;
		status: string;
		postId?: number;
		type?: string;
	} >;
	totals: {
		posts: number;
		pages: number;
		comments: number;
		/** Lifetime revision count, excluding the initial save. */
		updates: number;
		mostProlificMonth?: { ym: string; n: number };
	};
}
