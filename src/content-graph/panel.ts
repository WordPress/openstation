/**
 * Content Graph — right-side detail panel.
 *
 * The panel has two layers of state:
 *
 *   - **`currentPost`** — the post that's focused on the canvas. Set
 *     once when the user clicks a node; survives sub-view navigation.
 *   - **`currentView`** — what's actually rendered. Defaults to
 *     `{ kind: 'post' }`; flips to `user` / `term` / `comment` /
 *     `media` / `revision` when the user clicks a satellite, and
 *     back to `post` via the breadcrumb's "back to post" affordance.
 *
 * Each contextual view reuses the entity data already shipped in
 * `PostDetail` (UserRef, TermRef, …), so swapping views is purely
 * client-side — no extra REST round-trip per click. Each contextual
 * view ends with an "Open in WordPress" button that delegates to
 * `wp.desktop.windowManager.open` with the entity's admin URL,
 * letting the URL-remap layer route to the right native window
 * (user-edit, term, comment, media, revision) when one exists.
 *
 * @public
 * @since 0.8.2
 */

import { __ } from '../i18n';
import type {
	CommentRef,
	ContentGraphConfig,
	MediaRef,
	PostDetail,
	RevisionRef,
	TermRef,
	UserRef,
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
	| { kind: 'user'; user: UserRef; role: 'author' | 'contributor' }
	| { kind: 'term'; term: TermRef }
	| { kind: 'comment'; comment: CommentRef }
	| { kind: 'media'; media: MediaRef }
	| { kind: 'revision'; revision: RevisionRef };

export interface PanelCallbacks {
	onClose: () => void;
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
	_cfg: ContentGraphConfig,
	callbacks: PanelCallbacks,
): PanelHandle {
	host.replaceChildren();
	host.hidden = true;

	let currentPost: PostDetail | null = null;
	let currentView: PanelView = { kind: 'post' };

	// --- Frame ---------------------------------------------------------
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

	// --- Helpers -------------------------------------------------------
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
		back.innerHTML =
			'<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>' +
			`<span>${ escapeHtml( currentPost.post.title || `#${ currentPost.post.id }` ) }</span>`;
		back.title = __( 'Back to post' );
		back.addEventListener( 'click', () => {
			currentView = { kind: 'post' };
			renderCurrent();
		} );
		breadcrumbHost.appendChild( back );

		const sep = document.createElement( 'span' );
		sep.className = 'desktop-mode-content-graph__panel-breadcrumb-sep';
		sep.textContent = '›';
		breadcrumbHost.appendChild( sep );

		const here = document.createElement( 'span' );
		here.className = 'desktop-mode-content-graph__panel-breadcrumb-here';
		here.textContent = breadcrumbLabelFor( currentView );
		breadcrumbHost.appendChild( here );
	};

	const renderCurrent = (): void => {
		host.hidden = false;
		body.replaceChildren();
		renderBreadcrumb();
		switch ( currentView.kind ) {
			case 'post':
				renderPostView( currentPost );
				break;
			case 'user':
				renderUserView( currentView.user, currentView.role );
				break;
			case 'term':
				renderTermView( currentView.term );
				break;
			case 'comment':
				renderCommentView( currentView.comment );
				break;
			case 'media':
				renderMediaView( currentView.media );
				break;
			case 'revision':
				renderRevisionView( currentView.revision );
				break;
		}
	};

	const renderPostView = ( detail: PostDetail | null ): void => {
		if ( ! detail ) {
			title.textContent = '';
			meta.textContent = '';
			return;
		}
		title.textContent = detail.post.title || `#${ detail.post.id }`;
		meta.textContent = `${ detail.post.type } · ${ detail.post.status }`;
		body.appendChild( renderAuthorBlock( detail ) );
		body.appendChild( renderDatesBlock( detail ) );
		body.appendChild( renderStatsBlock( detail ) );
		body.appendChild( renderPostActionsBlock( detail ) );
	};

	const renderUserView = ( user: UserRef, role: 'author' | 'contributor' ): void => {
		title.textContent = user.name;
		meta.textContent =
			role === 'author' ? __( 'Author' ) : __( 'Contributor' );
		const head2 = document.createElement( 'div' );
		head2.className = 'desktop-mode-content-graph__panel-detail-head';
		if ( user.avatar ) {
			const img = document.createElement( 'img' );
			img.className = 'desktop-mode-content-graph__panel-detail-avatar';
			img.src = user.avatar;
			img.alt = '';
			head2.appendChild( img );
		}
		const handle = document.createElement( 'div' );
		handle.className = 'desktop-mode-content-graph__panel-detail-handle';
		handle.innerHTML =
			`<strong>${ escapeHtml( user.name ) }</strong>` +
			`<span>@${ escapeHtml( user.slug ) }</span>`;
		head2.appendChild( handle );
		body.appendChild( head2 );

		body.appendChild(
			renderActionRow( {
				label: __( 'Open in WordPress' ),
				icon: 'dashicons-admin-users',
				href: user.edit_url,
				title: user.name,
				primary: true,
			} ),
		);
	};

	const renderTermView = ( term: TermRef ): void => {
		title.textContent = term.name;
		meta.textContent = `${ term.tax_label } · ${ term.taxonomy }`;
		body.appendChild( makeStatRow( __( 'Slug' ), term.slug ) );
		body.appendChild(
			makeStatRow(
				__( 'Posts' ),
				new Intl.NumberFormat().format( term.count ),
			),
		);
		body.appendChild(
			renderActionRow( {
				label: __( 'Open in WordPress' ),
				icon: 'dashicons-tag',
				href: term.edit_url,
				title: term.name,
				primary: true,
			} ),
		);
	};

	const renderCommentView = ( comment: CommentRef ): void => {
		title.textContent = comment.author || `#${ comment.id }`;
		meta.textContent = formatDate( comment.date );
		if ( comment.excerpt ) {
			const excerpt = document.createElement( 'blockquote' );
			excerpt.className =
				'desktop-mode-content-graph__panel-detail-excerpt';
			excerpt.textContent = comment.excerpt;
			body.appendChild( excerpt );
		}
		body.appendChild(
			renderActionRow( {
				label: __( 'Open in WordPress' ),
				icon: 'dashicons-admin-comments',
				href: comment.edit_url,
				title: comment.author || __( 'Comment' ),
				primary: true,
			} ),
		);
	};

	const renderMediaView = ( media: MediaRef ): void => {
		title.textContent = media.title || `#${ media.id }`;
		meta.textContent = media.mime || __( 'Media' );
		if ( media.thumb ) {
			const wrap = document.createElement( 'div' );
			wrap.className = 'desktop-mode-content-graph__panel-detail-thumb';
			const img = document.createElement( 'img' );
			img.src = media.thumb;
			img.alt = '';
			wrap.appendChild( img );
			body.appendChild( wrap );
		}
		body.appendChild(
			renderActionRow( {
				label: __( 'Open in WordPress' ),
				icon: 'dashicons-admin-media',
				href: media.edit_url,
				title: media.title,
				primary: true,
			} ),
		);
	};

	const renderRevisionView = ( revision: RevisionRef ): void => {
		title.textContent = revision.author?.name ?? __( 'Revision' );
		meta.textContent = formatDate( revision.date );
		if ( revision.author ) {
			const head2 = document.createElement( 'div' );
			head2.className = 'desktop-mode-content-graph__panel-detail-head';
			if ( revision.author.avatar ) {
				const img = document.createElement( 'img' );
				img.className = 'desktop-mode-content-graph__panel-detail-avatar';
				img.src = revision.author.avatar;
				img.alt = '';
				head2.appendChild( img );
			}
			const handle = document.createElement( 'div' );
			handle.className =
				'desktop-mode-content-graph__panel-detail-handle';
			handle.innerHTML =
				`<strong>${ escapeHtml( revision.author.name ) }</strong>` +
				`<span>@${ escapeHtml( revision.author.slug ) }</span>`;
			head2.appendChild( handle );
			body.appendChild( head2 );
		}
		body.appendChild(
			renderActionRow( {
				label: __( 'Open revision in WordPress' ),
				icon: 'dashicons-backup',
				href: revision.edit_url,
				title: __( 'Revision' ),
				primary: true,
			} ),
		);
	};

	const renderAuthorBlock = ( detail: PostDetail ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-author';
		if ( ! detail.author ) {
			wrap.hidden = true;
			return wrap;
		}
		const label = document.createElement( 'span' );
		label.className =
			'desktop-mode-content-graph__panel-section-label';
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
		name.className =
			'desktop-mode-content-graph__panel-author-name';
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

	const renderStatsBlock = ( detail: PostDetail ): HTMLElement => {
		const wrap = document.createElement( 'ul' );
		wrap.className = 'desktop-mode-content-graph__panel-stats';
		const entries: Array< { label: string; count: number } > = [
			{ label: __( 'Contributors' ), count: detail.contributors.length },
			{ label: __( 'Comments' ), count: detail.comments.length },
			{ label: __( 'Taxonomies' ), count: detail.categories.length },
			{ label: __( 'Media' ), count: detail.attached_media.length },
			{ label: __( 'Revisions' ), count: detail.revisions.length },
		];
		for ( const e of entries ) {
			const li = document.createElement( 'li' );
			li.className = 'desktop-mode-content-graph__panel-stat';
			const num = document.createElement( 'span' );
			num.className = 'desktop-mode-content-graph__panel-stat-num';
			num.textContent = String( e.count );
			const labelEl = document.createElement( 'span' );
			labelEl.className =
				'desktop-mode-content-graph__panel-stat-label';
			labelEl.textContent = e.label;
			li.appendChild( num );
			li.appendChild( labelEl );
			wrap.appendChild( li );
		}
		return wrap;
	};

	const renderPostActionsBlock = ( detail: PostDetail ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-content-graph__panel-actions';

		const api = desktopApi();
		if ( api.myWordpress ) {
			const myWp = document.createElement( 'button' );
			myWp.type = 'button';
			myWp.className =
				'desktop-mode-content-graph__btn desktop-mode-content-graph__btn--primary';
			myWp.innerHTML =
				'<span class="dashicons dashicons-wordpress" aria-hidden="true"></span>' +
				`<span>${ escapeHtml( __( 'Open in My WordPress' ) ) }</span>`;
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
			const edit = document.createElement( 'button' );
			edit.type = 'button';
			edit.className = 'desktop-mode-content-graph__btn';
			edit.innerHTML =
				'<span class="dashicons dashicons-edit" aria-hidden="true"></span>' +
				`<span>${ escapeHtml( __( 'Edit' ) ) }</span>`;
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
			const view = document.createElement( 'button' );
			view.type = 'button';
			view.className = 'desktop-mode-content-graph__btn';
			view.innerHTML =
				'<span class="dashicons dashicons-external" aria-hidden="true"></span>' +
				`<span>${ escapeHtml( __( 'View' ) ) }</span>`;
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
		btn.addEventListener( 'click', () =>
			openAdminUrl( opts.href, opts.title, opts.icon ),
		);
		wrap.appendChild( btn );
		return wrap;
	};

	const makeStatRow = ( label: string, value: string ): HTMLElement => {
		const row = document.createElement( 'div' );
		row.className = 'desktop-mode-content-graph__panel-stat-row';
		const labelEl = document.createElement( 'span' );
		labelEl.className =
			'desktop-mode-content-graph__panel-section-label';
		labelEl.textContent = label;
		const valueEl = document.createElement( 'span' );
		valueEl.className =
			'desktop-mode-content-graph__panel-date-value';
		valueEl.textContent = value;
		row.appendChild( labelEl );
		row.appendChild( valueEl );
		return row;
	};

	const breadcrumbLabelFor = ( view: PanelView ): string => {
		switch ( view.kind ) {
			case 'user':
				return view.user.name;
			case 'term':
				return view.term.name;
			case 'comment':
				return view.comment.author || __( 'Comment' );
			case 'media':
				return view.media.title || __( 'Media' );
			case 'revision':
				return view.revision.author?.name ?? __( 'Revision' );
			default:
				return '';
		}
	};

	// --- Public handle -------------------------------------------------
	return {
		setLoading: ( id: number, fallbackTitle?: string ) => {
			host.hidden = false;
			breadcrumbHost.hidden = true;
			currentView = { kind: 'post' };
			title.textContent = fallbackTitle ?? `#${ id }`;
			meta.textContent = __( 'Loading…' );
			body.replaceChildren();
			const loading = document.createElement( 'div' );
			loading.className = 'desktop-mode-content-graph__panel-loading';
			loading.innerHTML = '<wpd-spinner></wpd-spinner>';
			body.appendChild( loading );
		},
		setError: ( message: string ) => {
			host.hidden = false;
			breadcrumbHost.hidden = true;
			currentView = { kind: 'post' };
			body.replaceChildren();
			const empty = document.createElement( 'p' );
			empty.className = 'desktop-mode-content-graph__panel-empty';
			empty.textContent = message;
			body.appendChild( empty );
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
			};
			renderCurrent();
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
			currentView = { kind: 'term', term };
			renderCurrent();
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
			currentView = { kind: 'comment', comment };
			renderCurrent();
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

function escapeHtml( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

function escapeAttr( s: string ): string {
	return s.replace( /[^a-zA-Z0-9 _\-]/g, '' );
}
