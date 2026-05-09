/**
 * Content Graph — right-side detail panel.
 *
 * Two layers of state:
 *
 *   - **`currentPost`** — the post that's focused on the canvas. Set
 *     once when the user clicks a node; survives sub-view navigation.
 *   - **`currentView`** — what's actually rendered. Defaults to
 *     `{ kind: 'post' }`; flips to a contextual view when the user
 *     clicks a satellite, and back via the breadcrumb's "back to
 *     post" affordance.
 *
 * Rich contextual views — for users / terms / comments the panel
 * fetches the same `desktop-mode/v1/{user,term,comment}-stats`
 * endpoints My WordPress's dossier panes use. While the fetch is in
 * flight, a summary view (built from data already in `PostDetail`)
 * renders immediately so there's no flash of emptiness; the rich
 * dossier replaces it on resolution. On fetch failure the summary
 * stays. Media + revisions don't have dossier endpoints; they show
 * the summary plus an "Open in WordPress" button.
 *
 * @public
 * @since 0.8.2
 */

import { __, sprintf } from '../i18n';
import {
	fetchCommentStats,
	fetchTermStats,
	fetchUserStats,
} from './rest';
import type {
	CommentRef,
	CommentStats,
	ContentGraphConfig,
	MediaRef,
	PostDetail,
	RevisionRef,
	TermRef,
	TermStats,
	UserRef,
	UserStats,
} from './types';

interface OpenWindowArgs {
	id?: string;
	baseId?: string;
	url: string;
	title: string;
	icon?: string;
}

interface DesktopApi {
	windowManager?: {
		open: ( args: OpenWindowArgs ) => unknown;
	};
	deriveWindowId?: ( url: string ) => string;
	myWordpress?: {
		openDetail: ( args: {
			entityId: string;
			postId: number;
			postTitle: string;
		} ) => void;
	};
}

type PanelView =
	| { kind: 'post' }
	| {
			kind: 'user';
			user: UserRef;
			role: 'author' | 'contributor';
			stats: UserStats | null;
			loading: boolean;
	}
	| { kind: 'term'; term: TermRef; stats: TermStats | null; loading: boolean }
	| {
			kind: 'comment';
			comment: CommentRef;
			stats: CommentStats | null;
			loading: boolean;
	}
	| { kind: 'media'; media: MediaRef }
	| { kind: 'revision'; revision: RevisionRef };

export interface PanelCallbacks {
	onClose: () => void;
	/**
	 * Called whenever the visible view kind changes — `null` for the
	 * post view, otherwise a key like `user:42` matching the
	 * `keyForRef` shape in `satellites.ts`. The host wires this to the
	 * scene so the satellite layer can mark the corresponding bubble
	 * as selected (or clear the selection when we navigate back to the
	 * post view).
	 */
	onViewChange?: ( key: string | null ) => void;
}

export interface PanelHandle {
	setLoading: ( id: number, fallbackTitle?: string ) => void;
	setError: ( message: string ) => void;
	setDetail: ( detail: PostDetail ) => void;
	showUser: ( userId: number ) => void;
	showTerm: ( termId: number, taxonomy: string ) => void;
	showComment: ( commentId: number ) => void;
	showMedia: ( mediaId: number ) => void;
	showRevision: ( revisionId: number ) => void;
	hide: () => void;
	destroy: () => void;
}

export function renderPanel(
	host: HTMLElement,
	cfg: ContentGraphConfig,
	callbacks: PanelCallbacks,
): PanelHandle {
	host.replaceChildren();
	host.hidden = true;

	let currentPost: PostDetail | null = null;
	let currentView: PanelView = { kind: 'post' };
	let fetchSeq = 0;

	const frame = document.createElement( 'div' );
	frame.className = 'desktop-mode-content-graph__panel-frame';

	const breadcrumbHost = document.createElement( 'nav' );
	breadcrumbHost.className = 'desktop-mode-content-graph__panel-breadcrumb';
	breadcrumbHost.hidden = true;

	const head = document.createElement( 'header' );
	head.className = 'desktop-mode-content-graph__panel-head';

	const titleWrap = document.createElement( 'div' );
	titleWrap.className = 'desktop-mode-content-graph__panel-title-wrap';

	const title = document.createElement( 'h2' );
	title.className = 'desktop-mode-content-graph__panel-title';

	const meta = document.createElement( 'p' );
	meta.className = 'desktop-mode-content-graph__panel-meta';

	titleWrap.appendChild( title );
	titleWrap.appendChild( meta );

	const closeBtn = document.createElement( 'button' );
	closeBtn.type = 'button';
	closeBtn.className = 'desktop-mode-content-graph__panel-close';
	closeBtn.innerHTML =
		'<span class="dashicons dashicons-no-alt" aria-hidden="true"></span>';
	closeBtn.title = __( 'Close panel' );
	closeBtn.addEventListener( 'click', () => callbacks.onClose() );

	head.appendChild( titleWrap );
	head.appendChild( closeBtn );

	const body = document.createElement( 'div' );
	body.className = 'desktop-mode-content-graph__panel-body';

	frame.appendChild( breadcrumbHost );
	frame.appendChild( head );
	frame.appendChild( body );
	host.appendChild( frame );

	// Pages live inside `body`. Each `renderCurrent()` produces a
	// fresh page DIV; `swapPage` slides it in over the previous one
	// (iOS-style — forward = new from right, back = new from left).
	// All `renderXxxView` calls append to `currentPage`, which is
	// reassigned BEFORE the switch so they target the new page.
	let currentPage: HTMLDivElement = createPage();
	body.append( currentPage );
	let prevViewKind: PanelView[ 'kind' ] | null = null;
	let pageSeq = 0;

	function createPage(): HTMLDivElement {
		const p = document.createElement( 'div' );
		p.className = 'desktop-mode-content-graph__panel-page';
		return p;
	}

	const swapPage = (
		next: HTMLDivElement,
		direction: 'forward' | 'back' | 'none',
	): void => {
		const prev = currentPage;
		currentPage = next;
		body.append( next );
		if ( prev === next || direction === 'none' ) {
			if ( prev !== next ) {
				prev.remove();
			}
			return;
		}
		const enter =
			direction === 'forward' ? 'page-from-right' : 'page-from-left';
		const exit =
			direction === 'forward' ? 'page-to-left' : 'page-to-right';
		next.classList.add( `desktop-mode-content-graph__${ enter }` );
		// Force a layout pass so the browser registers the off-screen
		// position before we strip the modifier and let the transition
		// run. Without this the new page just appears on screen.
		void next.offsetWidth;
		const mySeq = ++pageSeq;
		requestAnimationFrame( () => {
			if ( mySeq !== pageSeq ) {
				return;
			}
			next.classList.remove(
				`desktop-mode-content-graph__${ enter }`,
			);
			prev.classList.add(
				`desktop-mode-content-graph__${ exit }`,
			);
		} );
		let cleaned = false;
		const cleanup = (): void => {
			if ( cleaned ) {
				return;
			}
			cleaned = true;
			prev.removeEventListener( 'transitionend', cleanup );
			prev.remove();
		};
		prev.addEventListener( 'transitionend', cleanup );
		// Belt-and-braces: if the transition never fires (display:none
		// race during a panel close, missing CSS), drop the old page
		// after the worst-case duration so it doesn't pile up.
		setTimeout( cleanup, 360 );
	};

	const keyForView = ( v: PanelView ): string | null => {
		switch ( v.kind ) {
			case 'post':
				return null;
			case 'user':
				return `user:${ v.user.id }`;
			case 'term':
				return `term:${ v.term.taxonomy }:${ v.term.id }`;
			case 'comment':
				return `comment:${ v.comment.id }`;
			case 'media':
				return `media:${ v.media.id }`;
			case 'revision':
				return `revision:${ v.revision.id }`;
		}
	};

	const desktopApi = (): DesktopApi => {
		const wp = ( window.wp ?? {} ) as { desktop?: DesktopApi };
		return wp.desktop ?? {};
	};

	const openAdminUrl = (
		href: string,
		labelText: string,
		icon: string,
	): void => {
		const api = desktopApi();
		if ( ! api.windowManager || ! api.deriveWindowId || ! href ) {
			if ( href ) {
				window.location.href = href;
			}
			return;
		}
		const id = api.deriveWindowId( href );
		api.windowManager.open( {
			id,
			baseId: id,
			url: href,
			title: labelText,
			icon,
		} );
	};

	const renderBreadcrumb = (): void => {
		breadcrumbHost.replaceChildren();
		if ( currentView.kind === 'post' || ! currentPost ) {
			breadcrumbHost.hidden = true;
			return;
		}
		breadcrumbHost.hidden = false;
		const back = document.createElement( 'button' );
		back.type = 'button';
		back.className = 'desktop-mode-content-graph__panel-breadcrumb-back';
		const arrow = document.createElement( 'span' );
		arrow.className =
			'dashicons dashicons-arrow-left-alt2 desktop-mode-content-graph__panel-breadcrumb-arrow';
		arrow.setAttribute( 'aria-hidden', 'true' );
		const backLabel = document.createElement( 'span' );
		backLabel.className =
			'desktop-mode-content-graph__panel-breadcrumb-label';
		backLabel.textContent =
			currentPost.post.title || `#${ currentPost.post.id }`;
		back.appendChild( arrow );
		back.appendChild( backLabel );
		back.title = __( 'Back to post' );
		back.addEventListener( 'click', () => {
			currentView = { kind: 'post' };
			renderCurrent();
		} );
		breadcrumbHost.appendChild( back );
	};

	const renderCurrent = (): void => {
		host.hidden = false;
		renderBreadcrumb();

		// Build a fresh page; flip currentPage so the renderXxx
		// functions append into the new page, not the outgoing one.
		const next = createPage();
		currentPage = next;
		switch ( currentView.kind ) {
			case 'post':
				renderPostView( currentPost );
				break;
			case 'user':
				renderUserView( currentView );
				break;
			case 'term':
				renderTermView( currentView );
				break;
			case 'comment':
				renderCommentView( currentView );
				break;
			case 'media':
				renderMediaView( currentView.media );
				break;
			case 'revision':
				renderRevisionView( currentView.revision );
				break;
		}

		// Direction policy: post → sub-view = forward (slide left,
		// new in from right); sub → post = back (slide right, new in
		// from left); sub → sub treated as forward.
		let direction: 'forward' | 'back' | 'none' = 'none';
		if ( prevViewKind !== null && prevViewKind !== currentView.kind ) {
			if ( currentView.kind === 'post' ) {
				direction = 'back';
			} else {
				direction = 'forward';
			}
		}
		swapPage( next, direction );
		callbacks.onViewChange?.( keyForView( currentView ) );
		prevViewKind = currentView.kind;
	};

	// --- POST view -----------------------------------------------------

	const renderPostView = ( detail: PostDetail | null ): void => {
		if ( ! detail ) {
			title.textContent = '';
			meta.textContent = '';
			return;
		}
		title.textContent = detail.post.title || `#${ detail.post.id }`;
		meta.textContent = `${ detail.post.type } · ${ detail.post.status }`;

		currentPage.appendChild( renderAuthorBlock( detail ) );
		currentPage.appendChild( renderDatesBlock( detail ) );
		currentPage.appendChild( renderStatsGrid( [
			{ label: __( 'Contributors' ), value: detail.contributors.length },
			{ label: __( 'Comments' ), value: detail.comments.length },
			{ label: __( 'Taxonomies' ), value: detail.categories.length },
			{ label: __( 'Media' ), value: detail.attached_media.length },
			{ label: __( 'Revisions' ), value: detail.revisions.length },
		] ) );
		currentPage.appendChild( renderPostActionsBlock( detail ) );
	};

	const renderAuthorBlock = ( detail: PostDetail ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-author';
		if ( ! detail.author ) {
			wrap.hidden = true;
			return wrap;
		}
		const label = document.createElement( 'span' );
		label.className = 'desktop-mode-content-graph__panel-section-label';
		label.textContent = __( 'Author' );
		wrap.appendChild( label );
		const row = document.createElement( 'div' );
		row.className = 'desktop-mode-content-graph__panel-author-row';
		if ( detail.author.avatar ) {
			const img = document.createElement( 'img' );
			img.className = 'desktop-mode-content-graph__panel-avatar';
			img.src = detail.author.avatar;
			img.alt = '';
			row.appendChild( img );
		}
		const name = document.createElement( 'span' );
		name.className = 'desktop-mode-content-graph__panel-author-name';
		name.textContent = detail.author.name;
		row.appendChild( name );
		wrap.appendChild( row );
		return wrap;
	};

	const renderDatesBlock = ( detail: PostDetail ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-dates';
		const items: Array< { label: string; iso: string } > = [];
		if ( detail.post.date ) {
			items.push( { label: __( 'Published' ), iso: detail.post.date } );
		}
		if (
			detail.post.modified &&
			detail.post.modified !== detail.post.date
		) {
			items.push( {
				label: __( 'Modified' ),
				iso: detail.post.modified,
			} );
		}
		if ( items.length === 0 ) {
			wrap.hidden = true;
			return wrap;
		}
		for ( const it of items ) {
			const row = document.createElement( 'div' );
			row.className = 'desktop-mode-content-graph__panel-date-row';
			const labelEl = document.createElement( 'span' );
			labelEl.className =
				'desktop-mode-content-graph__panel-section-label';
			labelEl.textContent = it.label;
			const valueEl = document.createElement( 'span' );
			valueEl.className =
				'desktop-mode-content-graph__panel-date-value';
			valueEl.textContent = formatDate( it.iso );
			row.appendChild( labelEl );
			row.appendChild( valueEl );
			wrap.appendChild( row );
		}
		return wrap;
	};

	const renderStatsGrid = (
		entries: Array< { label: string; value: number | string } >,
	): HTMLElement => {
		const ul = document.createElement( 'ul' );
		ul.className = 'desktop-mode-content-graph__panel-stats';
		for ( const e of entries ) {
			const li = document.createElement( 'li' );
			li.className = 'desktop-mode-content-graph__panel-stat';
			const num = document.createElement( 'span' );
			num.className = 'desktop-mode-content-graph__panel-stat-num';
			num.textContent =
				typeof e.value === 'number' ? formatNumber( e.value ) : e.value;
			const labelEl = document.createElement( 'span' );
			labelEl.className =
				'desktop-mode-content-graph__panel-stat-label';
			labelEl.textContent = e.label;
			li.appendChild( num );
			li.appendChild( labelEl );
			ul.appendChild( li );
		}
		return ul;
	};

	const renderPostActionsBlock = ( detail: PostDetail ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-actions';
		const api = desktopApi();
		if ( api.myWordpress ) {
			const myWp = button( {
				label: __( 'Open in My WordPress' ),
				icon: 'dashicons-wordpress',
				primary: true,
			} );
			myWp.addEventListener( 'click', () => {
				const entityId =
					detail.post.type === 'page' ? 'pages' : 'posts';
				api.myWordpress!.openDetail( {
					entityId,
					postId: detail.post.id,
					postTitle: detail.post.title || `#${ detail.post.id }`,
				} );
			} );
			wrap.appendChild( myWp );
		}
		if ( detail.post.edit_url ) {
			const edit = button( {
				label: __( 'Edit' ),
				icon: 'dashicons-edit',
			} );
			edit.addEventListener( 'click', () =>
				openAdminUrl(
					detail.post.edit_url,
					detail.post.title,
					'dashicons-admin-post',
				),
			);
			wrap.appendChild( edit );
		}
		if ( detail.post.view_url ) {
			const view = button( {
				label: __( 'View' ),
				icon: 'dashicons-external',
			} );
			view.addEventListener( 'click', () =>
				openAdminUrl(
					detail.post.view_url,
					detail.post.title,
					'dashicons-admin-post',
				),
			);
			wrap.appendChild( view );
		}
		return wrap;
	};

	// --- USER view -----------------------------------------------------

	const renderUserView = ( view: Extract< PanelView, { kind: 'user' } > ): void => {
		const { user, role, stats, loading } = view;

		title.textContent = stats?.profile.name ?? user.name;
		meta.textContent =
			role === 'author' ? __( 'Author' ) : __( 'Contributor' );

		// Header (always shown — works from minimal data)
		const head2 = document.createElement( 'div' );
		head2.className = 'desktop-mode-content-graph__panel-detail-head';
		const avatar = stats?.profile.avatarUrl || user.avatar;
		if ( avatar ) {
			const img = document.createElement( 'img' );
			img.className =
				'desktop-mode-content-graph__panel-detail-avatar desktop-mode-content-graph__panel-detail-avatar--lg';
			img.src = avatar;
			img.alt = '';
			head2.appendChild( img );
		}
		const handleEl = document.createElement( 'div' );
		handleEl.className = 'desktop-mode-content-graph__panel-detail-handle';
		handleEl.innerHTML =
			`<strong>${ escapeHtml( stats?.profile.name ?? user.name ) }</strong>` +
			`<span>@${ escapeHtml( user.slug ) }</span>`;
		head2.appendChild( handleEl );
		currentPage.appendChild( head2 );

		// Roles (if available)
		if ( stats?.profile.roleLabels?.length ) {
			currentPage.appendChild(
				renderBadges(
					__( 'Roles' ),
					stats.profile.roleLabels,
				),
			);
		}

		// Bio + website
		if ( stats?.profile.description ) {
			currentPage.appendChild(
				renderProse( __( 'About' ), stats.profile.description ),
			);
		}
		if ( stats?.profile.website ) {
			currentPage.appendChild(
				renderLinkRow(
					__( 'Website' ),
					stats.profile.website,
					stats.profile.website,
				),
			);
		}

		// Counts grid
		if ( stats ) {
			const cs = stats.counts;
			currentPage.appendChild(
				renderStatsGrid( [
					{ label: __( 'Posts' ), value: cs.posts.total },
					{ label: __( 'Pages' ), value: cs.pages.total },
					{ label: __( 'CPT' ), value: cs.cpt },
					{
						label: __( 'Comments received' ),
						value: cs.commentsReceived,
					},
					{
						label: __( 'Comments left' ),
						value: cs.commentsLeft,
					},
				] ),
			);
		}

		// Top categories / tags
		if ( stats?.topTerms?.length ) {
			currentPage.appendChild(
				renderTopTerms( __( 'Top topics' ), stats.topTerms ),
			);
		}

		// Milestones
		if ( stats ) {
			currentPage.appendChild(
				renderMilestones( [
					{
						label: __( 'First published' ),
						iso: stats.milestones.firstPublished,
					},
					{
						label: __( 'Last published' ),
						iso: stats.milestones.lastPublished,
					},
				] ),
			);
		}

		if ( loading ) {
			currentPage.appendChild( renderLoadingRow() );
		}

		// Action
		currentPage.appendChild(
			renderActionRow( {
				label: __( 'Open in WordPress' ),
				icon: 'dashicons-admin-users',
				href: user.edit_url,
				title: user.name,
				primary: true,
			} ),
		);
	};

	// --- TERM view -----------------------------------------------------

	const renderTermView = ( view: Extract< PanelView, { kind: 'term' } > ): void => {
		const { term, stats, loading } = view;

		title.textContent = stats?.profile.name ?? term.name;
		meta.textContent = `${
			stats?.profile.taxonomyLabel ?? term.tax_label
		} · ${ stats?.profile.taxonomy ?? term.taxonomy }`;

		// Parent breadcrumb (term hierarchy, not panel breadcrumb)
		if ( stats?.profile.parentName ) {
			currentPage.appendChild(
				renderInlineMeta( [
					{
						label: __( 'Parent' ),
						value: stats.profile.parentName,
					},
				] ),
			);
		}

		// Description
		if ( stats?.profile.description ) {
			currentPage.appendChild(
				renderProse( __( 'Description' ), stats.profile.description ),
			);
		}

		// Counts
		if ( stats ) {
			currentPage.appendChild(
				renderStatsGrid( [
					{ label: __( 'Posts' ), value: stats.counts.posts.total },
					{
						label: __( 'Comments' ),
						value: stats.counts.commentsReceived,
					},
					{
						label: __( 'Authors' ),
						value: stats.counts.distinctAuthors,
					},
				] ),
			);
		} else {
			currentPage.appendChild(
				renderStatsGrid( [
					{ label: __( 'Posts' ), value: term.count },
				] ),
			);
		}

		// Top authors
		if ( stats?.topAuthors?.length ) {
			currentPage.appendChild(
				renderTopAuthors( __( 'Top authors' ), stats.topAuthors ),
			);
		}

		// Co-terms
		if ( stats?.coTerms?.length ) {
			currentPage.appendChild(
				renderTopTerms(
					__( 'Co-occurring' ),
					stats.coTerms.map( ( c ) => ( {
						...c,
						taxonomy: term.taxonomy,
					} ) ),
				),
			);
		}

		// Milestones
		if ( stats ) {
			currentPage.appendChild(
				renderMilestones( [
					{
						label: __( 'First post' ),
						iso: stats.milestones.firstPosted,
					},
					{
						label: __( 'Latest post' ),
						iso: stats.milestones.lastPosted,
					},
				] ),
			);
		}

		if ( loading ) {
			currentPage.appendChild( renderLoadingRow() );
		}

		currentPage.appendChild(
			renderActionRow( {
				label: __( 'Open in WordPress' ),
				icon: 'dashicons-tag',
				href: term.edit_url,
				title: term.name,
				primary: true,
			} ),
		);
	};

	// --- COMMENT view --------------------------------------------------

	const renderCommentView = ( view: Extract< PanelView, { kind: 'comment' } > ): void => {
		const { comment, stats, loading } = view;
		const authorName = stats?.author.name ?? comment.author;

		title.textContent = authorName || `#${ comment.id }`;
		meta.textContent = formatDate( stats?.comment.date ?? comment.date );

		// Author header (avatar + name)
		const avatar = stats?.author.avatarUrl;
		if ( avatar ) {
			const head2 = document.createElement( 'div' );
			head2.className = 'desktop-mode-content-graph__panel-detail-head';
			const img = document.createElement( 'img' );
			img.className =
				'desktop-mode-content-graph__panel-detail-avatar desktop-mode-content-graph__panel-detail-avatar--lg';
			img.src = avatar;
			img.alt = '';
			head2.appendChild( img );
			const handleEl = document.createElement( 'div' );
			handleEl.className =
				'desktop-mode-content-graph__panel-detail-handle';
			handleEl.innerHTML =
				`<strong>${ escapeHtml( authorName ) }</strong>` +
				( stats?.author.totalApprovedComments
					? `<span>${ formatNumber(
							stats.author.totalApprovedComments,
					) } ${ escapeHtml( __( 'comments' ) ) }</span>`
					: '' );
			head2.appendChild( handleEl );
			currentPage.appendChild( head2 );
		}

		// Status badge
		const status = stats?.comment.status ?? __( '—' );
		currentPage.appendChild(
			renderBadges( __( 'Status' ), [ status ], {
				accent:
					status === '1' || status === 'approved' ? 'green' : 'amber',
			} ),
		);

		// Content
		const content = stats?.comment.rendered;
		if ( content ) {
			const wrap = document.createElement( 'div' );
			wrap.className =
				'desktop-mode-content-graph__panel-detail-section';
			const label = document.createElement( 'span' );
			label.className =
				'desktop-mode-content-graph__panel-section-label';
			label.textContent = __( 'Comment' );
			wrap.appendChild( label );
			const html = document.createElement( 'div' );
			html.className = 'desktop-mode-content-graph__panel-detail-html';
			html.innerHTML = content;
			wrap.appendChild( html );
			currentPage.appendChild( wrap );
		} else if ( comment.excerpt ) {
			currentPage.appendChild(
				renderProse( __( 'Comment' ), comment.excerpt ),
			);
		}

		// Parent quote
		if ( stats?.parent ) {
			const wrap = document.createElement( 'blockquote' );
			wrap.className =
				'desktop-mode-content-graph__panel-detail-quote';
			wrap.innerHTML =
				`<strong>${ escapeHtml( stats.parent.authorName ) }</strong>` +
				`<span>${ escapeHtml( stats.parent.excerpt ) }</span>`;
			currentPage.appendChild( wrap );
		}

		// Replies
		if ( stats?.replies?.length ) {
			currentPage.appendChild( renderReplies( stats.replies ) );
		}

		if ( loading ) {
			currentPage.appendChild( renderLoadingRow() );
		}

		currentPage.appendChild(
			renderActionRow( {
				label: __( 'Open in WordPress' ),
				icon: 'dashicons-admin-comments',
				href: comment.edit_url,
				title: authorName || __( 'Comment' ),
				primary: true,
			} ),
		);
	};

	// --- MEDIA view ----------------------------------------------------

	const renderMediaView = ( media: MediaRef ): void => {
		title.textContent = media.title || `#${ media.id }`;
		meta.textContent = media.mime || __( 'Media' );
		if ( media.thumb ) {
			const wrap = document.createElement( 'div' );
			wrap.className =
				'desktop-mode-content-graph__panel-detail-thumb';
			const img = document.createElement( 'img' );
			img.src = media.thumb;
			img.alt = media.title || '';
			wrap.appendChild( img );
			currentPage.appendChild( wrap );
		}
		currentPage.appendChild(
			renderInlineMeta( [
				{ label: __( 'Type' ), value: media.mime },
			] ),
		);
		currentPage.appendChild(
			renderActionRow( {
				label: __( 'Open in WordPress' ),
				icon: 'dashicons-admin-media',
				href: media.edit_url,
				title: media.title,
				primary: true,
			} ),
		);
	};

	// --- REVISION view -------------------------------------------------

	const renderRevisionView = ( revision: RevisionRef ): void => {
		title.textContent = revision.author?.name ?? __( 'Revision' );
		meta.textContent = formatDate( revision.date );
		if ( revision.author ) {
			const head2 = document.createElement( 'div' );
			head2.className =
				'desktop-mode-content-graph__panel-detail-head';
			if ( revision.author.avatar ) {
				const img = document.createElement( 'img' );
				img.className =
					'desktop-mode-content-graph__panel-detail-avatar desktop-mode-content-graph__panel-detail-avatar--lg';
				img.src = revision.author.avatar;
				img.alt = '';
				head2.appendChild( img );
			}
			const handleEl = document.createElement( 'div' );
			handleEl.className =
				'desktop-mode-content-graph__panel-detail-handle';
			handleEl.innerHTML =
				`<strong>${ escapeHtml( revision.author.name ) }</strong>` +
				`<span>@${ escapeHtml( revision.author.slug ) }</span>`;
			head2.appendChild( handleEl );
			currentPage.appendChild( head2 );
		}
		currentPage.appendChild(
			renderInlineMeta( [
				{ label: __( 'Saved' ), value: formatDate( revision.date ) },
			] ),
		);
		currentPage.appendChild(
			renderActionRow( {
				label: __( 'Open revision in WordPress' ),
				icon: 'dashicons-backup',
				href: revision.edit_url,
				title: __( 'Revision' ),
				primary: true,
			} ),
		);
	};

	// --- Reusable building blocks --------------------------------------

	const renderProse = ( label: string, text: string ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-detail-section';
		const labelEl = document.createElement( 'span' );
		labelEl.className =
			'desktop-mode-content-graph__panel-section-label';
		labelEl.textContent = label;
		const p = document.createElement( 'p' );
		p.className = 'desktop-mode-content-graph__panel-detail-prose';
		p.textContent = text;
		wrap.appendChild( labelEl );
		wrap.appendChild( p );
		return wrap;
	};

	const renderBadges = (
		label: string,
		items: string[],
		opts: { accent?: 'blue' | 'green' | 'amber' } = {},
	): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-detail-section';
		const labelEl = document.createElement( 'span' );
		labelEl.className =
			'desktop-mode-content-graph__panel-section-label';
		labelEl.textContent = label;
		wrap.appendChild( labelEl );
		const list = document.createElement( 'div' );
		list.className = 'desktop-mode-content-graph__panel-badges';
		for ( const it of items ) {
			const badge = document.createElement( 'span' );
			badge.className =
				'desktop-mode-content-graph__panel-badge' +
				( opts.accent
					? ` desktop-mode-content-graph__panel-badge--${ opts.accent }`
					: '' );
			badge.textContent = it;
			list.appendChild( badge );
		}
		wrap.appendChild( list );
		return wrap;
	};

	const renderInlineMeta = (
		items: Array< { label: string; value: string } >,
	): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-inline-meta';
		for ( const it of items ) {
			if ( ! it.value ) {
				continue;
			}
			const row = document.createElement( 'div' );
			row.className =
				'desktop-mode-content-graph__panel-inline-meta-row';
			const labelEl = document.createElement( 'span' );
			labelEl.className =
				'desktop-mode-content-graph__panel-section-label';
			labelEl.textContent = it.label;
			const valueEl = document.createElement( 'span' );
			valueEl.className =
				'desktop-mode-content-graph__panel-date-value';
			valueEl.textContent = it.value;
			row.appendChild( labelEl );
			row.appendChild( valueEl );
			wrap.appendChild( row );
		}
		return wrap;
	};

	const renderLinkRow = (
		label: string,
		text: string,
		href: string,
	): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-detail-section';
		const labelEl = document.createElement( 'span' );
		labelEl.className =
			'desktop-mode-content-graph__panel-section-label';
		labelEl.textContent = label;
		const link = document.createElement( 'a' );
		link.className = 'desktop-mode-content-graph__panel-detail-link';
		link.href = href;
		link.textContent = text;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		wrap.appendChild( labelEl );
		wrap.appendChild( link );
		return wrap;
	};

	const renderTopTerms = (
		label: string,
		terms: Array< {
			id: number;
			name: string;
			slug?: string;
			taxonomy?: string;
			count: number;
		} >,
	): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-detail-section';
		const labelEl = document.createElement( 'span' );
		labelEl.className =
			'desktop-mode-content-graph__panel-section-label';
		labelEl.textContent = label;
		wrap.appendChild( labelEl );
		const list = document.createElement( 'ul' );
		list.className = 'desktop-mode-content-graph__panel-chips';
		for ( const t of terms.slice( 0, 8 ) ) {
			const li = document.createElement( 'li' );
			li.className = 'desktop-mode-content-graph__panel-chip';
			li.innerHTML =
				`<span>${ escapeHtml( t.name ) }</span>` +
				`<span class="desktop-mode-content-graph__panel-chip-count">${ formatNumber(
					t.count,
				) }</span>`;
			list.appendChild( li );
		}
		wrap.appendChild( list );
		return wrap;
	};

	const renderTopAuthors = (
		label: string,
		authors: Array< {
			userId: number;
			userName: string;
			userAvatarUrl: string;
			count: number;
		} >,
	): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-detail-section';
		const labelEl = document.createElement( 'span' );
		labelEl.className =
			'desktop-mode-content-graph__panel-section-label';
		labelEl.textContent = label;
		wrap.appendChild( labelEl );
		const list = document.createElement( 'ul' );
		list.className = 'desktop-mode-content-graph__panel-author-list';
		for ( const a of authors.slice( 0, 6 ) ) {
			const li = document.createElement( 'li' );
			li.className = 'desktop-mode-content-graph__panel-author-list-row';
			li.innerHTML =
				( a.userAvatarUrl
					? `<img class="desktop-mode-content-graph__panel-avatar" src="${ escapeAttr(
							a.userAvatarUrl,
					) }" alt="" />`
					: '' ) +
				`<span class="desktop-mode-content-graph__panel-author-name">${ escapeHtml(
					a.userName,
				) }</span>` +
				`<span class="desktop-mode-content-graph__panel-chip-count">${ formatNumber(
					a.count,
				) }</span>`;
			list.appendChild( li );
		}
		wrap.appendChild( list );
		return wrap;
	};

	const renderMilestones = (
		entries: Array< { label: string; iso: string | null } >,
	): HTMLElement => {
		const filtered = entries.filter( ( e ) => e.iso );
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-detail-section';
		if ( filtered.length === 0 ) {
			wrap.hidden = true;
			return wrap;
		}
		const labelEl = document.createElement( 'span' );
		labelEl.className =
			'desktop-mode-content-graph__panel-section-label';
		labelEl.textContent = __( 'Milestones' );
		wrap.appendChild( labelEl );
		const list = document.createElement( 'div' );
		list.className = 'desktop-mode-content-graph__panel-milestones';
		for ( const e of filtered ) {
			const row = document.createElement( 'div' );
			row.className = 'desktop-mode-content-graph__panel-milestone-row';
			const k = document.createElement( 'span' );
			k.className = 'desktop-mode-content-graph__panel-milestone-key';
			k.textContent = e.label;
			const v = document.createElement( 'span' );
			v.className = 'desktop-mode-content-graph__panel-date-value';
			v.textContent = formatDate( e.iso! );
			row.appendChild( k );
			row.appendChild( v );
			list.appendChild( row );
		}
		wrap.appendChild( list );
		return wrap;
	};

	const renderReplies = (
		replies: CommentStats[ 'replies' ],
	): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-detail-section';
		const labelEl = document.createElement( 'span' );
		labelEl.className =
			'desktop-mode-content-graph__panel-section-label';
		labelEl.textContent = sprintf(
			/* translators: %d: number of comment replies. */
			__( 'Replies (%d)' ),
			replies.length,
		);
		wrap.appendChild( labelEl );
		const list = document.createElement( 'ul' );
		list.className = 'desktop-mode-content-graph__panel-replies';
		for ( const r of replies.slice( 0, 5 ) ) {
			const li = document.createElement( 'li' );
			li.className = 'desktop-mode-content-graph__panel-reply';
			li.innerHTML =
				`<header><strong>${ escapeHtml( r.authorName ) }</strong>` +
				`<span>${ formatDate( r.date ) }</span></header>` +
				`<p>${ escapeHtml( r.excerpt ) }</p>`;
			list.appendChild( li );
		}
		wrap.appendChild( list );
		return wrap;
	};

	const renderLoadingRow = (): HTMLElement => {
		const div = document.createElement( 'div' );
		div.className = 'desktop-mode-content-graph__panel-detail-loading';
		div.innerHTML =
			`<wpd-spinner></wpd-spinner><span>${ escapeHtml(
				__( 'Loading details…' ),
			) }</span>`;
		return div;
	};

	const renderActionRow = ( opts: {
		label: string;
		icon: string;
		href: string;
		title: string;
		primary?: boolean;
	} ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-actions';
		if ( ! opts.href ) {
			wrap.hidden = true;
			return wrap;
		}
		const btn = button( {
			label: opts.label,
			icon: opts.icon,
			primary: opts.primary,
		} );
		btn.addEventListener( 'click', () =>
			openAdminUrl( opts.href, opts.title, opts.icon ),
		);
		wrap.appendChild( btn );
		return wrap;
	};

	const button = ( opts: {
		label: string;
		icon: string;
		primary?: boolean;
	} ): HTMLButtonElement => {
		const btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.className =
			'desktop-mode-content-graph__btn' +
			( opts.primary
				? ' desktop-mode-content-graph__btn--primary'
				: '' );
		btn.innerHTML =
			`<span class="dashicons ${ escapeAttr( opts.icon ) }" aria-hidden="true"></span>` +
			`<span>${ escapeHtml( opts.label ) }</span>`;
		return btn;
	};

	// --- Public handle -------------------------------------------------

	return {
		setLoading: ( id: number, fallbackTitle?: string ) => {
			host.hidden = false;
			breadcrumbHost.hidden = true;
			currentView = { kind: 'post' };
			prevViewKind = null;
			title.textContent = fallbackTitle ?? `#${ id }`;
			meta.textContent = __( 'Loading…' );
			body.replaceChildren();
			currentPage = createPage();
			body.append( currentPage );
			const loading = document.createElement( 'div' );
			loading.className = 'desktop-mode-content-graph__panel-loading';
			loading.innerHTML = '<wpd-spinner></wpd-spinner>';
			currentPage.appendChild( loading );
			callbacks.onViewChange?.( null );
		},
		setError: ( message: string ) => {
			host.hidden = false;
			breadcrumbHost.hidden = true;
			currentView = { kind: 'post' };
			prevViewKind = null;
			body.replaceChildren();
			currentPage = createPage();
			body.append( currentPage );
			const empty = document.createElement( 'p' );
			empty.className = 'desktop-mode-content-graph__panel-empty';
			empty.textContent = message;
			currentPage.appendChild( empty );
			callbacks.onViewChange?.( null );
		},
		setDetail: ( detail: PostDetail ) => {
			currentPost = detail;
			currentView = { kind: 'post' };
			renderCurrent();
		},
		showUser: ( userId: number ) => {
			if ( ! currentPost ) {
				return;
			}
			const isAuthor = currentPost.author?.id === userId;
			const user = isAuthor
				? currentPost.author!
				: currentPost.contributors.find( ( c ) => c.id === userId );
			if ( ! user ) {
				return;
			}
			currentView = {
				kind: 'user',
				user,
				role: isAuthor ? 'author' : 'contributor',
				stats: null,
				loading: true,
			};
			renderCurrent();
			const seq = ++fetchSeq;
			void fetchUserStats( cfg, userId )
				.then( ( stats ) => {
					if (
						seq !== fetchSeq ||
						currentView.kind !== 'user' ||
						currentView.user.id !== userId
					) {
						return;
					}
					currentView = { ...currentView, stats, loading: false };
					renderCurrent();
				} )
				.catch( ( err ) => {
					if (
						seq !== fetchSeq ||
						currentView.kind !== 'user' ||
						currentView.user.id !== userId
					) {
						return;
					}
					currentView = { ...currentView, loading: false };
					renderCurrent();
					// eslint-disable-next-line no-console
					console.warn( '[content-graph] user-stats failed', err );
				} );
		},
		showTerm: ( termId: number, taxonomy: string ) => {
			if ( ! currentPost ) {
				return;
			}
			const term = currentPost.categories.find(
				( t ) => t.id === termId && t.taxonomy === taxonomy,
			);
			if ( ! term ) {
				return;
			}
			currentView = {
				kind: 'term',
				term,
				stats: null,
				loading: true,
			};
			renderCurrent();
			const seq = ++fetchSeq;
			void fetchTermStats( cfg, taxonomy, termId )
				.then( ( stats ) => {
					if (
						seq !== fetchSeq ||
						currentView.kind !== 'term' ||
						currentView.term.id !== termId
					) {
						return;
					}
					currentView = { ...currentView, stats, loading: false };
					renderCurrent();
				} )
				.catch( ( err ) => {
					if (
						seq !== fetchSeq ||
						currentView.kind !== 'term' ||
						currentView.term.id !== termId
					) {
						return;
					}
					currentView = { ...currentView, loading: false };
					renderCurrent();
					// eslint-disable-next-line no-console
					console.warn( '[content-graph] term-stats failed', err );
				} );
		},
		showComment: ( commentId: number ) => {
			if ( ! currentPost ) {
				return;
			}
			const comment = currentPost.comments.find(
				( c ) => c.id === commentId,
			);
			if ( ! comment ) {
				return;
			}
			currentView = {
				kind: 'comment',
				comment,
				stats: null,
				loading: true,
			};
			renderCurrent();
			const seq = ++fetchSeq;
			void fetchCommentStats( cfg, commentId )
				.then( ( stats ) => {
					if (
						seq !== fetchSeq ||
						currentView.kind !== 'comment' ||
						currentView.comment.id !== commentId
					) {
						return;
					}
					currentView = { ...currentView, stats, loading: false };
					renderCurrent();
				} )
				.catch( ( err ) => {
					if (
						seq !== fetchSeq ||
						currentView.kind !== 'comment' ||
						currentView.comment.id !== commentId
					) {
						return;
					}
					currentView = { ...currentView, loading: false };
					renderCurrent();
					// eslint-disable-next-line no-console
					console.warn(
						'[content-graph] comment-stats failed',
						err,
					);
				} );
		},
		showMedia: ( mediaId: number ) => {
			if ( ! currentPost ) {
				return;
			}
			const media = currentPost.attached_media.find(
				( m ) => m.id === mediaId,
			);
			if ( ! media ) {
				return;
			}
			currentView = { kind: 'media', media };
			renderCurrent();
		},
		showRevision: ( revisionId: number ) => {
			if ( ! currentPost ) {
				return;
			}
			const revision = currentPost.revisions.find(
				( r ) => r.id === revisionId,
			);
			if ( ! revision ) {
				return;
			}
			currentView = { kind: 'revision', revision };
			renderCurrent();
		},
		hide: () => {
			host.hidden = true;
		},
		destroy: () => {
			host.replaceChildren();
		},
	};
}

function formatDate( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleString();
	} catch {
		return iso;
	}
}

function formatNumber( n: number ): string {
	try {
		return new Intl.NumberFormat().format( n );
	} catch {
		return String( n );
	}
}

function escapeHtml( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

function escapeAttr( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /"/g, '&quot;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
}
