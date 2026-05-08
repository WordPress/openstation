/**
 * Content Graph — right-side detail panel.
 *
 * Slides in from the right when a node is focused. Carries the
 * post's title, type, status, dates, author, a stats line, and three
 * navigation buttons:
 *
 *   - **Edit** — opens the post editor in a new chromeless window.
 *   - **View** — opens the public permalink in a new chromeless window.
 *   - **Open in My WordPress** — routes the My WordPress window
 *     directly to this post's detail dossier
 *     (`wp.desktop.myWordpress.openDetail()`). The ground-truth
 *     view for "everything you can do with this post"; we delegate
 *     instead of rebuilding the dossier.
 *
 * The relationship satellites (author / contributors / categories /
 * comments / media / revisions) are rendered by `satellites.ts` on
 * the canvas itself, not in the panel.
 *
 * @public
 * @since 0.8.2
 */

import { __ } from '../i18n';
import type { PostDetail } from './types';

interface OpenWindowArgs {
	id?: string;
	baseId?: string;
	url: string;
	title: string;
	icon?: string;
}

interface DesktopApiUrlOpener {
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

export interface PanelCallbacks {
	onClose: () => void;
}

export interface PanelHandle {
	setLoading: ( id: number, fallbackTitle?: string ) => void;
	setError: ( message: string ) => void;
	setDetail: ( detail: PostDetail ) => void;
	hide: () => void;
	destroy: () => void;
}

export function renderPanel(
	host: HTMLElement,
	callbacks: PanelCallbacks,
): PanelHandle {
	host.replaceChildren();
	host.hidden = true;

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

	const author = document.createElement( 'div' );
	author.className = 'desktop-mode-content-graph__panel-author';

	const dates = document.createElement( 'div' );
	dates.className = 'desktop-mode-content-graph__panel-dates';

	const stats = document.createElement( 'ul' );
	stats.className = 'desktop-mode-content-graph__panel-stats';

	const actions = document.createElement( 'div' );
	actions.className = 'desktop-mode-content-graph__panel-actions';

	const loading = document.createElement( 'div' );
	loading.className = 'desktop-mode-content-graph__panel-loading';
	loading.innerHTML = '<wpd-spinner></wpd-spinner>';
	loading.hidden = true;

	const empty = document.createElement( 'p' );
	empty.className = 'desktop-mode-content-graph__panel-empty';
	empty.hidden = true;

	body.appendChild( author );
	body.appendChild( dates );
	body.appendChild( stats );
	body.appendChild( actions );
	body.appendChild( loading );
	body.appendChild( empty );

	host.appendChild( head );
	host.appendChild( body );

	const desktopApi = (): DesktopApiUrlOpener => {
		const wp = ( window.wp ?? {} ) as { desktop?: DesktopApiUrlOpener };
		return wp.desktop ?? {};
	};

	const openUrl = (
		href: string,
		labelText: string,
		icon: string,
	): void => {
		// Public `windowManager.open` requires a non-empty id, so we
		// derive it from the URL exactly the way the Posts window does
		// (see `posts-window/index.ts:openAdminUrl`). Same id == same
		// URL, so back-to-back clicks focus the existing window instead
		// of opening duplicates.
		const api = desktopApi();
		if ( ! api.windowManager || ! api.deriveWindowId ) {
			// Last-resort fallback — the shell exposes both at boot, so
			// this branch is just for safety.
			window.location.href = href;
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

	const openInMyWordpress = ( detail: PostDetail ): void => {
		const api = desktopApi().myWordpress;
		if ( ! api ) {
			return;
		}
		// `entityId` is the My WordPress folder slug. The two ship
		// today are 'posts' and 'pages'; opt-in CPTs land later.
		const entityId = detail.post.type === 'page' ? 'pages' : 'posts';
		api.openDetail( {
			entityId,
			postId: detail.post.id,
			postTitle: detail.post.title || `#${ detail.post.id }`,
		} );
	};

	const showSections = ( show: boolean ): void => {
		author.hidden = ! show;
		dates.hidden = ! show;
		stats.hidden = ! show;
		actions.hidden = ! show;
	};

	return {
		setLoading: ( id: number, fallbackTitle?: string ) => {
			host.hidden = false;
			title.textContent = fallbackTitle ?? `#${ id }`;
			meta.textContent = __( 'Loading…' );
			showSections( false );
			empty.hidden = true;
			loading.hidden = false;
		},
		setError: ( message: string ) => {
			host.hidden = false;
			showSections( false );
			loading.hidden = true;
			empty.hidden = false;
			empty.textContent = message;
		},
		hide: () => {
			host.hidden = true;
		},
		setDetail: ( detail: PostDetail ) => {
			host.hidden = false;
			loading.hidden = true;
			empty.hidden = true;
			showSections( true );

			title.textContent = detail.post.title || `#${ detail.post.id }`;
			meta.textContent = `${ detail.post.type } · ${ detail.post.status }`;

			renderAuthorBlock( author, detail );
			renderDatesBlock( dates, detail );
			renderStatsBlock( stats, detail );
			renderActionsBlock( actions, detail, openUrl, () => openInMyWordpress( detail ), !! desktopApi().myWordpress );
		},
		destroy: () => {
			host.replaceChildren();
		},
	};
}

function renderAuthorBlock( host: HTMLElement, detail: PostDetail ): void {
	host.replaceChildren();
	if ( ! detail.author ) {
		host.hidden = true;
		return;
	}
	host.hidden = false;
	const label = document.createElement( 'span' );
	label.className = 'desktop-mode-content-graph__panel-section-label';
	label.textContent = __( 'Author' );
	host.appendChild( label );

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
	host.appendChild( row );
}

function renderDatesBlock( host: HTMLElement, detail: PostDetail ): void {
	host.replaceChildren();
	const items: Array< { label: string; iso: string } > = [];
	if ( detail.post.date ) {
		items.push( { label: __( 'Published' ), iso: detail.post.date } );
	}
	if ( detail.post.modified && detail.post.modified !== detail.post.date ) {
		items.push( { label: __( 'Modified' ), iso: detail.post.modified } );
	}
	for ( const it of items ) {
		const row = document.createElement( 'div' );
		row.className = 'desktop-mode-content-graph__panel-date-row';
		const label = document.createElement( 'span' );
		label.className = 'desktop-mode-content-graph__panel-section-label';
		label.textContent = it.label;
		const value = document.createElement( 'span' );
		value.className = 'desktop-mode-content-graph__panel-date-value';
		value.textContent = formatDate( it.iso );
		row.appendChild( label );
		row.appendChild( value );
		host.appendChild( row );
	}
}

function renderStatsBlock( host: HTMLElement, detail: PostDetail ): void {
	host.replaceChildren();
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
		const label = document.createElement( 'span' );
		label.className = 'desktop-mode-content-graph__panel-stat-label';
		label.textContent = e.label;
		li.appendChild( num );
		li.appendChild( label );
		host.appendChild( li );
	}
}

function renderActionsBlock(
	host: HTMLElement,
	detail: PostDetail,
	openUrl: ( href: string, label: string, icon: string ) => void,
	openInMyWordpress: () => void,
	hasMyWordpress: boolean,
): void {
	host.replaceChildren();

	if ( hasMyWordpress ) {
		const myWp = document.createElement( 'button' );
		myWp.type = 'button';
		myWp.className =
			'desktop-mode-content-graph__btn desktop-mode-content-graph__btn--primary';
		myWp.innerHTML =
			'<span class="dashicons dashicons-wordpress" aria-hidden="true"></span>' +
			`<span>${ escapeHtml( __( 'Open in My WordPress' ) ) }</span>`;
		myWp.title = __( 'Open this post in the My WordPress window' );
		myWp.addEventListener( 'click', () => openInMyWordpress() );
		host.appendChild( myWp );
	}

	if ( detail.post.edit_url ) {
		const edit = document.createElement( 'button' );
		edit.type = 'button';
		edit.className = 'desktop-mode-content-graph__btn';
		edit.innerHTML =
			'<span class="dashicons dashicons-edit" aria-hidden="true"></span>' +
			`<span>${ escapeHtml( __( 'Edit' ) ) }</span>`;
		edit.addEventListener( 'click', () =>
			openUrl(
				detail.post.edit_url,
				detail.post.title,
				'dashicons-admin-post',
			),
		);
		host.appendChild( edit );
	}

	if ( detail.post.view_url ) {
		const view = document.createElement( 'button' );
		view.type = 'button';
		view.className = 'desktop-mode-content-graph__btn';
		view.innerHTML =
			'<span class="dashicons dashicons-external" aria-hidden="true"></span>' +
			`<span>${ escapeHtml( __( 'View' ) ) }</span>`;
		view.addEventListener( 'click', () =>
			openUrl(
				detail.post.view_url,
				detail.post.title,
				'dashicons-admin-post',
			),
		);
		host.appendChild( view );
	}
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
