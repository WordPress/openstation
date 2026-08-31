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

import { __, defineApp, html, sprintf, type TemplateResult } from '@openstation/app';

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
	query: string;
	page: number;
	sort: string;
	selected: number[];
}

export interface AppData {
	siteName: string;
	sections: SectionDef[];
	groups: GroupDef[];
	sortOptions: Record< string, string >;
	list: ListPage | null;
	detail: DetailFacts | null;
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
	menu: { x: number; y: number; item: ListItem } | null;
	zoom: boolean;
	loadingMore: boolean;
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
		ui = { menu: null, zoom: false, loadingMore: false, cacheKey: '', pages: new Map(), total: 0, pageCount: 1 };
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
	return html`<img class="${ cls } os-mywp__icon-img" src=${ icon } alt="" />`;
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
					data-drag-kind="section"
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

function rowArt( section: SectionDef, item: ListItem ): TemplateResult {
	if ( item.thumb ) {
		return html`<img class="os-mywp__thumb" src=${ item.thumb } alt="" loading="lazy" />`;
	}
	return glyph( section.icon, 'os-mywp__glyph' );
}

function renderRow( ctx: Ctx, section: SectionDef, item: ListItem, order: number[] ): TemplateResult {
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
			class="os-mywp__row ${ isSelected ? 'is-selected' : '' } ${ isOpen ? 'is-open' : '' }"
			data-item-id=${ String( item.id ) }
			data-drag-kind=${ section.kind === 'user' ? 'user' : section.post_type }
			role="option"
			aria-selected=${ isSelected ? 'true' : 'false' }
			@click=${ select }
			@dblclick=${ () => item.canEdit && void ctx.dispatch( 'edit', { item: item.id } ) }
			@contextmenu=${ ( e: MouseEvent ) => {
				e.preventDefault();
				uiOf( ctx.root ).menu = { x: e.clientX, y: e.clientY, item };
				ctx.local( 'repaint' );
			} }
		>
			${ rowArt( section, item ) }
			<span class="os-mywp__meta">
				<span class="os-mywp__title">${ item.title }</span>
				<span class="os-mywp__subtitle">${ item.subtitle }</span>
			</span>
			${ item.lockedBy
				? html`<os-badge no-dot title=${ sprintf(
					/* translators: %s: user display name. */
					__( '%s is editing' ),
					item.lockedBy,
				) }>🔒 ${ item.lockedBy }</os-badge>`
				: '' }
			${ item.status && item.status !== 'publish'
				? html`<os-badge no-dot>${ item.status.charAt( 0 ).toUpperCase() + item.status.slice( 1 ) }</os-badge>`
				: '' }
		</div>
	`;
}

function renderToolbar( ctx: Ctx, section: SectionDef, items: ListItem[] ): TemplateResult {
	const { state, data } = ctx;
	const selected = state.selected;
	const selectedItems = items.filter( ( i ) => selected.includes( i.id ) );
	const copyLinks = (): void => {
		const links = selectedItems.map( ( i ) => i.link ).filter( Boolean );
		void navigator.clipboard?.writeText( links.join( '\n' ) );
		shell().showToast?.( {
			message: sprintf(
				/* translators: %d: link count. */
				__( 'Copied %d links.' ),
				links.length,
			),
		} );
	};
	return html`
		<div class="os-mywp__toolbar">
			<os-select value=${ state.sort || 'default' } os-bind="sort" os-action="sort">
				${ Object.entries( data.sortOptions ).map( ( [ value, label ] ) => html`
					<os-option value=${ value } ?selected=${ value === ( state.sort || 'default' ) }>${ label }</os-option>
				` ) }
			</os-select>
			${ selected.length > 0
				? html`
					<div class="os-mywp__bulk">
						<span>${ sprintf(
							/* translators: %d: selected count. */
							__( '%d selected' ),
							selected.length,
						) }</span>
						${ section.kind === 'post'
							? html`<os-button
								variant="danger"
								os-action="bulk-trash"
								os-confirm=${ __( 'Move the selected items to the Trash?' ) }
								os-confirm-label=${ __( 'Trash' ) }
								os-confirm-danger
							>${ __( 'Trash selected' ) }</os-button>`
							: '' }
						<os-button variant="ghost" @click=${ copyLinks }>${ __( 'Copy links' ) }</os-button>
						<os-button variant="ghost" @click=${ () => ctx.local( 'clear-select' ) }>${ __( 'Clear' ) }</os-button>
					</div>
				`
				: '' }
		</div>
	`;
}

function renderList( ctx: Ctx, section: SectionDef ): TemplateResult {
	const { data } = ctx;
	const ui = uiOf( ctx.root );
	const items = accumulate( ui, listKey( ctx.state ), data.list );
	if ( items.length === 0 ) {
		return html`
			${ renderToolbar( ctx, section, items ) }
			<os-empty-state icon=${ section.icon.startsWith( 'dashicons-' ) ? section.icon : 'dashicons-portfolio' }>
				${ ctx.state.query ? __( 'Nothing matches the search.' ) : __( 'Nothing here yet.' ) }
			</os-empty-state>
		`;
	}
	const order = items.map( ( i ) => i.id );
	const hasMore = ui.pageCount > Math.max( ...Array.from( ui.pages.keys() ), 1 );
	return html`
		${ renderToolbar( ctx, section, items ) }
		<div
			class="os-mywp__list os-mywp__canvas ${ section.kind === 'media' ? 'os-mywp__list--grid' : '' }"
			role="listbox"
			aria-multiselectable="true"
		>
			${ items.map( ( item ) => renderRow( ctx, section, item, order ) ) }
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
					<div class="os-mywp__content" data-mywp-content os-preserve></div>
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
	const actions = resolveActions( ctx.data.previewActions, actionContext( section, item, 'menu' ), shell().hooks );
	const close = (): void => {
		uiOf( ctx.root ).menu = null;
		ctx.local( 'repaint' );
	};
	const pick = ( e: Event ): void => {
		const id = String( ( e as CustomEvent< { id?: string } > ).detail?.id ?? '' );
		close();
		if ( id === 'open' ) {
			void ctx.dispatch( 'open', { item: item.id } );
		} else if ( id === 'edit' ) {
			void ctx.dispatch( 'edit', { item: item.id } );
		} else if ( id === 'trash' ) {
			void ctx.dispatch( 'trash', { item: item.id } );
		} else {
			const action = actions.find( ( a ) => a.id === id );
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
			<os-context-menu-option id="open">${ __( 'Open' ) }</os-context-menu-option>
			${ item.canEdit
				? html`<os-context-menu-option id="edit">
					${ section.kind === 'user' ? __( 'Edit profile' ) : __( 'Open in editor' ) }
				</os-context-menu-option>`
				: '' }
			${ actions.map( ( a ) => html`<os-context-menu-option id=${ a.id } icon=${ a.icon ?? '' }>${ a.label }</os-context-menu-option>` ) }
			${ section.kind === 'post'
				? html`<os-context-menu-option id="trash" danger ?disabled=${ ! item.canDelete }>${ __( 'Trash' ) }</os-context-menu-option>`
				: '' }
		</os-context-menu>
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
		const row = ( e.target as Element | null )?.closest< HTMLElement >( '[data-drag-kind][data-item-id]' );
		if ( ! row ) {
			return;
		}
		const manager = shell().dragManager;
		if ( ! manager ) {
			return;
		}
		const id = Number( row.getAttribute( 'data-item-id' ) );
		const kind = row.getAttribute( 'data-drag-kind' ) ?? '';
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
	ui.observer = new IntersectionObserver( ( entries ) => {
		if ( ! entries.some( ( entry ) => entry.isIntersecting ) || ui.loadingMore ) {
			return;
		}
		ui.loadingMore = true;
		void ctx.dispatch( 'more' ).finally( () => {
			ui.loadingMore = false;
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
		const status = section
			? `${ sprintf(
				/* translators: %d: item count. */
				__( '%d items' ),
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

		return html`
			<div class="os-mywp" tabindex="-1">
				<header class="os-mywp__header">
					${ depth
						? html`<os-button variant="ghost" class="os-mywp__back" aria-label=${ __( 'Back' ) } @click=${ () => void ctx.dispatch( 'back' ) }>‹</os-button>`
						: '' }
					<nav class="os-mywp__crumbs">
						<os-button variant="ghost" @click=${ () => void ctx.dispatch( 'go' ) }>${ payload.siteName }</os-button>
						${ group ? html`
							<span class="os-mywp__sep" aria-hidden="true">›</span>
							<os-button variant="ghost" @click=${ () => void ctx.dispatch( 'go', { group: group.id } ) }>${ group.label }</os-button>
						` : '' }
						${ section ? html`
							<span class="os-mywp__sep" aria-hidden="true">›</span>
							<os-button variant="ghost" @click=${ () => void ctx.dispatch( 'go', { group: state.group, section: section.id } ) }>${ section.label }</os-button>
						` : '' }
					</nav>
					${ section
						? html`<os-text-field
							value=${ state.query }
							placeholder=${ sprintf(
								/* translators: %s: section label. */
								__( 'Search %s…' ),
								section.label,
							) }
							os-bind="query"
							os-action="search"
						></os-text-field>`
						: '' }
				</header>
				<div class="os-mywp__body">
					${ ! section
						? renderRoot( ctx )
						: html`
							<div class="os-mywp__split">
								<div class="os-mywp__list-pane">${ renderList( ctx, section ) }</div>
								${ state.item > 0
									? html`<aside class="os-mywp__detail-pane">${ renderDetail( ctx, section ) }</aside>`
									: '' }
							</div>
						` }
				</div>
				<footer class="os-mywp__status">${ status }</footer>
				${ section ? renderMenu( ctx, section ) : '' }
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
		// Inject the server-rendered post preview. Trusted admin
		// content from our own dispatch, marked os-preserve so the
		// diff never touches it.
		const slot = ctx.root.querySelector< HTMLElement >( '[data-mywp-content]' );
		const detail = ctx.data.detail;
		if ( slot && detail?.content !== undefined ) {
			const stamp = `${ detail.id }:${ detail.content.length }`;
			if ( slot.dataset.mywpStamp !== stamp ) {
				slot.dataset.mywpStamp = stamp;
				slot.innerHTML = detail.content;
			}
		}
	},
} );

