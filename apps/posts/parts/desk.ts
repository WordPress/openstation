/** Editorial previews and the page directory, sharing the existing list contract. */
import { __, copyText, html, sprintf, type TemplateResult } from '@openstation/app';
import { decodeHTML } from '../../../src/utils';
import '../../../src/ui/components/os-checkbox/os-checkbox';
import '../../../src/ui/components/os-stat/os-stat';
import '../../../src/ui/components/os-select/os-select';
import { buildColumns, pluginColumns, type ColumnFilterData } from './columns';
import { authorOf, buildEditPostUrl, featuredMediaOf, STATUS_LABELS, termRecordsOf, titleOf, type CellEnv } from './cells/env';
import { tableOf, type Ctx } from './window-context';
import type { OsTableColumn } from '../../../src/ui/components/os-table/os-table';
import type { PostListItem } from './types';

export interface DeskState {
	view: 'desk' | 'table';
	filters: boolean;
	peek: boolean;
	focused: number | null;
	inspectorKey: string;
	fields: Array< { key: string; label: string; node: unknown } >;
}

export const freshDesk = (): DeskState => ( { view: 'desk', filters: false, peek: false, focused: null, inspectorKey: '', fields: [] } );

/** Excerpts are text, never executable markup from content. */
export function excerptOf( row: PostListItem ): string {
	return decodeHTML( ( row.excerpt?.rendered ?? '' ).replace( /<[^>]*>/g, ' ' ) ).replace( /\s+/g, ' ' ).trim();
}

/** The parent can be outside the current server page; never invent its title. */
export function pageLocation( row: PostListItem, rows: PostListItem[] ): string {
	if ( ! row.parent ) {
		return __( 'Top-level page' );
	}
	const parent = rows.find( ( item ) => item.id === row.parent );
	return parent ? titleOf( parent ) : sprintf( /* translators: %d: parent page ID. */ __( 'Parent page #%d' ), row.parent );
}

function edit( ctx: Ctx, row: PostListItem ): void {
	ctx.host.openUrl?.( buildEditPostUrl( ctx.extra, row.id ), titleOf( row ) || __( '(no title)' ), ctx.extra.mode === 'pages' ? 'dashicons-admin-page' : 'dashicons-admin-post' );
}

function status( row: PostListItem ): TemplateResult {
	return html`<span class="os-posts-desk__status" data-status=${ row.status }>${ STATUS_LABELS[ row.status ] ?? row.status }</span>`;
}

function pageRole( ctx: Ctx, row: PostListItem ): string {
	if ( ctx.extra.frontPageId === row.id ) {
		return __( 'Front page' );
	}
	return ctx.extra.postsPageId === row.id ? __( 'Posts page' ) : '';
}

/** Focus a real shadow button after the detail pane opens or closes. */
function focusControl( root: HTMLElement, selector: string ): void {
	queueMicrotask( () => root.querySelector( selector )?.shadowRoot?.querySelector< HTMLButtonElement >( 'button' )?.focus() );
}

export function deskTools( ctx: Ctx, ui: DeskState ): TemplateResult {
	const pages = ctx.extra.mode === 'pages';
	const items = ctx.data?.list.items ?? [];
	const selected = tableOf( ctx )?.selection ?? new Set();
	const all = items.length > 0 && items.every( ( row ) => selected.has( row.id ) );
	const changeView = ( e: Event ): void => {
		ui.view = ( e as CustomEvent ).detail.value === 'table' ? 'table' : 'desk';
		ctx.repaint();
	};
	const sort = ( e: Event ): void => {
		const [ orderby, order ] = String( ( e as CustomEvent ).detail.value ).split( ':' );
		void ctx.dispatch( 'sort', { orderby, order } );
	};
	return html`<div class="os-posts-desk__tools ${ ui.filters ? 'is-expanded' : '' }">
		<os-text-field id=${ `${ ctx.windowId }-content-search` } class="os-app-list__search" data-os-posts-search
			aria-label=${ pages ? __( 'Search pages' ) : __( 'Search posts' ) } os-bind="search" os-action="filter" os-debounce="250"
			value=${ ctx.state.search } placeholder=${ pages ? __( 'Search pages…' ) : __( 'Search posts…' ) }></os-text-field>
		<os-button class="os-posts-desk__filter-toggle" variant="secondary" aria-expanded=${ String( ui.filters ) } @click=${ () => {
 ui.filters = ! ui.filters; ctx.repaint();
} }>${ __( 'Options' ) }</os-button>
		<os-checkbox label=${ __( 'Select loaded' ) } ?checked=${ all }
			@os-checkbox-change=${ () => {
 if ( all ) {
 tableOf( ctx )?.clearSelection();
} else {
 tableOf( ctx )?.selectAll();
}
} }></os-checkbox>
		<os-select aria-label=${ __( 'Sort content' ) } value=${ `${ ctx.state.orderby }:${ ctx.state.order }` } @os-pick=${ sort }>
			${ pages ? html`<os-option value="menu_order:asc">${ __( 'Page order' ) }</os-option>` : '' }
			<os-option value="date:desc">${ __( 'Newest first' ) }</os-option>
			<os-option value="date:asc">${ __( 'Oldest first' ) }</os-option>
			<os-option value="modified:desc">${ __( 'Recently edited' ) }</os-option>
			<os-option value="title:asc">${ __( 'Title A–Z' ) }</os-option>
			<os-option value="title:desc">${ __( 'Title Z–A' ) }</os-option>
			<os-option value="author:asc">${ __( 'By author' ) }</os-option>
			<os-option value="author:desc">${ __( 'By author, reversed' ) }</os-option>
			<os-option value="modified:asc">${ __( 'Least recently edited' ) }</os-option>
			<os-option value="comment_count:asc">${ __( 'Fewest comments' ) }</os-option>
			<os-option value="comment_count:desc">${ __( 'Most comments' ) }</os-option>
		</os-select>
		<os-select aria-label=${ __( 'Content view' ) } value=${ ui.view } @os-pick=${ changeView } data-os-posts-view>
			<os-option value="desk">${ pages ? __( 'Page directory' ) : __( 'Writing desk' ) }</os-option>
			<os-option value="table">${ __( 'Details table' ) }</os-option>
		</os-select>
	</div>`;
}

/** Keep the reference visible; copy the plain number for queries and shortcodes. */
function contentId( ctx: Ctx, row: PostListItem ): TemplateResult {
	const pages = ctx.extra.mode === 'pages';
	const label = sprintf( /* translators: %d: content ID. */ pages ? __( 'Copy page ID %d' ) : __( 'Copy post ID %d' ), row.id );
	return html`<os-button variant="ghost" class="os-posts-desk__id" title=${ label } @click=${ async ( e: Event ) => {
		e.stopPropagation();
		const copied = await copyText( String( row.id ) );
		const message = copied
			? sprintf( /* translators: %d: content ID. */ pages ? __( 'Copied page ID #%d.' ) : __( 'Copied post ID #%d.' ), row.id )
			: __( 'Couldn’t copy the ID. Please try again.' );
		ctx.host.toast?.( { message } );
	} }><span class="screen-reader-text">${ label }</span><span aria-hidden="true">#${ row.id }</span><span class="dashicons dashicons-admin-page" aria-hidden="true"></span></os-button>`;
}

/**
 * A plugin column's cell for the card, or nothing when the renderer painted
 * nothing. A renderer that returns an empty node for "absent" (the documented
 * way to keep a table column aligned) must not leave a labelled blank on
 * every card that has no value.
 */
function pluginStat( col: OsTableColumn< PostListItem >, row: PostListItem ): TemplateResult | '' {
	const value = ( row as Record< string, unknown > )[ col.key ];
	let node: unknown = '';
	if ( col.render ) {
		node = col.render( value as never, row, 0 );
	} else if ( value !== null && value !== undefined ) {
		node = String( value );
	}
	if ( node === null || node === undefined || node === '' || ( node instanceof Element && ! node.childNodes.length && ! node.textContent ) ) {
		return '';
	}
	return html`<div class="os-posts-desk__plugin-stat" data-column=${ col.key }><span class="os-posts-desk__plugin-stat-value">${ node }</span><span class="os-posts-desk__plugin-stat-label">${ col.label || col.key }</span></div>`;
}

function story( ctx: Ctx, ui: DeskState, row: PostListItem, focused: number | undefined, extras: OsTableColumn< PostListItem >[] = [] ): TemplateResult {
	const pages = ctx.extra.mode === 'pages';
	const title = titleOf( row ) || __( '(no title)' );
	const media = featuredMediaOf( row );
	const category = termRecordsOf( row, 'category' )[ 0 ]?.name;
	const role = pageRole( ctx, row );
	const kicker = pages ? pageLocation( row, ctx.data?.list.items ?? [] ) : decodeHTML( category || __( 'Story' ) );
	let artwork: TemplateResult | string = '';
	if ( pages ) {
		artwork = html`<div class="os-posts-desk__page-mark" aria-hidden="true"><span class="dashicons ${ role ? 'dashicons-admin-home' : 'dashicons-admin-page' }"></span><i></i><i></i><i></i></div>`;
	} else if ( media ) {
		artwork = html`<img class="os-posts-desk__thumbnail" src=${ media.url } alt="" loading="lazy" @error=${ ( e: Event ) => ( e.target as HTMLElement ).hidden = true }>`;
	}
	const open = (): void => {
		ui.focused = row.id;
		ui.peek = true;
		ctx.repaint();
		focusControl( ctx.root, '[data-os-posts-inspect-close]' );
	};
	return html`<article class="os-posts-desk__story ${ focused === row.id ? 'is-current' : '' }" data-story-id=${ row.id }>
		<div class="os-posts-desk__story-top">
			${ status( row ) }
			${ role ? html`<span class="os-posts-desk__role">${ role }</span>` : '' }
			${ contentId( ctx, row ) }
			<os-checkbox aria-label=${ sprintf( /* translators: %s: content title. */ __( 'Select %s' ), title ) }
				class="os-posts-desk__select" ?checked=${ tableOf( ctx )?.selection.has( row.id ) ?? false }
				@os-checkbox-change=${ ( e: Event ) => {
 if ( ( e as CustomEvent ).detail.checked ) {
 tableOf( ctx )?.select( row.id );
} else {
 tableOf( ctx )?.deselect( row.id );
}
} }></os-checkbox>
		</div>
		<div class="os-posts-desk__story-content">
			${ artwork }
			<div class="os-posts-desk__story-copy">
				<div class="os-posts-desk__kicker">${ kicker }</div>
				<h3><a href=${ buildEditPostUrl( ctx.extra, row.id ) } @click=${ ( e: Event ) => {
 e.preventDefault(); edit( ctx, row );
} }>${ title }</a></h3>
				<p class="os-posts-desk__excerpt">${ pages ? `/${ row.slug || '' }` : excerptOf( row ) || __( 'Every story starts somewhere. Open the editor to keep writing.' ) }</p>
			</div>
		</div>
		<div class="os-posts-desk__metrics" data-content-metrics=${ `${ row.id }:${ row.modified_gmt }` } data-post-id=${ row.id }>
			<os-stat data-metric="words" value="—" label=${ __( 'Words' ) } title=${ __( 'Words in the complete page or post body' ) }></os-stat>
			<os-stat data-metric="comments" value=${ typeof row.openstation_comment_count === 'number' ? String( row.openstation_comment_count ) : '—' } label=${ __( 'Comments' ) } title=${ __( 'Approved comments' ) }></os-stat>
			${ ! pages ? html`<os-stat value=${ String( row.tags?.length ?? 0 ) } label=${ __( 'Tags' ) }></os-stat>` : '' }
			${ extras.map( ( col ) => pluginStat( col, row ) ) }
		</div>
		${ row.openstation_lock ? html`<p class="os-posts-desk__lock"><span class="dashicons dashicons-lock" aria-hidden="true"></span>${ sprintf( /* translators: %s: person editing. */ __( '%s is editing' ), row.openstation_lock.userName ) }</p>` : '' }
		<footer class="os-posts-desk__story-foot">
			<span class="os-posts-desk__byline">${ authorOf( row ).name }<span aria-hidden="true"> · </span><os-relative-time datetime=${ row.modified_gmt || row.date_gmt }></os-relative-time></span>
			<os-button variant="ghost" @click=${ () => edit( ctx, row ) }>${ __( 'Edit' ) }<span aria-hidden="true"> ↗</span></os-button>
			<os-button variant="secondary" data-inspect-id=${ row.id } @click=${ open }>${ __( 'Details' ) }</os-button>
		</footer>
	</article>`;
}

function inspector( ctx: Ctx, ui: DeskState, env: CellEnv, filters: ColumnFilterData, hidden: Set< string >, row?: PostListItem ): TemplateResult | string {
	if ( ! row || ! ui.peek || ui.focused === null ) {
		return '';
	}
	const key = JSON.stringify( [ row, Array.from( hidden ) ] );
	if ( key !== ui.inspectorKey ) {
		ui.inspectorKey = key;
		// Separate nodes from the table: an element has exactly one DOM owner.
		ui.fields = buildColumns( env, new Map(), filters, false, hidden ).filter( ( col ) => ! [ 'title', 'author', 'date' ].includes( col.key ) ).map( ( col ) => ( {
			key: col.key, label: col.label || col.key, node: col.render ? col.render( row[ col.key ], row, 0 ) : String( row[ col.key ] ?? '—' ),
		} ) );
		for ( const picker of env.categories.pickers ) {
			if ( ! picker.isConnected ) {
				env.categories.pickers.delete( picker );
			}
		}
	}
	const media = featuredMediaOf( row );
	const close = (): void => {
		const previous = ui.focused ?? row.id;
		ui.focused = null;
		ui.peek = false;
		ctx.repaint();
		focusControl( ctx.root, `[data-inspect-id="${ previous }"]` );
	};
	return html`<aside class="os-posts-desk__inspector ${ ui.focused !== null ? 'is-open' : '' }" aria-label=${ __( 'Content details' ) }
		@keydown=${ ( e: KeyboardEvent ) => {
 if ( e.key === 'Escape' ) {
 e.stopPropagation(); close();
}
} }>
		<header class="os-posts-desk__inspector-head"><span>${ ctx.extra.mode === 'pages' ? __( 'PAGE DETAILS' ) : __( 'STORY DETAILS' ) }</span><os-button variant="ghost" data-os-posts-inspect-close @click=${ close }>${ __( 'Close details' ) }</os-button></header>
		<div class="os-posts-desk__inspector-scroll">
			${ media ? html`<img class="os-posts-desk__cover" src=${ media.url } alt=${ media.alt } @error=${ ( e: Event ) => ( e.target as HTMLElement ).hidden = true }>` : '' }
			${ status( row ) }
			<h2>${ titleOf( row ) || __( '(no title)' ) }</h2>
			<p class="os-posts-desk__byline">${ authorOf( row ).name }</p>
			${ row.openstation_lock ? html`<os-notice tone="warning">${ sprintf( /* translators: %s: person editing. */ __( '%s is currently editing' ), row.openstation_lock.userName ) }</os-notice>` : '' }
			<p class="os-posts-desk__preview">${ excerptOf( row ) || __( 'No excerpt yet.' ) }</p>
			<dl class="os-posts-desk__dates"><div><dt>${ row.status === 'future' ? __( 'Scheduled for' ) : __( 'Date' ) }</dt><dd><os-relative-time datetime=${ row.date_gmt || row.date }></os-relative-time></dd></div><div><dt>${ __( 'Last edited' ) }</dt><dd><os-relative-time datetime=${ row.modified_gmt || row.modified }></os-relative-time></dd></div></dl>
			<div class="os-posts-desk__fields">${ ui.fields.map( ( field ) => html`<section data-detail-field=${ field.key }><h3>${ field.label }</h3>${ field.node }</section>` ) }</div>
		</div>
		<footer class="os-posts-desk__inspector-actions"><os-button variant="primary" @click=${ () => edit( ctx, row ) }>${ __( 'Open editor' ) }<span aria-hidden="true"> ↗</span></os-button>
			${ row.link && row.status === 'publish' ? html`<a href=${ row.link } target="_blank" rel="noopener noreferrer">${ __( 'View on site' ) } ↗</a>` : '' }
		</footer>
	</aside>`;
}

export function renderDesk( ctx: Ctx, ui: DeskState, env: CellEnv, filters: ColumnFilterData, hidden: Set< string >, tail?: TemplateResult ): TemplateResult {
	const emptyTitle = ctx.extra.mode === 'pages' ? __( 'No pages found.' ) : __( 'No posts found.' );
	const rows = ctx.data?.list.items ?? [];
	const focused = rows.find( ( row ) => row.id === ui.focused ) ?? rows[ 0 ];
	// Resolved once per paint, not per card: the columns filter runs on every
	// call, and a feed of fifty cards should ask it once.
	const extras = rows.length ? pluginColumns( env, filters, hidden ) : [];
	return html`<div class="os-posts-desk__workspace ${ ui.focused !== null && focused ? 'has-detail' : '' }" ?hidden=${ ui.view !== 'desk' }>
		<div class="os-posts-desk__feed" aria-label=${ ctx.extra.mode === 'pages' ? __( 'Page directory' ) : __( 'Stories' ) }>
			${ rows.length ? rows.map( ( row ) => story( ctx, ui, row, ui.peek ? focused?.id : undefined, extras ) ) : html`<div class="os-posts-desk__empty"><span class="dashicons dashicons-welcome-write-blog" aria-hidden="true"></span><h3>${ ctx.loading ? __( 'Opening your workspace…' ) : emptyTitle }</h3><p>${ ctx.loading ? __( 'Your content will appear here.' ) : __( 'Try a different search or change the status filter.' ) }</p></div>` }
			${ tail ?? '' }
		</div>
		${ ui.peek ? inspector( ctx, ui, env, filters, hidden, focused ) : '' }
	</div>`;
}

/** Compact card checkboxes keep their accessible name on the native input. */
export function syncDeskControls( root: HTMLElement ): void {
	queueMicrotask( () => {
		for ( const host of root.querySelectorAll( '.os-posts-desk__select, [data-os-posts-search]' ) ) {
			host.shadowRoot?.querySelector( 'input' )?.setAttribute( 'aria-label', host.getAttribute( 'aria-label' ) || '' );
		}
		const toggle = root.querySelector( '.os-posts-desk__filter-toggle' );
		toggle?.shadowRoot?.querySelector( 'button' )?.setAttribute( 'aria-expanded', toggle.getAttribute( 'aria-expanded' ) || 'false' );
	} );
}
