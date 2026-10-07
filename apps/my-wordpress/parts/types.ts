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

export interface SectionDef extends Record< string, unknown > {
	id: string;
	label: string;
	icon: string;
	kind: 'post' | 'media' | 'user' | 'agent';
	post_type: string;
	thumbnails: boolean;
	count: number;

	flat?: boolean;

	hierarchical?: boolean;

	canAdd?: boolean;

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

export interface ListItem extends Record< string, unknown > {
	id: number;
	title: string;

	name?: string;
	subtitle: string;
	status: string;

	excerpt: string;
	thumb: string;
	link: string;
	mime: string;
	lockedBy: string;
	canEdit: boolean;
	canDelete: boolean;
	meta?: Record< string, unknown >;

	slug?: string;
	author?: string;
	authorId?: number;

	date?: string;

	modified?: string;
	comments?: number;

	shortlink?: string;
	parent?: number;
	parentTitle?: string;
	words?: number;

	file?: string;
	bytes?: number;
	size?: string;
	dimensions?: string;

	alt?: string;

	login?: string;
	email?: string;
	roles?: string[];

	registered?: string;
	posts?: number;
}

export interface ListColumn {
	id: string;
	label: string;

	sort?: { asc: string; desc: string; first: 'asc' | 'desc' };
	align?: 'start' | 'end';

	mono?: boolean;

	hidden?: boolean;

	width?: string;

	locked?: boolean;
	render: ( item: ListItem, section: SectionDef ) => TemplateResult | string | number;
}

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

export type ListPage = PageEnvelope< ListItem >;

export interface DetailFacts {
	kind: 'post' | 'media' | 'user';
	id: number;
	title: string;

	facts: Array< [ string, string ] | [ string, string, string ] >;

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

	into: number;

	relation: string;

	footprint: number;

	fpName: string;
	query: string;
	page: number;
	sort: string;
	selected: number[];

	view: 'icons' | 'list';

	pane: 'define' | 'tools' | 'triggers';

	casting: boolean;

	wstep: 0 | 1 | 2 | 3 | 4;

	cast: CastDraft | null;

	agentNotice: string;

	briefError: string;
}

export interface CastDraft extends Record< string, unknown > {

	brief: string;
	name: string;
	description: string;
	vibes: string;
	instructions: string;
	role: string;
	abilities: string[];
	triggers: Trigger[];

	copiedFrom: string;
	faceSeed: number;
	face: MioLook;

	stripSeed: number;

	drafting: boolean;
}

export interface AgentsPayload {
	enabled: boolean;
	canEnable: boolean;
	canManage: boolean;
	canInvoke: boolean;
	aiAvailable: boolean;

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

	roles: RoleChoice[] | null;

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

	categories: Array< { id: number; name: string; parent: number } >;

	tags: Array< { id: number; name: string } >;
	previewActions: PreviewAction[];
	agents: AgentsPayload | null;

	hiddenColumns: Record< string, string[] >;
}

export interface MenuOption {
	id: string;
	label: string;
	icon?: string;
	danger?: boolean;
	disabled?: boolean;

	heading?: boolean;
	onSelect?: ( () => void ) | null;
}

export type Ctx = ViewContext< AppState, AppData >;

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

export interface UiState {

	menu: { x: number; y: number; item: ListItem | null } | null;

	folderSel: string | null;

	quickEdit: {
		ids: number[];
		status: string;
		comments: string;
		author: string;
		sticky: string;
		categories: number[];

		tags: Array< { id?: number; label: string } >;
	} | null;
	trashHidden: Map< string, Set< number > >;
	trashPage: ListPage | null;
	previewTarget: number;
	previewScope: string;
	previewLoading: boolean;
	previewRevision: number;
	previewError: boolean;
	zoom: boolean;

	columnsMenu: { x: number; y: number } | null;

	revealSelection: boolean;

	list: PagedList< ListItem >;

	abilityQuery: string;

	abilityOpen: Map< string, boolean >;

	nameError: string;

	agentDraft: { name: string; description: string; instructions: string; role: string } | null;
	agentDraftFor: number;

	agentBusy: boolean;

	agentBackfilled: Set< number >;

	agentDropTargets: Map< number, () => void >;

	rosterStamp: string;

	chatAfterCreate: boolean;

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
		trashHidden: new Map(),
		trashPage: null,
		previewTarget: 0,
		previewScope: '',
		previewLoading: false,
		previewRevision: 0,
		previewError: false,
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

export function uiOf( ctx: Pick< Ctx, 'ui' > ): UiState {
	return ctx.ui( freshUi );
}

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

		from: string;

		to: string;

		days: number;
	};
	daily: Array< {

		date: string;
		posts: number;
		comments: number;

		updates: number;
	} >;

	weekday: number[];

	hour: number[];
	streak: {
		longest: number;
		current: number;
		longestRange: { from: string; to: string };
	};
	timeline: Array< {

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

		updates: number;
		mostProlificMonth?: { ym: string; n: number };
	};
}
