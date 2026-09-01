/**
 * My WordPress — the detail and dossier panes.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. This part paints what a selection
 * SHOWS: the preview pane's dossier, the detail folder a post
 * navigates into, the relation sub-lists, and the WP Explorer stats
 * panes (term card, user dossier, comment, revision preview) behind a
 * selected sub-row.
 *
 * @public
 */

import { __, _n, html, sprintf, type TemplateResult } from '@openstation/app';
import {
	shell,
	uiOf,
	type Ctx,
	type DetailFacts,
	type SectionDef,
	type StatsRecentPost,
} from './types';
import { actionContext, resolveActions, runAction } from './helpers';

export function renderDetail( ctx: Ctx, section: SectionDef ): TemplateResult {
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

/**
 * The detail FOLDER view a post navigates into: relation folder tiles
 * on the left (Author, Contributors, Comments · N, Categories, Tags,
 * Attached media, Revisions), the rendered article on the right.
 * Double-click a folder to drill into its rows, like the original.
 */
export function renderFolder( ctx: Ctx ): TemplateResult {
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
									?selected=${ uiOf( ctx.root ).folderSel === `relation:${ sub.relation }` }
									@click=${ () => {
										uiOf( ctx.root ).folderSel = `relation:${ sub.relation }`;
										ctx.local( 'repaint' );
									} }
									@dblclick=${ () => {
										if ( ! sub.disabled ) {
											uiOf( ctx.root ).folderSel = null;
											void ctx.dispatch( 'relation', { relation: sub.relation } );
										}
									} }
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
				${ ( stats.topAuthors ?? [] ).length > 0
					? html`
						<h3 class="os-mywp__pane-h">${ __( 'Top contributors' ) }</h3>
						<div class="os-mywp__people">
							${ ( stats.topAuthors ?? [] ).map( ( person ) => html`
								<div class="os-mywp__person">
									<os-avatar src=${ person.userAvatarUrl } name=${ person.userName } size="sm"></os-avatar>
									<span class="os-mywp__person-name">${ person.userName }</span>
									<span class="os-mywp__subtitle">${ sprintf(
										/* translators: %d: post count. */
										_n( '%d post', '%d posts', person.count ),
										person.count,
									) }</span>
								</div>
							` ) }
						</div>
					`
					: '' }
				${ ( stats.coTerms ?? [] ).length > 0
					? html`
						<h3 class="os-mywp__pane-h">${ __( 'Often paired with' ) }</h3>
						<div class="os-mywp__chips">
							${ ( stats.coTerms ?? [] ).map( ( co ) => html`
								<button
									type="button"
									class="os-mywp__chip"
									@click=${ () => void ctx.dispatch( 'open', { item: co.id } ) }
								>${ co.name } · ${ co.count }</button>
							` ) }
						</div>
					`
					: '' }
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
export function renderSub( ctx: Ctx ): TemplateResult {
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
