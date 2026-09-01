/**
 * My WordPress — the client half: the body, instant.
 *
 * `my-wordpress.os.php` owns the truth (sections, queries,
 * authorization, the mutating actions); this file owns everything the
 * pointer touches. Selection — click, Ctrl/Cmd toggle, Shift range,
 * and a marquee drawn on the canvas — is local state. Lists
 * accumulate page after page behind an IntersectionObserver, so
 * scrolling never pauses. Rows lift off into the shell's DragManager
 * and land on the desktop as tiles. The context menu, the media
 * zoom, the bulk bar and the copy-links clipboard action never leave
 * the tab. Preview actions resolve through the SAME
 * `os.my-wordpress.preview-actions` JS filter WP Explorer applies,
 * so a plugin's action buttons appear here unchanged.
 *
 * @public
 */

import { __, _n, defineApp, html, sprintf, type TemplateResult } from '@openstation/app';

// ------------------------------------------------------------- types

export interface SectionDef extends Record< string, unknown > {
	id: string;
	label: string;
	icon: string;
	kind: 'post' | 'media' | 'user';
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
}

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
	categories: Array< { id: number; name: string } >;
	previewActions: PreviewAction[];
}

interface OsShell {
	dragManager?: {
		start: ( opts: {
			payload: { type: string; source: HTMLElement; data: Record< string, unknown > };
			origin: PointerEvent;
		} ) => unknown;
	};
	hooks?: { applyFilters: ( hook: string, value: unknown, ...args: unknown[] ) => unknown };
	showToast?: ( o: { message: string } ) => void;
}

function shell(): OsShell {
	return ( ( window as { wp?: { os?: OsShell } } ).wp?.os ?? {} ) as OsShell;
}

// ------------------------------------------------- per-window UI state

/**
 * Transient UI that must not travel to the server: the open context
 * menu, the zoom overlay, the in-flight infinite-scroll guard, and
 * the accumulated pages. Keyed by mount root, so two windows of the
 * app never share it.
 */
interface UiState {
	/** Open context menu — on an item, or (item null) on the canvas. */
	menu: { x: number; y: number; item: ListItem | null } | null;
	/** The Edit… quick-edit modal: which items, and the picked values. */
	quickEdit: {
		ids: number[];
		status: string;
		comments: string;
		author: string;
		sticky: string;
		categories: number[];
		tags: string;
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
	scrollEl: HTMLElement | null;
	cacheKey: string;
	pages: Map< number, ListItem[] >;
	total: number;
	pageCount: number;
	observer?: IntersectionObserver;
}

const uiByRoot = new WeakMap< HTMLElement, UiState >();

function uiOf( root: HTMLElement ): UiState {
	let ui = uiByRoot.get( root );
	if ( ! ui ) {
		ui = {
			menu: null,
			quickEdit: null,
			zoom: false,
			loadingMore: false,
			armed: true,
			scrollEl: null,
			cacheKey: '',
			pages: new Map(),
			total: 0,
			pageCount: 1,
		};
		uiByRoot.set( root, ui );
	}
	return ui;
}

// ------------------------------------------------------- pure helpers

/** The identity of a list: new key, new accumulation. */
export function listKey( state: AppState ): string {
	return [ state.section, state.query, state.sort ].join( '|' );
}

/**
 * Fold the server's latest page into the accumulated set. Pages are
 * kept per-number, so a `watch` refresh that re-fetches page N
 * replaces exactly page N, appending never duplicates, and a new
 * section / query / sort starts clean.
 */
export function accumulate(
	ui: Pick< UiState, 'cacheKey' | 'pages' | 'total' | 'pageCount' >,
	key: string,
	list: ListPage | null,
): ListItem[] {
	if ( ! list ) {
		ui.cacheKey = '';
		ui.pages.clear();
		ui.total = 0;
		ui.pageCount = 1;
		return [];
	}
	if ( ui.cacheKey !== key ) {
		ui.cacheKey = key;
		ui.pages.clear();
	}
	ui.pages.set( list.page, list.items );
	ui.total = list.total;
	ui.pageCount = list.pages;
	const out: ListItem[] = [];
	const seen = new Set< number >();
	for ( const page of Array.from( ui.pages.keys() ).sort( ( a, b ) => a - b ) ) {
		for ( const item of ui.pages.get( page ) ?? [] ) {
			if ( ! seen.has( item.id ) ) {
				seen.add( item.id );
				out.push( item );
			}
		}
	}
	return out;
}

/**
 * The next selection after a row click. Plain click replaces, Ctrl/Cmd
 * toggles, Shift extends from the anchor (the last selected id) across
 * the current visual order.
 */
export function applySelection(
	selected: number[],
	order: number[],
	id: number,
	mods: { ctrl?: boolean; shift?: boolean },
): number[] {
	if ( mods.shift && selected.length > 0 ) {
		const anchor = selected[ selected.length - 1 ];
		const from = order.indexOf( anchor );
		const to = order.indexOf( id );
		if ( from !== -1 && to !== -1 ) {
			const range = order.slice( Math.min( from, to ), Math.max( from, to ) + 1 );
			const merged = new Set( [ ...selected, ...range ] );
			return Array.from( merged );
		}
	}
	if ( mods.ctrl ) {
		return selected.includes( id ) ? selected.filter( ( s ) => s !== id ) : [ ...selected, id ];
	}
	return [ id ];
}

/**
 * Which preview actions apply to an item — section/post-type/MIME
 * scoping, then the shared `os.my-wordpress.preview-actions` JS
 * filter, exactly as WP Explorer resolves them.
 */
export function resolveActions(
	descriptors: PreviewAction[],
	ctx: PreviewActionContext,
	applyFilters?: OsShell[ 'hooks' ],
): PreviewAction[] {
	const scoped = descriptors.filter( ( a ) => {
		if ( a.sections && a.sections.length > 0 ) {
			const matches =
				a.sections.includes( ctx.entityId ) ||
				a.sections.includes( '*' ) ||
				( !! ctx.postType && a.sections.includes( ctx.postType ) );
			if ( ! matches ) {
				return false;
			}
		}
		if ( a.mime ) {
			if ( ! ctx.mime ) {
				return false;
			}
			try {
				if ( ! new RegExp( a.mime ).test( ctx.mime ) ) {
					return false;
				}
			} catch {
				return false;
			}
		}
		return true;
	} );
	const merged = applyFilters?.applyFilters( 'os.my-wordpress.preview-actions', scoped, ctx );
	return Array.isArray( merged ) ? ( merged as PreviewAction[] ) : scoped;
}

function actionContext(
	section: SectionDef,
	item: ListItem,
	surface: 'pane' | 'menu',
): PreviewActionContext {
	return {
		entityId: section.id,
		kind: section.kind,
		postType: section.post_type,
		mime: item.mime || undefined,
		item: item as unknown as Record< string, unknown >,
		itemId: item.id,
		surface,
	};
}

function runAction( action: PreviewAction, ctx: PreviewActionContext ): void {
	try {
		action.onSelect?.( ctx );
	} catch {
		// Plugin code — contained.
		// eslint-disable-next-line no-console
		console.error( `[my-wordpress] preview action ${ action.id } threw.` );
	}
}

function sectionOf( data: AppData, id: string ): SectionDef | null {
	return data.sections.find( ( s ) => s.id === id ) ?? null;
}

function glyph( icon: string, cls: string ): TemplateResult {
	if ( icon.startsWith( 'dashicons-' ) ) {
		return html`<span class="${ cls } dashicons ${ icon }" aria-hidden="true"></span>`;
	}
	// Image icons are MASKED to the current text colour, the way the
	// shell's renderIcon() paints them — a plugin's brand SVG (Woo's
	// black W) must not break the monochrome tile family.
	return html`<span
		class="${ cls } os-mywp__icon-mask"
		style="--mywp-icon:url(&quot;${ icon.replace( /"/g, '%22' ) }&quot;)"
		aria-hidden="true"
	></span>`;
}

// --------------------------------------------------------------- view

function renderRoot( ctx: Ctx ): TemplateResult {
	const { data, state } = ctx;
	const inGroup = state.group;
	const loose = data.sections.filter( ( s ) =>
		inGroup ? s.group === inGroup : ! s.group,
	);
	const folders = inGroup
		? []
		: data.groups.map( ( g ) => ( {
			...g,
			count: data.sections
				.filter( ( s ) => s.group === g.id )
				.reduce( ( sum, s ) => sum + s.count, 0 ),
		} ) );
	return html`
		<div class="os-mywp__root" role="list">
			${ loose.map( ( s ) => html`
				<button
					type="button"
					class="os-mywp__tile"
					data-section-id=${ s.id }
					@click=${ () => void ctx.dispatch( 'go', { group: inGroup, section: s.id } ) }
				>
					${ glyph( s.icon, 'os-mywp__tile-icon' ) }
					<span class="os-mywp__tile-label">${ s.label } · ${ s.count }</span>
				</button>
			` ) }
			${ folders.map( ( g ) => html`
				<button
					type="button"
					class="os-mywp__tile"
					@click=${ () => void ctx.dispatch( 'go', { group: g.id } ) }
				>
					${ glyph( g.icon, 'os-mywp__tile-icon' ) }
					<span class="os-mywp__tile-label">${ g.label } · ${ g.count }</span>
				</button>
			` ) }
		</div>
	`;
}

function renderTile( ctx: Ctx, section: SectionDef, item: ListItem, order: number[] ): TemplateResult {
	const { state } = ctx;
	const isSelected = state.selected.includes( item.id );
	const isOpen = state.item === item.id;
	const select = ( e: MouseEvent ): void => {
		ctx.local( 'select', {
			item: item.id,
			ctrl: e.ctrlKey || e.metaKey,
			shift: e.shiftKey,
			order,
		} );
		if ( ! e.ctrlKey && ! e.metaKey && ! e.shiftKey ) {
			void ctx.dispatch( 'open', { item: item.id } );
		}
	};
	return html`
		<div
			class="os-mywp__cell ${ isOpen ? 'is-open' : '' }"
			data-item-id=${ String( item.id ) }
			data-mywp-drag=${ section.kind === 'user' ? 'user' : section.post_type }
			role="option"
			aria-selected=${ isSelected ? 'true' : 'false' }
			title=${ item.subtitle }
			@click=${ select }
			@dblclick=${ () => item.canEdit && void ctx.dispatch( 'edit', { item: item.id } ) }
			@contextmenu=${ ( e: MouseEvent ) => {
				e.preventDefault();
				e.stopPropagation();
				uiOf( ctx.root ).menu = { x: e.clientX, y: e.clientY, item };
				ctx.local( 'repaint' );
			} }
		>
			<span class="os-mywp__tilebox">
				<os-tile
					kind="entry"
					type=${ section.kind === 'user' ? 'user' : section.post_type }
					ref=${ String( item.id ) }
					label=${ item.title }
					icon=${ item.thumb ? '' : section.icon }
					thumbnail=${ item.thumb }
					status=${ item.status && item.status !== 'publish' && section.kind === 'post' ? item.status : '' }
					?selected=${ isSelected }
				></os-tile>
				${ item.lockedBy
					? html`<span class="os-mywp__lock" title=${ sprintf(
						/* translators: %s: user display name. */
						__( '%s is editing' ),
						item.lockedBy,
					) }>🔒</span>`
					: '' }
			</span>
		</div>
	`;
}

/** One context-menu row — builtins and plugin-injected alike. */
export interface MenuOption {
	id: string;
	label: string;
	icon?: string;
	danger?: boolean;
	disabled?: boolean;
	onSelect?: ( () => void ) | null;
}

/**
 * The base context menu for one item, in WP Explorer's order: Open in
 * editor, Navigate into, Edit…, Publish, Copy link, Move to Trash —
 * then the item's preview actions. Plugin entries (the agents'
 * "Send to …" rows among them) are appended afterwards by the shared
 * `os.my-wordpress.tile-context-menu` filter, exactly as they are in
 * WP Explorer.
 */
export function buildMenuOptions(
	section: SectionDef,
	item: ListItem,
	previewActions: PreviewAction[],
): MenuOption[] {
	const options: MenuOption[] = [];
	if ( item.canEdit ) {
		options.push( {
			id: 'edit',
			label: section.kind === 'user' ? __( 'Edit profile' ) : __( 'Open in editor' ),
		} );
	}
	options.push( { id: 'open', label: __( 'Navigate into' ) } );
	if ( section.kind === 'post' && item.canEdit ) {
		options.push( { id: 'quick-edit', label: __( 'Edit…' ) } );
		if ( item.status !== 'publish' ) {
			options.push( { id: 'publish', label: __( 'Publish' ) } );
		}
	}
	if ( item.link ) {
		options.push( { id: 'copy-link', label: __( 'Copy link' ) } );
	}
	if ( section.kind === 'post' ) {
		options.push( {
			id: 'trash',
			label: __( 'Move to Trash' ),
			danger: true,
			disabled: ! item.canDelete,
		} );
	}
	for ( const action of previewActions ) {
		options.push( { id: action.id, label: action.label, icon: action.icon } );
	}
	return options;
}

function renderList( ctx: Ctx, section: SectionDef, items: ListItem[] ): TemplateResult {
	if ( items.length === 0 ) {
		return html`
			<os-empty-state icon=${ section.icon.startsWith( 'dashicons-' ) ? section.icon : 'dashicons-portfolio' }>
				${ ctx.state.query ? __( 'Nothing matches the search.' ) : __( 'Nothing here yet.' ) }
			</os-empty-state>
		`;
	}
	const ui = uiOf( ctx.root );
	const canvasMenu = ( e: MouseEvent ): void => {
		e.preventDefault();
		ui.menu = { x: e.clientX, y: e.clientY, item: null };
		ctx.local( 'repaint' );
	};
	const order = items.map( ( i ) => i.id );
	const hasMore = ui.pageCount > Math.max( ...Array.from( ui.pages.keys() ), 1 );
	// The page being fetched paints as skeleton tiles — WP Explorer's
	// loading placeholders. They occupy the incoming page's real
	// footprint, so the scroll height settles once instead of jumping.
	const ghosts = ui.loadingMore && hasMore
		? Math.max( 1, Math.min( ctx.data.list?.perPage ?? 24, ui.total - items.length ) )
		: 0;
	return html`
		<div
			class="os-mywp__tiles os-mywp__canvas"
			role="listbox"
			aria-multiselectable="true"
			@contextmenu=${ canvasMenu }
		>
			${ items.map( ( item ) => renderTile( ctx, section, item, order ) ) }
			${ Array.from( { length: ghosts }, ( _unused, i ) => html`
				<div class="os-mywp__cell os-mywp__cell--ghost" data-ghost-index=${ String( i ) } aria-hidden="true">
					<span class="os-mywp__ghost">
						<span class="os-mywp__ghost-visual"></span>
						<span class="os-mywp__ghost-label"></span>
					</span>
				</div>
			` ) }
			${ hasMore ? html`<div class="os-mywp__sentinel" data-mywp-sentinel></div>` : '' }
		</div>
	`;
}

function renderDetail( ctx: Ctx, section: SectionDef ): TemplateResult {
	const { data } = ctx;
	const detail = data.detail;
	if ( ! detail ) {
		return html`<os-empty-state>${ __( 'This item no longer exists.' ) }</os-empty-state>`;
	}
	const item = ( data.list?.items ?? [] ).find( ( i ) => i.id === detail.id );
	const actions = item
		? resolveActions( data.previewActions, actionContext( section, item, 'pane' ), shell().hooks )
		: [];
	return html`
		<article class="os-mywp__detail">
			<os-button
				variant="ghost"
				class="os-mywp__pane-close"
				aria-label=${ __( 'Close details' ) }
				@click=${ () => void ctx.dispatch( 'open', { item: 0 } ) }
			>✕</os-button>
			${ detail.avatar ? html`<os-avatar src=${ detail.avatar } name=${ detail.title } size="xl"></os-avatar>` : '' }
			${ detail.image
				? html`<img
					class="os-mywp__hero ${ detail.kind === 'media' ? 'is-zoomable' : '' }"
					src=${ detail.image }
					alt=${ detail.title }
					@click=${ () => {
						if ( detail.kind === 'media' ) {
							uiOf( ctx.root ).zoom = true;
							ctx.local( 'repaint' );
						}
					} }
				/>`
				: '' }
			<h2 class="os-mywp__detail-title">${ detail.title }</h2>
			${ detail.lockedBy
				? html`<os-notice tone="warning" not-dismissible>${ sprintf(
					/* translators: %s: user display name. */
					__( '%s is editing this right now.' ),
					detail.lockedBy,
				) }</os-notice>`
				: '' }
			<dl class="os-mywp__facts">
				${ detail.facts.map( ( [ label, value ] ) => html`
					<div class="os-mywp__fact"><dt>${ label }</dt><dd>${ value }</dd></div>
				` ) }
			</dl>
			${ detail.usedIn
				? html`
					<h3 class="os-mywp__pane-h">${ __( 'Used in' ) }</h3>
					${ detail.usedIn.length > 0
						? html`<ul class="os-mywp__used-in">
							${ detail.usedIn.map( ( u ) => html`<li>${ u.title } <span class="os-mywp__subtitle">${ u.usedAs }</span></li>` ) }
						</ul>`
						: html`<p class="os-mywp__subtitle">${ __( 'Not used anywhere yet.' ) }</p>` }
				`
				: '' }
			${ detail.content !== undefined
				? html`
					<h3 class="os-mywp__pane-h">${ __( 'Preview' ) }</h3>
					<div class="os-mywp__content" data-mywp-content="detail" os-preserve></div>
				`
				: '' }
			<div class="os-mywp__actions">
				${ detail.canEdit
					? html`<os-button variant="primary" @click=${ () => void ctx.dispatch( 'edit', { item: detail.id } ) }>
						${ detail.kind === 'user' ? __( 'Edit profile' ) : __( 'Open in editor' ) }
					</os-button>`
					: '' }
				${ actions.map( ( action ) => html`
					<os-button variant="secondary" @click=${ () => item && runAction( action, actionContext( section, item, 'pane' ) ) }>
						${ action.label }
					</os-button>
				` ) }
				${ detail.kind === 'post' && detail.canDelete
					? html`<os-button
						variant="danger"
						os-action="trash"
						os-arg-item=${ String( detail.id ) }
						os-confirm=${ __( 'Move this to the Trash?' ) }
						os-confirm-label=${ __( 'Trash' ) }
						os-confirm-danger
					>${ __( 'Trash' ) }</os-button>`
					: '' }
			</div>
		</article>
	`;
}

function renderMenu( ctx: Ctx, section: SectionDef ): TemplateResult | '' {
	const ui = uiOf( ctx.root );
	if ( ! ui.menu ) {
		return '';
	}
	const { x, y, item } = ui.menu;
	const close = (): void => {
		uiOf( ctx.root ).menu = null;
		ctx.local( 'repaint' );
	};
	const sortValue = ctx.state.sort || 'default';

	// An action from the menu applies to the whole selection when the
	// clicked item is part of one, to just the item otherwise.
	let targets: number[] = [];
	if ( item ) {
		targets = ctx.state.selected.includes( item.id ) && ctx.state.selected.length > 1
			? ctx.state.selected
			: [ item.id ];
	}
	const allItems = Array.from( ui.pages.values() ).flat();

	let options: MenuOption[] = [];
	if ( item ) {
		const menuActions = resolveActions(
			ctx.data.previewActions,
			actionContext( section, item, 'menu' ),
			shell().hooks,
		);
		options = buildMenuOptions( section, item, menuActions );
		// The SAME filter WP Explorer runs — plugin entries, the
		// agents' "Send to …" rows included, appear here unchanged.
		const merged = shell().hooks?.applyFilters(
			'os.my-wordpress.tile-context-menu',
			options,
			{ entityId: section.id, kind: section.kind, item: item as unknown as Record< string, unknown > },
		);
		if ( Array.isArray( merged ) ) {
			options = merged as MenuOption[];
		}
	}

	const pick = ( e: Event ): void => {
		const id = String( ( e as CustomEvent< { id?: string } > ).detail?.id ?? '' );
		close();
		if ( id.startsWith( 'sort:' ) ) {
			ctx.local( 'set-sort', { sort: id.slice( 'sort:'.length ) } );
			void ctx.dispatch( 'sort' );
			return;
		}
		if ( id === 'refresh' ) {
			void ctx.dispatch( 'refresh' );
			return;
		}
		if ( ! item ) {
			return;
		}
		const picked = options.find( ( o ) => o.id === id );
		if ( picked?.onSelect ) {
			// A plugin-injected entry (an agent's "Send to", …) owns
			// its own behaviour.
			picked.onSelect();
			return;
		}
		if ( id === 'open' ) {
			// Posts navigate INTO their detail folder (author,
			// comments, revisions, …); users and media open the pane.
			if ( section.kind === 'post' ) {
				void ctx.dispatch( 'into', { item: item.id } );
			} else {
				void ctx.dispatch( 'open', { item: item.id } );
			}
		} else if ( id === 'edit' ) {
			void ctx.dispatch( 'edit', { item: item.id } );
		} else if ( id === 'quick-edit' ) {
			uiOf( ctx.root ).quickEdit = {
				ids: targets,
				status: '',
				comments: '',
				author: '',
				sticky: '',
				categories: [],
				tags: '',
			};
			ctx.local( 'repaint' );
		} else if ( id === 'publish' ) {
			void ctx.dispatch( 'quick-edit', { items: targets, status: 'publish' } );
		} else if ( id === 'copy-link' ) {
			const links = allItems
				.filter( ( i ) => targets.includes( i.id ) )
				.map( ( i ) => i.link )
				.filter( Boolean );
			void navigator.clipboard?.writeText( links.join( '\n' ) );
			shell().showToast?.( {
				message: sprintf(
					/* translators: %d: link count. */
					__( 'Copied %d links.' ),
					links.length,
				),
			} );
		} else if ( id === 'trash' ) {
			if ( targets.length > 1 ) {
				void ctx.dispatch( 'bulk-trash' );
			} else {
				void ctx.dispatch( 'trash', { item: item.id } );
			}
		} else {
			const action = resolveActions(
				ctx.data.previewActions,
				actionContext( section, item, 'menu' ),
				shell().hooks,
			).find( ( a ) => a.id === id );
			if ( action ) {
				runAction( action, actionContext( section, item, 'menu' ) );
			}
		}
	};
	return html`
		<div
			class="os-mywp__menu-backdrop"
			@click=${ close }
			@contextmenu=${ ( e: Event ) => {
				e.preventDefault();
				close();
			} }
		></div>
		<os-context-menu
			open
			class="os-mywp__menu"
			style="position:fixed;left:${ x }px;top:${ y }px;"
			@os-context-menu-pick=${ pick }
		>
			${ item
				? options.map( ( o ) => html`
					<os-context-menu-option
						id=${ o.id }
						icon=${ o.icon ?? '' }
						?danger=${ !! o.danger }
						?disabled=${ !! o.disabled }
					>${ o.label }</os-context-menu-option>
				` )
				: html`
					<os-context-menu-option heading>${ __( 'Sort by' ) }</os-context-menu-option>
					${ Object.entries( ctx.data.sortOptions ).map( ( [ value, label ] ) => html`
						<os-context-menu-option id=${ 'sort:' + value } icon=${ value === sortValue ? 'dashicons-yes' : '' }>
							${ label }
						</os-context-menu-option>
					` ) }
					<os-context-menu-option id="refresh" icon="dashicons-update">${ __( 'Refresh' ) }</os-context-menu-option>
				` }
		</os-context-menu>
	`;
}

/**
 * The detail FOLDER view a post navigates into: relation folder tiles
 * on the left (Author, Contributors, Comments · N, Categories, Tags,
 * Attached media, Revisions), the rendered article on the right.
 * Double-click a folder to drill into its rows, like the original.
 */
function renderFolder( ctx: Ctx ): TemplateResult {
	const folder = ctx.data.folder;
	if ( ! folder ) {
		return html`<os-empty-state>${ __( 'This item no longer exists.' ) }</os-empty-state>`;
	}
	return html`
		<div class="os-mywp__split">
			<div class="os-mywp__list-pane">
				<div class="os-mywp__tiles" role="list">
					${ folder.folders.map( ( sub ) => html`
						<div class="os-mywp__cell ${ sub.disabled ? 'is-disabled' : '' }" role="listitem">
							<span class="os-mywp__tilebox">
								<os-tile
									kind="folder"
									type="relation"
									ref=${ sub.relation }
									label=${ `${ sub.label } · ${ sub.count }` }
									icon=${ sub.icon }
									@click=${ () => ! sub.disabled && void ctx.dispatch( 'relation', { relation: sub.relation } ) }
								></os-tile>
							</span>
						</div>
					` ) }
				</div>
			</div>
			<aside class="os-mywp__detail-pane">
				<article class="os-mywp__detail">
					<h2 class="os-mywp__detail-title">${ folder.title }</h2>
					<div class="os-mywp__content" data-mywp-content="folder" os-preserve></div>
				</article>
			</aside>
		</div>
	`;
}

/** `2026-08` (or an ISO date) → `August 2026`. */
function monthLabel( raw: string ): string {
	const date = new Date( raw.length === 7 ? `${ raw }-01T00:00:00` : raw );
	return Number.isNaN( date.getTime() )
		? raw
		: date.toLocaleDateString( undefined, { month: 'long', year: 'numeric' } );
}

/** One stat tile: big number, label, optional footnote. */
function statTile( value: number, label: string, note = '' ): TemplateResult {
	return html`
		<div class="os-mywp__stat">
			<span class="os-mywp__stat-value">${ value }</span>
			<span class="os-mywp__stat-label">${ label }</span>
			${ note ? html`<span class="os-mywp__stat-note">${ note }</span>` : '' }
		</div>
	`;
}

/** The 12-month activity bar row, zero months included. */
function activityBars( activity: Array< { ym: string; count: number } > ): TemplateResult {
	const byYm = new Map( activity.map( ( a ) => [ a.ym, a.count ] ) );
	const months: Array< { ym: string; label: string; count: number } > = [];
	const cursor = new Date();
	cursor.setDate( 1 );
	cursor.setMonth( cursor.getMonth() - 11 );
	for ( let i = 0; i < 12; i++ ) {
		const ym = `${ cursor.getFullYear() }-${ String( cursor.getMonth() + 1 ).padStart( 2, '0' ) }`;
		months.push( {
			ym,
			label: cursor.toLocaleDateString( undefined, { month: 'short' } ),
			count: byYm.get( ym ) ?? 0,
		} );
		cursor.setMonth( cursor.getMonth() + 1 );
	}
	const max = Math.max( 1, ...months.map( ( m ) => m.count ) );
	return html`
		<h3 class="os-mywp__pane-h">${ __( 'Activity (last 12 months)' ) }</h3>
		<div class="os-mywp__activity" role="img" aria-label=${ __( 'Posts per month' ) }>
			${ months.map( ( m ) => html`
				<div class="os-mywp__activity-col" title="${ m.label } · ${ m.count }">
					<span class="os-mywp__activity-bar" style="block-size:${ Math.round( ( m.count / max ) * 100 ) }%"></span>
					<span class="os-mywp__activity-label">${ m.label }</span>
				</div>
			` ) }
		</div>
	`;
}

/** The clickable recent-posts list every stats pane ends with. */
function recentPosts( ctx: Ctx, recent: StatsRecentPost[] ): TemplateResult | '' {
	if ( recent.length === 0 ) {
		return '';
	}
	return html`
		<h3 class="os-mywp__pane-h">${ __( 'Recent posts' ) }</h3>
		<div class="os-mywp__recent">
			${ recent.slice( 0, 6 ).map( ( post ) => html`
				<button
					type="button"
					class="os-mywp__recent-row"
					@click=${ () => void ctx.dispatch( 'sub-open-post', { post: post.id } ) }
				>
					<span class="os-mywp__recent-title">${ post.title }</span>
					<span class="os-mywp__subtitle">${ new Date( post.date ).toLocaleString() }${ post.status ? ` · ${ post.status }` : '' }</span>
				</button>
			` ) }
		</div>
	`;
}

/** Facts + hero, shared by the user and media sub-panes. */
function dossierFacts( detail: DetailFacts ): TemplateResult {
	return html`
		${ detail.avatar ? html`<os-avatar src=${ detail.avatar } name=${ detail.title } size="xl"></os-avatar>` : '' }
		${ detail.image ? html`<img class="os-mywp__hero" src=${ detail.image } alt=${ detail.title } />` : '' }
		<h2 class="os-mywp__detail-title">${ detail.title }</h2>
		<dl class="os-mywp__facts">
			${ detail.facts.map( ( [ label, value ] ) => html`
				<div class="os-mywp__fact"><dt>${ label }</dt><dd>${ value }</dd></div>
			` ) }
		</dl>
		${ detail.usedIn
			? html`
				<h3 class="os-mywp__pane-h">${ __( 'Used in' ) }</h3>
				${ detail.usedIn.length > 0
					? html`<ul class="os-mywp__used-in">
						${ detail.usedIn.map( ( u ) => html`<li>${ u.title } <span class="os-mywp__subtitle">${ u.usedAs }</span></li>` ) }
					</ul>`
					: html`<p class="os-mywp__subtitle">${ __( 'Not used anywhere yet.' ) }</p>` }
			`
			: '' }
	`;
}

/** The right pane behind a selected sub-list row, per relation kind. */
function renderSubDetail( ctx: Ctx ): TemplateResult {
	const picked = ctx.data.subDetail;
	if ( ! picked ) {
		return html`<p class="os-mywp__pane-empty">${ __( 'Select an entry to preview it here.' ) }</p>`;
	}
	if ( picked.kind === 'term' ) {
		const stats = picked.stats;
		const posts = stats.counts?.posts ?? {};
		const published = posts.publish ?? 0;
		return html`
			<article class="os-mywp__detail">
				<header class="os-mywp__term-head">
					<span class="os-mywp__term-swatch" aria-hidden="true"></span>
					<div>
						<h2 class="os-mywp__detail-title">${ stats.profile?.name ?? '' }</h2>
						<os-badge no-dot>${ ( stats.profile?.taxonomyLabel ?? '' ).toUpperCase() }</os-badge>
						${ stats.profile?.link
							? html`<a class="os-mywp__crumb-link" href=${ stats.profile.link } target="_blank" rel="noreferrer">${ __( 'View archive' ) }</a>`
							: '' }
					</div>
				</header>
				<div class="os-mywp__stats">
					${ statTile( posts.total ?? 0, __( 'Posts' ), sprintf(
						/* translators: %d: published count. */
						__( '%d published' ),
						published,
					) ) }
					${ statTile( stats.counts?.commentsReceived ?? 0, __( 'Comments' ) ) }
					${ statTile( stats.counts?.distinctAuthors ?? 0, __( 'Authors' ) ) }
				</div>
				${ activityBars( stats.activity ?? [] ) }
				<dl class="os-mywp__facts">
					${ stats.milestones?.firstPosted
						? html`<div class="os-mywp__fact"><dt>${ __( 'First post' ) }</dt><dd>${ monthLabel( stats.milestones.firstPosted ) }</dd></div>`
						: '' }
					${ stats.milestones?.lastPosted
						? html`<div class="os-mywp__fact"><dt>${ __( 'Last post' ) }</dt><dd>${ monthLabel( stats.milestones.lastPosted ) }</dd></div>`
						: '' }
				</dl>
				${ recentPosts( ctx, stats.recent ?? [] ) }
			</article>
		`;
	}
	if ( picked.kind === 'user' ) {
		return html`
			<article class="os-mywp__detail">
				${ dossierFacts( picked.detail ) }
				${ activityBars( picked.stats?.activity ?? [] ) }
				${ recentPosts( ctx, picked.stats?.recent ?? [] ) }
			</article>
		`;
	}
	if ( picked.kind === 'comment' ) {
		const stats = picked.stats;
		return html`
			<article class="os-mywp__detail">
				<h2 class="os-mywp__detail-title">${ stats.author?.name ?? __( 'Comment' ) }</h2>
				${ stats.comment?.date ? html`<p class="os-mywp__subtitle">${ new Date( String( stats.comment.date ) ).toLocaleString() }${ stats.comment?.status ? ` · ${ stats.comment.status }` : '' }</p>` : '' }
				<div class="os-mywp__content" data-mywp-content="sub" os-preserve></div>
				${ stats.post?.id
					? html`<os-button variant="secondary" @click=${ () => void ctx.dispatch( 'sub-open-post', { post: stats.post?.id } ) }>
						${ __( 'Open the post' ) }
					</os-button>`
					: '' }
			</article>
		`;
	}
	if ( picked.kind === 'media' ) {
		return html`<article class="os-mywp__detail">${ dossierFacts( picked.detail ) }</article>`;
	}
	return html`
		<article class="os-mywp__detail">
			<h2 class="os-mywp__detail-title">${ picked.title }</h2>
			<p class="os-mywp__subtitle">${ picked.author }${ picked.date ? ` · ${ picked.date }` : '' }</p>
			<h3 class="os-mywp__pane-h">${ __( 'Preview' ) }</h3>
			<div class="os-mywp__content" data-mywp-content="sub" os-preserve></div>
		</article>
	`;
}

/** One relation's rows — the sub-list behind a detail folder tile. */
function renderSub( ctx: Ctx ): TemplateResult {
	const sub = ctx.data.sub;
	if ( ! sub ) {
		return html`<os-empty-state>${ __( 'This item no longer exists.' ) }</os-empty-state>`;
	}
	return html`
		<div class="os-mywp__split">
			<div class="os-mywp__list-pane">
				${ sub.rows.length === 0
					? html`<os-empty-state>${ __( 'Nothing here yet.' ) }</os-empty-state>`
					: html`
						<div class="os-mywp__tiles" role="list">
							${ sub.rows.map( ( row ) => html`
								<div
									class="os-mywp__cell ${ ctx.state.item === row.id ? 'is-open' : '' }"
									role="listitem"
									title=${ row.subtitle }
								>
									<span class="os-mywp__tilebox">
										<os-tile
											kind="entry"
											type="relation-row"
											ref=${ String( row.id ) }
											label=${ row.title }
											icon=${ row.thumb ? '' : ( row.icon ?? 'dashicons-media-default' ) }
											thumbnail=${ row.thumb ?? '' }
											?selected=${ ctx.state.item === row.id }
											@click=${ () => void ctx.dispatch( 'open', { item: row.id } ) }
											@dblclick=${ () => row.editUrl && void ctx.dispatch( 'sub-open', { row: row.id } ) }
										></os-tile>
									</span>
								</div>
							` ) }
						</div>
					` }
			</div>
			<aside class="os-mywp__detail-pane">${ renderSubDetail( ctx ) }</aside>
		</div>
	`;
}

/** Which body the current navigation depth paints. */
function renderBody(
	ctx: Ctx,
	section: SectionDef | null,
	inFolder: boolean,
	inSub: boolean,
	items: ListItem[],
): TemplateResult {
	if ( ! section ) {
		return renderRoot( ctx );
	}
	if ( inSub ) {
		return renderSub( ctx );
	}
	if ( inFolder ) {
		return renderFolder( ctx );
	}
	return html`
		<div class="os-mywp__split">
			<div class="os-mywp__list-pane">${ renderList( ctx, section, items ) }</div>
			<aside class="os-mywp__detail-pane">
				${ ctx.state.item > 0
					? renderDetail( ctx, section )
					: html`<p class="os-mywp__pane-empty">${ __( 'Select an entry to preview it here.' ) }</p>` }
			</aside>
		</div>
	`;
}

/** The Edit… quick-edit modal: status + comments over the selection. */
function renderQuickEdit( ctx: Ctx, section: SectionDef | null ): TemplateResult | '' {
	const ui = uiOf( ctx.root );
	const qe = ui.quickEdit;
	if ( ! qe || ! section ) {
		return '';
	}
	const close = (): void => {
		ui.quickEdit = null;
		ctx.local( 'repaint' );
	};
	const apply = (): void => {
		const payload: Record< string, unknown > = { items: qe.ids };
		if ( qe.status ) {
			payload.status = qe.status;
		}
		if ( qe.comments ) {
			payload.comments = qe.comments;
		}
		if ( qe.author ) {
			payload.author = Number( qe.author );
		}
		if ( qe.sticky ) {
			payload.sticky = qe.sticky;
		}
		if ( qe.categories.length > 0 ) {
			payload.categories = qe.categories;
		}
		if ( qe.tags.trim() ) {
			payload.tags = qe.tags;
		}
		close();
		void ctx.dispatch( 'quick-edit', payload );
	};
	const noChange: [ string, string ] = [ '', __( '— No change —' ) ];
	const pickInto = ( field: 'status' | 'comments' | 'author' | 'sticky' ) => ( e: Event ): void => {
		qe[ field ] = String( ( e as CustomEvent< { value?: string } > ).detail?.value ?? '' );
	};
	const dropdown = ( label: string, field: 'status' | 'comments' | 'author' | 'sticky', options: Array< [ string, string ] > ): TemplateResult => html`
		<label class="os-mywp__qe-row">
			<span>${ label }</span>
			<os-select value=${ qe[ field ] } @os-pick=${ pickInto( field ) }>
				${ options.map( ( [ value, text ] ) => html`
					<os-option value=${ value } ?selected=${ value === qe[ field ] }>${ text }</os-option>
				` ) }
			</os-select>
		</label>
	`;
	const isPosts = section.post_type === 'post';
	return html`
		<os-modal
			open
			size="sm"
			title=${ sprintf(
				/* translators: 1: entry count, 2: section label. */
				__( 'Edit %1$d %2$s' ),
				qe.ids.length,
				section.label,
			) }
			@os-modal-cancel=${ close }
		>
			<div class="os-mywp__qe">
				${ dropdown( __( 'Status' ), 'status', [
					noChange,
					[ 'publish', __( 'Published' ) ],
					[ 'pending', __( 'Pending Review' ) ],
					[ 'draft', __( 'Draft' ) ],
					[ 'private', __( 'Private' ) ],
				] ) }
				${ ctx.data.authors.length > 0
					? dropdown( __( 'Author' ), 'author', [
						noChange,
						...ctx.data.authors.map( ( a ): [ string, string ] => [ String( a.id ), a.name ] ),
					] )
					: '' }
				${ dropdown( __( 'Comments' ), 'comments', [
					noChange,
					[ 'open', __( 'Allow' ) ],
					[ 'closed', __( 'Do not allow' ) ],
				] ) }
				${ isPosts
					? dropdown( __( 'Sticky' ), 'sticky', [
						noChange,
						[ 'sticky', __( 'Sticky' ) ],
						[ 'not-sticky', __( 'Not sticky' ) ],
					] )
					: '' }
				${ isPosts && ctx.data.categories.length > 0
					? html`
						<div class="os-mywp__qe-row">
							<span>${ __( 'Add categories' ) }</span>
							<div class="os-mywp__qe-cats">
								${ ctx.data.categories.map( ( cat ) => html`
									<label class="os-mywp__qe-cat">
										<input
											type="checkbox"
											?checked=${ qe.categories.includes( cat.id ) }
											@change=${ ( e: Event ) => {
												const on = ( e.target as HTMLInputElement ).checked;
												qe.categories = on
													? [ ...qe.categories, cat.id ]
													: qe.categories.filter( ( c ) => c !== cat.id );
											} }
										/>
										${ cat.name }
									</label>
								` ) }
							</div>
						</div>
					`
					: '' }
				${ isPosts
					? html`
						<label class="os-mywp__qe-row">
							<span>${ __( 'Add tags' ) }</span>
							<input
								type="text"
								class="os-mywp__qe-tags"
								placeholder=${ __( 'tag, another tag' ) }
								.value=${ qe.tags }
								@input=${ ( e: Event ) => {
									qe.tags = ( e.target as HTMLInputElement ).value;
								} }
							/>
						</label>
					`
					: '' }
			</div>
			<div slot="footer">
				<os-button variant="ghost" @click=${ close }>${ __( 'Cancel' ) }</os-button>
				<os-button variant="primary" @click=${ apply }>${ __( 'Update' ) }</os-button>
			</div>
		</os-modal>
	`;
}

function renderZoom( ctx: Ctx ): TemplateResult | '' {
	const ui = uiOf( ctx.root );
	const detail = ctx.data.detail;
	if ( ! ui.zoom || ! detail?.full ) {
		return '';
	}
	return html`
		<div class="os-mywp__zoom" @click=${ () => {
			ui.zoom = false;
			ctx.local( 'repaint' );
		} }>
			<img src=${ detail.full } alt=${ detail.title } />
		</div>
	`;
}

interface Ctx {
	state: AppState;
	data: AppData;
	root: HTMLElement;
	dispatch: ( action: string, args?: Record< string, unknown > ) => Promise< boolean >;
	local: ( action: string, args?: Record< string, unknown > ) => void;
}

// ------------------------------------------------------ mounted wiring

/** Marquee + drag-out + infinite scroll + Escape, wired once per window. */
function wire( ctx: Ctx ): () => void {
	const { root } = ctx;
	const ui = uiOf( root );
	const teardowns: Array< () => void > = [];

	// --- drag-out: rows lift into the shell DragManager -----------------
	const onPointerDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey ) {
			return;
		}
		const row = ( e.target as Element | null )?.closest< HTMLElement >( '[data-mywp-drag][data-item-id]' );
		if ( ! row ) {
			return;
		}
		const manager = shell().dragManager;
		if ( ! manager ) {
			return;
		}
		const id = Number( row.getAttribute( 'data-item-id' ) );
		const kind = row.getAttribute( 'data-mywp-drag' ) ?? '';
		const all = Array.from( ui.pages.values() ).flat();
		const item = all.find( ( i ) => i.id === id );
		if ( ! item ) {
			return;
		}
		const selectedItems = ctx.state.selected.includes( id )
			? all.filter( ( i ) => ctx.state.selected.includes( i.id ) )
			: [ item ];
		manager.start( {
			payload: {
				type: 'shortcut',
				source: row,
				data: {
					kind,
					ref: String( item.id ),
					title: item.title,
					icon: item.thumb || '',
					...( selectedItems.length > 1
						? {
							items: selectedItems.map( ( i ) => ( {
								kind,
								ref: String( i.id ),
								title: i.title,
								icon: i.thumb || '',
							} ) ),
						}
						: {} ),
				},
			},
			origin: e,
		} );
	};
	root.addEventListener( 'pointerdown', onPointerDown );
	teardowns.push( () => root.removeEventListener( 'pointerdown', onPointerDown ) );

	// --- marquee selection on the list canvas ---------------------------
	let marquee: { x: number; y: number; box: HTMLDivElement } | null = null;
	const onMarqueeDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 ) {
			return;
		}
		const canvas = ( e.target as Element | null )?.closest< HTMLElement >( '.os-mywp__canvas' );
		// Only a press on empty canvas starts a marquee — a press on a
		// row is a click or a drag-out.
		if ( ! canvas || ( e.target as Element ).closest( '[data-item-id]' ) ) {
			return;
		}
		const box = document.createElement( 'div' );
		box.className = 'os-mywp__marquee';
		document.body.appendChild( box );
		marquee = { x: e.clientX, y: e.clientY, box };
		if ( ! e.ctrlKey && ! e.metaKey && ! e.shiftKey ) {
			ctx.local( 'select-set', { ids: [] } );
		}
	};
	const onMarqueeMove = ( e: PointerEvent ): void => {
		if ( ! marquee ) {
			return;
		}
		const left = Math.min( marquee.x, e.clientX );
		const top = Math.min( marquee.y, e.clientY );
		const width = Math.abs( e.clientX - marquee.x );
		const height = Math.abs( e.clientY - marquee.y );
		Object.assign( marquee.box.style, {
			left: `${ left }px`,
			top: `${ top }px`,
			width: `${ width }px`,
			height: `${ height }px`,
		} );
		const ids: number[] = [];
		for ( const row of Array.from( root.querySelectorAll< HTMLElement >( '[data-item-id]' ) ) ) {
			const r = row.getBoundingClientRect();
			if ( r.left < left + width && r.right > left && r.top < top + height && r.bottom > top ) {
				ids.push( Number( row.getAttribute( 'data-item-id' ) ) );
			}
		}
		ctx.local( 'select-set', { ids } );
	};
	const onMarqueeUp = (): void => {
		if ( marquee ) {
			marquee.box.remove();
			marquee = null;
		}
	};
	root.addEventListener( 'pointerdown', onMarqueeDown );
	document.addEventListener( 'pointermove', onMarqueeMove );
	document.addEventListener( 'pointerup', onMarqueeUp );
	teardowns.push( () => {
		root.removeEventListener( 'pointerdown', onMarqueeDown );
		document.removeEventListener( 'pointermove', onMarqueeMove );
		document.removeEventListener( 'pointerup', onMarqueeUp );
		onMarqueeUp();
	} );

	// --- infinite scroll ------------------------------------------------
	// One page per scroll gesture: firing disarms the sentinel, the
	// canvas's next scroll re-arms it (see updated()), so a window
	// parked at the bottom never chain-loads every remaining page.
	ui.observer = new IntersectionObserver( ( entries ) => {
		if ( ! entries.some( ( entry ) => entry.isIntersecting ) || ui.loadingMore || ! ui.armed ) {
			return;
		}
		ui.armed = false;
		ui.loadingMore = true;
		// Repaint now so the skeleton tiles appear while the page loads.
		ctx.local( 'repaint' );
		void ctx.dispatch( 'more' ).finally( () => {
			ui.loadingMore = false;
			ctx.local( 'repaint' );
		} );
	} );
	teardowns.push( () => ui.observer?.disconnect() );

	// --- Escape closes menu → zoom → pane -------------------------------
	const onKey = ( e: KeyboardEvent ): void => {
		if ( e.key !== 'Escape' ) {
			return;
		}
		const state = uiOf( root );
		if ( state.menu ) {
			state.menu = null;
			ctx.local( 'repaint' );
		} else if ( state.zoom ) {
			state.zoom = false;
			ctx.local( 'repaint' );
		} else if ( ctx.state.item > 0 ) {
			void ctx.dispatch( 'open', { item: 0 } );
		}
	};
	root.addEventListener( 'keydown', onKey );
	teardowns.push( () => root.removeEventListener( 'keydown', onKey ) );

	return () => teardowns.forEach( ( off ) => off() );
}

// ---------------------------------------------------------------- app

export default defineApp< AppState, AppData >( 'my-wordpress', {
	local: {
		select: ( state, args ) => {
			const order = Array.isArray( args.order ) ? ( args.order as number[] ) : [];
			state.selected = applySelection( state.selected, order, Number( args.item ), {
				ctrl: !! args.ctrl,
				shift: !! args.shift,
			} );
		},
		'select-set': ( state, args ) => {
			state.selected = ( Array.isArray( args.ids ) ? ( args.ids as number[] ) : [] ).slice();
		},
		'clear-select': ( state ) => {
			state.selected = [];
		},
		'set-sort': ( state, args ) => {
			state.sort = String( args.sort ?? '' );
		},
		// Transient UI (context menu, zoom) lives in the per-root
		// UiState — handlers mutate it directly and dispatch this
		// no-op so the runtime repaints. Nothing travels to the server.
		repaint: ( state ) => void state,
	},

	view: ( ctx ) => {
		const { state, data: payload } = ctx;
		const section = sectionOf( payload, state.section );
		const group = payload.groups.find( ( g ) => g.id === state.group ) ?? null;
		const depth = !! ( group || section );

		// The trail: ancestors are links, the current segment is plain
		// bold text — the desktop-files breadcrumb shape.
		const link = ( label: string, go: () => void ): TemplateResult =>
			html`<button type="button" class="os-mywp__crumb-link" @click=${ go }>${ label }</button>`;
		const current = ( label: string ): TemplateResult =>
			html`<span class="os-mywp__crumb-current" aria-current="page">${ label }</span>`;
		const sep = (): TemplateResult => html`<span class="os-mywp__sep" aria-hidden="true">›</span>`;
		const inFolder = section && state.into > 0;
		const inSub = inFolder && state.relation !== '';
		const crumbs: Array< TemplateResult > = [];
		if ( ! depth ) {
			crumbs.push( current( payload.siteName ) );
		} else {
			crumbs.push( link( payload.siteName, () => void ctx.dispatch( 'go' ) ) );
			if ( group ) {
				crumbs.push( sep() );
				crumbs.push(
					section
						? link( group.label, () => void ctx.dispatch( 'go', { group: group.id } ) )
						: current( group.label ),
				);
			}
			if ( section ) {
				crumbs.push( sep() );
				crumbs.push(
					inFolder
						? link( section.label, () => void ctx.dispatch( 'go', { group: state.group, section: section.id } ) )
						: current( section.label ),
				);
			}
			if ( inFolder && payload.folder ) {
				crumbs.push( sep() );
				crumbs.push(
					inSub
						? link( payload.folder.title, () => void ctx.dispatch( 'relation', { relation: '' } ) )
						: current( payload.folder.title ),
				);
			}
			if ( inSub && payload.sub ) {
				crumbs.push( sep() );
				crumbs.push( current( payload.sub.label ) );
			}
		}

		const items = section && ! inFolder
			? accumulate( uiOf( ctx.root ), listKey( state ), payload.list )
			: [];
		const loaded = items.length;
		let folderStatus: [ string, string ] | null = null;
		if ( inSub && payload.sub ) {
			folderStatus = [
				sprintf(
					/* translators: %d: item count. */
					_n( '%d item', '%d items', payload.sub.rows.length ),
					payload.sub.rows.length,
				),
				'',
			];
		} else if ( inFolder && payload.folder ) {
			folderStatus = [
				sprintf(
					/* translators: %d: folder count. */
					__( '%d folders' ),
					payload.folder.folders.length,
				),
				payload.folder.status,
			];
		}
		const statusLeft = section && ! inFolder
			? `${ sprintf(
				/* translators: 1: loaded count, 2: total count. */
				__( '%1$d of %2$d items' ),
				loaded,
				payload.list?.total ?? 0,
			) }${ state.selected.length > 0
				? ' — ' + sprintf(
					/* translators: %d: selected count. */
					__( '%d selected' ),
					state.selected.length,
				)
				: '' }`
			: sprintf(
				/* translators: %d: folder count. */
				__( '%d folders' ),
				state.group
					? payload.sections.filter( ( s ) => s.group === state.group ).length
					: payload.sections.filter( ( s ) => ! s.group ).length + payload.groups.length,
			);
		const statusRight = section && ! inFolder
			? sprintf(
				/* translators: 1: current page, 2: page count. */
				__( 'Page %1$d of %2$d' ),
				payload.list?.page ?? 1,
				payload.list?.pages ?? 1,
			)
			: '';

		return html`
			<div class="os-mywp" tabindex="-1">
				<header class="os-mywp__header">
					${ depth
						? html`<button type="button" class="os-mywp__back" aria-label=${ __( 'Back' ) } @click=${ () => void ctx.dispatch( 'back' ) }>‹</button>`
						: '' }
					<nav class="os-mywp__crumbs">${ crumbs }</nav>
				</header>
				${ section && ! inFolder
					? html`<div class="os-mywp__search">
						<os-text-field
							value=${ state.query }
							placeholder=${ sprintf(
								/* translators: %s: section label, lowercased. */
								__( 'Search %s…' ),
								section.label.toLowerCase(),
							) }
							os-bind="query"
							os-action="search"
						></os-text-field>
					</div>`
					: '' }
				<div class="os-mywp__body">
					${ renderBody( ctx, section, !! inFolder, !! inSub, items ) }
				</div>
				<footer class="os-mywp__status">
					<span>${ folderStatus ? folderStatus[ 0 ] : statusLeft }</span>
					<span>${ folderStatus ? folderStatus[ 1 ] : statusRight }</span>
				</footer>
				${ section ? renderMenu( ctx, section ) : '' }
				${ renderQuickEdit( ctx, section ) }
				${ renderZoom( ctx ) }
			</div>
		`;
	},

	mounted: ( ctx ) => wire( ctx ),

	updated: ( ctx ) => {
		const ui = uiOf( ctx.root );
		// Re-aim the infinite-scroll observer at the freshly rendered
		// sentinel — the morph may have replaced the element.
		ui.observer?.disconnect();
		const sentinel = ctx.root.querySelector( '[data-mywp-sentinel]' );
		if ( sentinel ) {
			ui.observer?.observe( sentinel );
		}
		// The tile canvas is rebuilt across renders; keep a scroll
		// listener on the current one to re-arm the sentinel — scroll
		// does not bubble, so delegation on the root cannot hear it.
		const canvas = ctx.root.querySelector< HTMLElement >( '.os-mywp__tiles' );
		if ( canvas !== ui.scrollEl ) {
			ui.scrollEl = canvas;
			canvas?.addEventListener(
				'scroll',
				() => {
					ui.armed = true;
				},
				{ passive: true },
			);
		}
		// A list shorter than the viewport can never be scrolled, so the
		// scroll-gesture re-arm would deadlock it at one page: while the
		// canvas has no scrollbar, keep the sentinel armed and let it
		// fill the viewport; once it overflows, gestures take over.
		if ( canvas && canvas.scrollHeight <= canvas.clientHeight + 4 ) {
			ui.armed = true;
		}
		// Inject the server-rendered post body — the preview pane's and
		// the detail folder's article alike. Trusted admin content from
		// our own dispatch, marked os-preserve so the diff never
		// touches it.
		const picked = ctx.data.subDetail;
		let pickedContent: string | undefined;
		if ( picked?.kind === 'revision' ) {
			pickedContent = picked.content;
		} else if ( picked?.kind === 'comment' ) {
			pickedContent = String( picked.stats.comment?.content ?? '' );
		}
		const subContent = picked ? { id: ctx.state.item, content: pickedContent } : null;
		for ( const [ where, source ] of [
			[ 'detail', ctx.data.detail ],
			[ 'folder', ctx.data.folder ],
			[ 'sub', subContent ],
		] as Array< [ string, { id: number; content?: string } | null ] > ) {
			const slot = ctx.root.querySelector< HTMLElement >( `[data-mywp-content="${ where }"]` );
			if ( slot && source?.content !== undefined ) {
				const stamp = `${ source.id }:${ source.content.length }`;
				if ( slot.dataset.mywpStamp !== stamp ) {
					slot.dataset.mywpStamp = stamp;
					slot.innerHTML = source.content;
				}
			}
		}
	},
} );

