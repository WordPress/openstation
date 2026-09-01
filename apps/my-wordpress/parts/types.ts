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
} from '../../../src/my-wordpress/agents-types';
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

export interface ListItem {
	id: number;
	title: string;
	subtitle: string;
	status: string;
	thumb: string;
	link: string;
	mime: string;
	lockedBy: string;
	canEdit: boolean;
	canDelete: boolean;
}

export interface ListPage {
	items: ListItem[];
	total: number;
	pages: number;
	page: number;
	perPage: number;
}

export interface DetailFacts {
	kind: 'post' | 'media' | 'user';
	id: number;
	title: string;
	facts: Array< [ string, string ] >;
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
	query: string;
	page: number;
	sort: string;
	selected: number[];
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
	};
	counts?: {
		posts?: Record< string, number >;
		commentsReceived?: number;
		distinctAuthors?: number;
	} & Record< string, unknown >;
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

/** What every render helper receives — the runtime's view context. */
export interface Ctx {
	state: AppState;
	data: AppData;
	root: HTMLElement;
	dispatch: ( action: string, args?: Record< string, unknown > ) => Promise< boolean >;
	local: ( action: string, args?: Record< string, unknown > ) => void;
}

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
	loadingMore: boolean;
	/**
	 * The sentinel may only fire while armed, and firing disarms it;
	 * a scroll on the tile canvas re-arms. One page per scroll
	 * gesture — a window parked at the bottom does NOT chain-load
	 * every remaining page.
	 */
	armed: boolean;
	/**
	 * The page number currently being fetched, 0 when none. Ghost
	 * placeholders render only while THIS page is absent — keyed on
	 * the page rather than the in-flight flag, so the paint that
	 * delivers the page never flashes a ghost block for the next one.
	 */
	loadingPage: number;
	scrollEl: HTMLElement | null;
	cacheKey: string;
	pages: Map< number, ListItem[] >;
	total: number;
	pageCount: number;
	observer?: IntersectionObserver;
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
}

const uiByRoot = new WeakMap< HTMLElement, UiState >();

export function uiOf( root: HTMLElement ): UiState {
	let ui = uiByRoot.get( root );
	if ( ! ui ) {
		ui = {
			menu: null,
			folderSel: null,
			quickEdit: null,
			zoom: false,
			loadingMore: false,
			armed: true,
			loadingPage: 0,
			scrollEl: null,
			cacheKey: '',
			pages: new Map(),
			total: 0,
			pageCount: 1,
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
		};
		uiByRoot.set( root, ui );
	}
	return ui;
}
