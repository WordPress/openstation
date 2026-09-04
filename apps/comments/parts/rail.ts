/**
 * Comments app — the tab strip and the rail of conversations.
 *
 * Part of the `comments` client view: imported by the `comments.os.ts`
 * entry. The strip is `<os-tabs>` on a desk and an `<os-select>`
 * picker beside it for a narrow window (the stylesheet shows one or
 * the other); the rail is the search field, the "scoped to one post"
 * banner, one button per conversation, and a Load more footer.
 *
 * @public
 */

import { __, html, sprintf, type TemplateResult } from '@openstation/app';
import { decodeHTML } from '../../../src/utils';
import {
	NS,
	authorName,
	avatar,
	emptyState,
	normalizeStatus,
	snippet,
	statusBadge,
	timestamp,
} from './helpers';
import type { CommentCounts, CommentRow, CommentTab, Ctx, UiState } from './types';

const TABS: ReadonlyArray< { value: CommentTab; label: () => string } > = [
	{ value: 'pending', label: () => __( 'Pending' ) },
	{ value: 'all', label: () => __( 'All' ) },
	{ value: 'spam', label: () => __( 'Spam' ) },
	{ value: 'trash', label: () => __( 'Trash' ) },
	{ value: 'mine', label: () => __( 'Mine' ) },
];

/**
 * Per-tab counts. "Mine" is deliberately left bare — the counts are
 * site totals, and a site-wide number next to a viewer-scoped tab
 * would read as a bug.
 */
function countFor( tab: CommentTab, counts: CommentCounts | undefined ): number | null {
	if ( ! counts ) {
		return null;
	}
	switch ( tab ) {
		case 'pending':
			return counts.pending;
		case 'all':
			return counts.approved + counts.pending;
		case 'spam':
			return counts.spam;
		case 'trash':
			return counts.trash;
		default:
			return null;
	}
}

/**
 * The tab strip, bound to `tab` and dispatching `filter`; a new list
 * puts a narrow window back on the rail. The picker beside it is the
 * same control for a narrow container — whichever is up, the other
 * is already right when the width changes.
 */
export function tabs( ctx: Ctx, ui: UiState ): TemplateResult {
	const { state, data } = ctx;
	const toRail = (): void => {
		ui.pane = 'rail';
	};
	const items = TABS.map( ( tab ) => {
		const count = countFor( tab.value, data.counts );
		return {
			value: tab.value,
			label:
				count === null
					? tab.label()
					: sprintf(
						/* translators: 1: tab label, 2: comment count. */
						__( '%1$s (%2$s)' ),
						tab.label(),
						String( count ),
					),
		};
	} );
	return html`
		<os-tabs
			class="${ NS }__tabrow"
			value=${ state.tab }
			label=${ __( 'Comment status' ) }
			os-bind="tab"
			os-action="filter"
			@os-tab-change=${ toRail }
			data-os-comments-tabs
		>${ TABS.map( ( tab ) => {
			const count = countFor( tab.value, data.counts );
			return html`<os-tab value=${ tab.value }>${ tab.label() }${
				count === null
					? ''
					: html`<os-badge class="${ NS }__tab-count" tone="neutral" no-dot>${ count }</os-badge>`
			}</os-tab>`;
		} ) }</os-tabs>
		<os-select
			class="${ NS }__tabselect"
			aria-label=${ __( 'Comment status' ) }
			value=${ state.tab }
			.items=${ items }
			os-bind="tab"
			os-action="filter"
			@os-pick=${ toRail }
			data-os-comments-tabselect
		></os-select>
	`;
}

/** "Filtered to one post" banner + a Show-all escape hatch. */
function filterBanner( ctx: Ctx, ui: UiState, rows: CommentRow[] ): TemplateResult {
	const title = rows[ 0 ]?.openstation_post_title;
	const clear = (): void => {
		ui.pane = 'rail';
		void ctx.dispatch( 'filter', { post: 0 } );
	};
	return html`<div class="${ NS }__rail-filter">
		<span class="${ NS }__rail-filter-label">${
			title
				? /* translators: %s: post title. */ sprintf( __( 'On: %s' ), decodeHTML( title ) )
				: __( 'Comments on this post' )
		}</span>
		<os-button class="${ NS }__rail-filter-clear" variant="link" @click=${ clear }>${ __( 'Show all' ) }</os-button>
	</div>`;
}

function threadItem( ctx: Ctx, ui: UiState, row: CommentRow ): TemplateResult {
	const selected = ctx.state.selected === row.id;
	const pick = (): void => {
		// The user asked for this one: on a narrow window that is the
		// moment the list gives way to the conversation. Re-picking the
		// conversation already on screen is local — a request would
		// throw away scroll position and a half-written reply.
		ui.pane = 'convo';
		if ( selected && ui.thread ) {
			ctx.repaint();
			return;
		}
		void ctx.dispatch( 'select', { id: row.id } );
	};
	const replies = row.openstation_replies_count ?? 0;
	// `role="listitem"` lives on a wrapper: on the button it would
	// override the button role and cost the row its keyboard semantics.
	// `aria-current` (not `aria-selected`) is the signal for a list of
	// buttons.
	return html`<div role="listitem" class="${ NS }__thread-slot">
		<button
			type="button"
			class="${ NS }__thread${ selected ? ' is-selected' : '' }${ ui.busy.startsWith( `${ row.id }:` ) ? ' is-busy' : '' }"
			data-id=${ row.id }
			aria-current=${ selected ? 'true' : '' }
			@click=${ pick }
		>
			${ avatar( row, 36 ) }
			<div class="${ NS }__thread-main">
				<div class="${ NS }__thread-name">${ authorName( row ) }${ statusBadge( normalizeStatus( row ), true ) }</div>
				<div class="${ NS }__thread-snip">${ snippet( row ) }</div>
				<div class="${ NS }__thread-post">${ decodeHTML( row.openstation_post_title || '' ) }</div>
			</div>
			<div class="${ NS }__thread-meta">
				${ timestamp( row.date_gmt, `${ NS }__thread-time`, true ) }
				${ replies > 0
					? html`<os-badge class="${ NS }__reply-count" tone="neutral" no-dot>${ replies }<span class="screen-reader-text">${ sprintf(
						/* translators: %d: number of direct replies. */
						__( '%d replies' ),
						replies,
					) }</span></os-badge>`
					: '' }
			</div>
		</button>
	</div>`;
}

/** "Load more" footer — only when the server says there's another page. */
function loadMoreRow( ctx: Ctx, ui: UiState ): TemplateResult {
	const more = (): void => {
		ui.loadingMore = true;
		ctx.repaint();
		void ctx.dispatch( 'page', { page: ctx.state.page + 1 } ).finally( () => {
			ui.loadingMore = false;
			ctx.repaint();
		} );
	};
	return html`<div class="${ NS }__load-more">
		<os-button variant="ghost" ?busy=${ ui.loadingMore } ?disabled=${ ui.loadingMore } @click=${ more }>${ __( 'Load more' ) }</os-button>
	</div>`;
}

/**
 * The rail: search, scope banner, the conversations, Load more.
 * `error` is the last rail envelope's — a response that left the rail
 * out (a `select`) neither raises nor clears it.
 */
export function rail( ctx: Ctx, ui: UiState, rows: CommentRow[], error: string ): TemplateResult {
	const { state } = ctx;
	const scoped = state.post > 0;
	let body: TemplateResult | TemplateResult[];
	if ( error ) {
		body = emptyState(
			'warning',
			__( 'Could not load comments' ),
			__( 'Check your connection and try another tab.' ),
		);
	} else if ( rows.length === 0 ) {
		body = scoped
			? emptyState(
				'admin-comments',
				__( 'Nothing on this post here' ),
				__( 'This post has no comments in this view — try another tab.' ),
			)
			: emptyState(
				'admin-comments',
				__( 'No conversations yet' ),
				__( 'Comments in this view will show up here.' ),
			);
	} else {
		body = rows.map( ( row ) => threadItem( ctx, ui, row ) );
	}
	return html`<aside class="${ NS }__rail" aria-label=${ __( 'Conversations' ) }>
		<div class="${ NS }__search">
			<os-text-field
				placeholder=${ __( 'Search comments…' ) }
				os-bind="search"
				os-action="filter"
				os-debounce="300"
				data-os-comments-search
			></os-text-field>
		</div>
		<div class="${ NS }__list" role="list" aria-label=${ __( 'Conversations' ) } data-os-comments-list>
			${ scoped && ! error ? filterBanner( ctx, ui, rows ) : '' }
			${ body }
			${ ! error && rows.length > 0 && ui.list.hasMore() ? loadMoreRow( ctx, ui ) : '' }
		</div>
	</aside>`;
}
