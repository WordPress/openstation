/**
 * Desktop Mode — File-tile preview renderer.
 *
 * Given a placement, produces an HTML node describing the underlying
 * entity for the right pane of any folder window. Routes by file
 * type and reuses the same REST endpoints the My WordPress folder
 * uses (`/wp/v2/posts/<id>`, `/desktop-mode/v1/user-stats/<id>`,
 * `/desktop-mode/v1/term-stats/<tax>/<id>`,
 * `/desktop-mode/v1/comment-stats/<id>`) so the visual + the data
 * are consistent across surfaces.
 *
 * Plugins extend this map via the `desktop-mode.files.preview`
 * filter — return any HTMLElement (or `null` to defer to the
 * built-in for that type). Reusable by any window that needs an
 * entity preview pane.
 *
 * @public
 * @since 0.8.0
 */

import { applyFilters } from '../hooks';
import { __, sprintf } from '../i18n';
import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import type { RestPlacementShape } from './rest';
// Pre-registered globally by the lazy shell-overlays bundle (Stage 10) — see src/shell-overlays/entry.ts.

interface FetchInit extends RequestInit {
	silent?: boolean;
}

async function getJson< T >( url: string, init: FetchInit = {} ): Promise< T > {
	const response = await trackedFetch( url, {
		credentials: 'same-origin',
		headers: {
			Accept: 'application/json',
			'X-WP-Nonce': readRestNonce(),
			...( init.headers ?? {} ),
		},
		...init,
	} );
	if ( ! response.ok ) {
		throw new Error( `${ response.status } ${ response.statusText }` );
	}
	return ( await response.json() ) as T;
}

function readRestNonce(): string {
	const cfg = (
		window.wp as
			| { desktop?: { config?: { restNonce?: string } } }
			| undefined
	)?.desktop?.config;
	return cfg?.restNonce ?? '';
}

function readRestRoot(): string {
	const cfg = (
		window.wp as
			| { desktop?: { config?: { restUrl?: string; adminUrl?: string } } }
			| undefined
	)?.desktop?.config;
	if ( cfg?.restUrl ) {
		return cfg.restUrl.endsWith( '/' ) ? cfg.restUrl : cfg.restUrl + '/';
	}
	// Last-ditch fallback used only when the shell config never lands
	// (e.g., the file-tile renders before `wp.desktop` boots). Assumes
	// pretty permalinks; plain-permalink sites that hit this path would
	// 404, but in practice the shell config is always present by the
	// time a preview is requested.
	return `${ window.location.origin }/wp-json/`;
}

function restUrl( path: string ): string {
	return joinRestUrl( readRestRoot(), path );
}

/* ------------------------------------------------------------------ *
 *  Public entry point.
 * ------------------------------------------------------------------ */

/**
 * Render the preview node for a placement. Returns immediately with
 * a loading placeholder; the host is replaced when data arrives.
 *
 * @param placement Selected placement.
 * @param host      Element whose children should be replaced.
 */
export function renderPlacementPreview(
	placement: RestPlacementShape,
	host: HTMLElement,
): void {
	const filtered = applyFilters< HTMLElement | null, [ RestPlacementShape ] >(
		'desktop-mode.files.preview',
		null,
		placement,
	);
	if ( filtered instanceof HTMLElement ) {
		host.replaceChildren( filtered );
		return;
	}
	// Access-gated short-circuit. Whenever the recipient sees an
	// icon they can't open (shared-folder visibility), the preview
	// pane shows a friendly "you don't have permission" empty state
	// instead of triggering a REST fetch that will 403/404. Cheaper
	// AND clearer to the user.
	if ( placement.accessGated ) {
		host.replaceChildren( renderAccessGated( placement ) );
		return;
	}
	host.replaceChildren( renderLoading() );
	void renderByType( placement )
		.then( ( node ) => {
			host.replaceChildren( node );
		} )
		.catch( ( err: unknown ) => {
			host.replaceChildren( renderError( err ) );
		} );
}

function renderAccessGated( placement: RestPlacementShape ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-files__access-gated';

	const ring = document.createElement( 'div' );
	ring.className = 'desktop-mode-files__access-gated-ring';
	const glyph = document.createElement( 'span' );
	glyph.className = 'dashicons dashicons-lock desktop-mode-files__access-gated-glyph';
	glyph.setAttribute( 'aria-hidden', 'true' );
	ring.appendChild( glyph );
	wrap.appendChild( ring );

	const title = document.createElement( 'h2' );
	title.className = 'desktop-mode-files__access-gated-title';
	title.textContent = 'No permission to view';
	wrap.appendChild( title );

	const sub = document.createElement( 'p' );
	sub.className = 'desktop-mode-files__access-gated-sub';
	const target = placement.file.title || placement.file.type;
	sub.textContent = `You don’t have access to "${ target }". The folder owner shared this folder with you, but your role doesn’t include permission to open this item.`;
	wrap.appendChild( sub );

	const hint = document.createElement( 'p' );
	hint.className = 'desktop-mode-files__access-gated-hint';
	hint.textContent = 'Ask the owner to grant access on the underlying item, or to remove it from the shared folder.';
	wrap.appendChild( hint );

	return wrap;
}

async function renderByType(
	placement: RestPlacementShape,
): Promise< HTMLElement > {
	const file = placement.file;
	switch ( file.type ) {
		case 'post':
			return renderPostPreview( file.ref, file );
		case 'folder':
			return renderFolderPreview( file );
		case 'shortcut':
			return renderShortcutPreview( file );
		case 'attachment':
			return renderAttachmentPreview( file.ref, file );
		case 'user':
			return renderUserSummary( file.ref, file );
		case 'term':
			return renderTermSummary( file );
		case 'comment':
			return renderCommentSummary( file.ref, file );
		case 'bookmark':
			return renderBookmarkPreview( file );
		default:
			return renderGenericPreview( file );
	}
}

/* ------------------------------------------------------------------ *
 *  Built-in renderers.
 * ------------------------------------------------------------------ */

interface PostPreviewData {
	id: number;
	title: { rendered: string };
	content: { rendered: string };
	date: string;
	link: string;
	status: string;
}

async function renderPostPreview(
	ref: string,
	file: RestPlacementShape[ 'file' ],
): Promise< HTMLElement > {
	const id = parseInt( ref, 10 );
	if ( ! id ) {
		return renderGenericPreview( file );
	}
	// Try `/wp/v2/posts/<id>` first; if 404 (not a post type) fall
	// through to pages, then a generic /pages/<id>. Cheaper than
	// hitting both up front.
	let data: PostPreviewData | null = null;
	for ( const path of [ 'wp/v2/posts', 'wp/v2/pages' ] ) {
		try {
			data = await getJson< PostPreviewData >(
				restUrl(
					`${ path }/${ id }?_fields=id,title,content,date,link,status`,
				),
			);
			break;
		} catch {
			// 404 / 403 — try the next path.
		}
	}
	if ( ! data ) {
		return renderGenericPreview( file );
	}

	const wrap = articleShell();
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = stripTags( data.title.rendered ) || file.title || `#${ id }`;
	wrap.appendChild( h );

	const meta = document.createElement( 'p' );
	meta.className = 'desktop-mode-my-wordpress__article-meta';
	const parts: string[] = [];
	parts.push( formatDate( data.date ) );
	if ( data.status && data.status !== 'publish' ) {
		parts.push( data.status );
	}
	meta.textContent = parts.join( ' · ' );
	wrap.appendChild( meta );

	if ( data.content?.rendered ) {
		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-my-wordpress__article-content';
		body.innerHTML = data.content.rendered;
		wrap.appendChild( body );
	}

	const footer = document.createElement( 'footer' );
	footer.className = 'desktop-mode-my-wordpress__article-footer';

	// "Explore details" — only shown when the My WordPress bundle
	// is loaded and has registered its public API. Routes the
	// existing My WordPress window straight to this post's detail
	// dossier (Author / Comments / Tags / Categories / Attached
	// media / Revisions). Single source of truth for the dossier
	// renderer; no duplication here.
	const myWordpressApi = (
		window.wp as
			| {
					desktop?: {
						myWordpress?: {
							openDetail: ( a: {
								entityId: string;
								postId: number;
								postTitle: string;
							} ) => void;
						};
					};
			}
			| undefined
	)?.desktop?.myWordpress;
	if ( myWordpressApi ) {
		const exploreBtn = document.createElement( 'wpd-button' );
		exploreBtn.setAttribute( 'variant', 'secondary' );
		exploreBtn.textContent = __( 'Explore details', 'desktop-mode' );
		exploreBtn.title = __(
			'See author, comments, categories, tags, attached media, and revisions for this entry.',
			'desktop-mode',
		);
		exploreBtn.addEventListener( 'click', () => {
			const postType =
				typeof file.postType === 'string'
					? ( file.postType as string )
					: 'post';
			myWordpressApi.openDetail( {
				entityId: postType === 'page' ? 'pages' : 'posts',
				postId: id,
				postTitle: stripTags( data.title.rendered ) || `#${ id }`,
			} );
		} );
		footer.appendChild( exploreBtn );
	}

	const editBtn = document.createElement( 'wpd-button' );
	editBtn.setAttribute( 'variant', 'primary' );
	editBtn.textContent = __( 'Open in editor', 'desktop-mode' );
	editBtn.addEventListener( 'click', () => {
		const adminUrl = (
			window.wp as
				| { desktop?: { config?: { adminUrl?: string } } }
				| undefined
		)?.desktop?.config?.adminUrl;
		if ( ! adminUrl ) {
			return;
		}
		const editUrl = `${ adminUrl }post.php?post=${ id }&action=edit`;
		const wm = (
			window.wp as
				| {
						desktop?: {
							windowManager?: {
								open: ( cfg: Record< string, unknown > ) => unknown;
							};
						};
				}
				| undefined
		)?.desktop?.windowManager;
		wm?.open( {
			url: editUrl,
			title: stripTags( data.title.rendered ),
			icon: file.icon,
		} );
	} );
	footer.appendChild( editBtn );
	wrap.appendChild( footer );
	return wrap;
}

interface UserSummaryData {
	profile: {
		id: number;
		name: string;
		description: string;
		link: string;
		avatarUrl: string;
		registered?: string;
		roleLabels?: string[];
	};
	counts: {
		posts: { total: number; publish: number };
		pages: { total: number };
		commentsReceived: number;
		commentsLeft: number;
	};
}

async function renderUserSummary(
	ref: string,
	file: RestPlacementShape[ 'file' ],
): Promise< HTMLElement > {
	const id = parseInt( ref, 10 );
	if ( ! id ) {
		return renderGenericPreview( file );
	}
	let data: UserSummaryData | null = null;
	try {
		data = await getJson< UserSummaryData >(
			restUrl( `desktop-mode/v1/user-stats/${ id }` ),
		);
	} catch {
		return renderGenericPreview( file );
	}
	const wrap = articleShell( 'desktop-mode-my-wordpress__user' );
	const header = document.createElement( 'header' );
	header.className = 'desktop-mode-my-wordpress__user-header';
	if ( data.profile.avatarUrl ) {
		const img = document.createElement( 'img' );
		img.className = 'desktop-mode-my-wordpress__user-avatar';
		img.src = data.profile.avatarUrl;
		img.alt = '';
		header.appendChild( img );
	}
	const head = document.createElement( 'div' );
	head.className = 'desktop-mode-my-wordpress__user-headline';
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = data.profile.name || file.title || `#${ id }`;
	head.appendChild( h );
	if ( data.profile.roleLabels && data.profile.roleLabels.length > 0 ) {
		const roles = document.createElement( 'div' );
		roles.className = 'desktop-mode-my-wordpress__user-roles';
		for ( const r of data.profile.roleLabels ) {
			const badge = document.createElement( 'span' );
			badge.className = 'desktop-mode-my-wordpress__user-role';
			badge.textContent = r;
			roles.appendChild( badge );
		}
		head.appendChild( roles );
	}
	header.appendChild( head );
	wrap.appendChild( header );
	if ( data.profile.description ) {
		const bio = document.createElement( 'div' );
		bio.className = 'desktop-mode-my-wordpress__user-bio';
		bio.textContent = data.profile.description;
		wrap.appendChild( bio );
	}
	const cards = document.createElement( 'div' );
	cards.className = 'desktop-mode-my-wordpress__user-stats';
	cards.appendChild(
		statCard(
			data.counts.posts.total.toLocaleString(),
			__( 'Posts', 'desktop-mode' ),
		),
	);
	cards.appendChild(
		statCard(
			data.counts.pages.total.toLocaleString(),
			__( 'Pages', 'desktop-mode' ),
		),
	);
	cards.appendChild(
		statCard(
			data.counts.commentsReceived.toLocaleString(),
			__( 'Comments received', 'desktop-mode' ),
		),
	);
	wrap.appendChild( cards );
	return wrap;
}

interface TermSummaryData {
	profile: {
		id: number;
		name: string;
		description: string;
		taxonomyLabel: string;
		taxonomy: string;
		link: string;
		storedCount: number;
	};
	counts: {
		posts: { total: number };
		commentsReceived: number;
		distinctAuthors: number;
	};
}

async function renderTermSummary(
	file: RestPlacementShape[ 'file' ],
): Promise< HTMLElement > {
	const id = parseInt( file.ref, 10 );
	const taxonomy =
		typeof file.taxonomy === 'string' && file.taxonomy
			? ( file.taxonomy as string )
			: 'category';
	if ( ! id ) {
		return renderGenericPreview( file );
	}
	let data: TermSummaryData | null = null;
	try {
		data = await getJson< TermSummaryData >(
			restUrl( `desktop-mode/v1/term-stats/${ taxonomy }/${ id }` ),
		);
	} catch {
		return renderGenericPreview( file );
	}
	const wrap = articleShell();
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = data.profile.name || file.title || `#${ id }`;
	wrap.appendChild( h );
	const meta = document.createElement( 'p' );
	meta.className = 'desktop-mode-my-wordpress__article-meta';
	meta.textContent = data.profile.taxonomyLabel || data.profile.taxonomy;
	wrap.appendChild( meta );
	if ( data.profile.description ) {
		const desc = document.createElement( 'div' );
		desc.className = 'desktop-mode-my-wordpress__article-content';
		desc.innerHTML = data.profile.description;
		wrap.appendChild( desc );
	}
	const cards = document.createElement( 'div' );
	cards.className = 'desktop-mode-my-wordpress__user-stats';
	cards.appendChild(
		statCard(
			data.counts.posts.total.toLocaleString(),
			__( 'Posts', 'desktop-mode' ),
		),
	);
	cards.appendChild(
		statCard(
			data.counts.commentsReceived.toLocaleString(),
			__( 'Comments', 'desktop-mode' ),
		),
	);
	cards.appendChild(
		statCard(
			data.counts.distinctAuthors.toLocaleString(),
			__( 'Authors', 'desktop-mode' ),
		),
	);
	wrap.appendChild( cards );
	return wrap;
}

interface CommentSummaryData {
	comment: {
		id: number;
		date: string;
		status: string;
		rendered: string;
	};
	author: {
		name: string;
		avatarUrl: string;
	};
	post: { id: number; title: string; link: string } | null;
}

async function renderCommentSummary(
	ref: string,
	file: RestPlacementShape[ 'file' ],
): Promise< HTMLElement > {
	const id = parseInt( ref, 10 );
	if ( ! id ) {
		return renderGenericPreview( file );
	}
	let data: CommentSummaryData | null = null;
	try {
		data = await getJson< CommentSummaryData >(
			restUrl( `desktop-mode/v1/comment-stats/${ id }` ),
		);
	} catch {
		return renderGenericPreview( file );
	}
	const wrap = articleShell();
	const header = document.createElement( 'header' );
	header.className = 'desktop-mode-my-wordpress__user-header';
	if ( data.author.avatarUrl ) {
		const img = document.createElement( 'img' );
		img.className = 'desktop-mode-my-wordpress__user-avatar';
		img.src = data.author.avatarUrl;
		img.alt = '';
		header.appendChild( img );
	}
	const head = document.createElement( 'div' );
	head.className = 'desktop-mode-my-wordpress__user-headline';
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = data.author.name;
	head.appendChild( h );
	const sub = document.createElement( 'p' );
	sub.className = 'desktop-mode-my-wordpress__article-meta';
	sub.textContent = `${ formatDate( data.comment.date ) } · ${ data.comment.status }`;
	head.appendChild( sub );
	header.appendChild( head );
	wrap.appendChild( header );
	const body = document.createElement( 'div' );
	body.className = 'desktop-mode-my-wordpress__article-content';
	body.innerHTML = data.comment.rendered;
	wrap.appendChild( body );
	if ( data.post ) {
		const card = document.createElement( 'div' );
		card.className = 'desktop-mode-my-wordpress__comment-post';
		const link = document.createElement( 'a' );
		link.className = 'desktop-mode-my-wordpress__comment-post-title';
		link.href = data.post.link;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.textContent = data.post.title;
		card.appendChild( link );
		wrap.appendChild( card );
	}
	return wrap;
}

interface AttachmentData {
	id: number;
	title: { rendered: string };
	source_url: string;
	mime_type: string;
	alt_text: string;
	media_details?: {
		sizes?: Record< string, { source_url: string } | undefined >;
	};
}

async function renderAttachmentPreview(
	ref: string,
	file: RestPlacementShape[ 'file' ],
): Promise< HTMLElement > {
	const id = parseInt( ref, 10 );
	if ( ! id ) {
		return renderGenericPreview( file );
	}
	let data: AttachmentData | null = null;
	try {
		data = await getJson< AttachmentData >(
			restUrl(
				`wp/v2/media/${ id }?_fields=id,title,source_url,mime_type,alt_text,media_details`,
			),
		);
	} catch {
		return renderGenericPreview( file );
	}
	const wrap = articleShell();
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = stripTags( data.title.rendered ) || file.title || `#${ id }`;
	wrap.appendChild( h );
	const meta = document.createElement( 'p' );
	meta.className = 'desktop-mode-my-wordpress__article-meta';
	meta.textContent = data.mime_type;
	wrap.appendChild( meta );
	if ( data.mime_type.startsWith( 'image/' ) ) {
		const img = document.createElement( 'img' );
		img.className = 'desktop-mode-my-wordpress__article-hero';
		const sizes = data.media_details?.sizes;
		img.src =
			sizes?.large?.source_url ?? sizes?.medium?.source_url ?? data.source_url;
		img.alt = data.alt_text ?? '';
		wrap.appendChild( img );
	} else {
		const p = document.createElement( 'p' );
		const a = document.createElement( 'a' );
		a.href = data.source_url;
		a.textContent = data.source_url;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		p.appendChild( a );
		wrap.appendChild( p );
	}
	return wrap;
}

function renderFolderPreview(
	file: RestPlacementShape[ 'file' ],
): HTMLElement {
	const wrap = articleShell();
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = file.title || __( '(folder)', 'desktop-mode' );
	wrap.appendChild( h );
	const meta = document.createElement( 'p' );
	meta.className = 'desktop-mode-my-wordpress__article-meta';
	meta.textContent = __( 'Double-click to open.', 'desktop-mode' );
	wrap.appendChild( meta );
	return wrap;
}

function renderShortcutPreview(
	file: RestPlacementShape[ 'file' ],
): HTMLElement {
	const wrap = articleShell();
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = file.title || __( 'Shortcut', 'desktop-mode' );
	wrap.appendChild( h );
	const meta = document.createElement( 'p' );
	meta.className = 'desktop-mode-my-wordpress__article-meta';
	meta.textContent = __( 'Plugin shortcut. Double-click to open.', 'desktop-mode' );
	wrap.appendChild( meta );
	return wrap;
}

function renderBookmarkPreview(
	file: RestPlacementShape[ 'file' ],
): HTMLElement {
	const wrap = articleShell();
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = file.title || __( 'Bookmark', 'desktop-mode' );
	wrap.appendChild( h );
	const url = typeof file.url === 'string' ? ( file.url as string ) : '';
	if ( url ) {
		const a = document.createElement( 'a' );
		a.href = url;
		a.textContent = url;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		wrap.appendChild( a );
	}
	return wrap;
}

function renderGenericPreview(
	file: RestPlacementShape[ 'file' ],
): HTMLElement {
	const wrap = articleShell();
	const h = document.createElement( 'h2' );
	h.className = 'desktop-mode-my-wordpress__article-title';
	h.textContent = file.title || file.type;
	wrap.appendChild( h );
	const meta = document.createElement( 'p' );
	meta.className = 'desktop-mode-my-wordpress__article-meta';
	meta.textContent = sprintf(
		// translators: %s is a file-type slug.
		__( 'Type: %s', 'desktop-mode' ),
		file.type,
	);
	wrap.appendChild( meta );
	if ( ! file.exists ) {
		const warn = document.createElement( 'p' );
		warn.className = 'desktop-mode-my-wordpress__article-meta';
		warn.textContent = __(
			'The underlying entity is no longer available.',
			'desktop-mode',
		);
		wrap.appendChild( warn );
	}
	return wrap;
}

/* ------------------------------------------------------------------ *
 *  Shared chrome.
 * ------------------------------------------------------------------ */

function articleShell( extraClass = '' ): HTMLElement {
	const article = document.createElement( 'article' );
	article.className =
		'desktop-mode-my-wordpress__article' +
		( extraClass ? ' ' + extraClass : '' );
	return article;
}

function statCard( value: string, label: string ): HTMLElement {
	const card = document.createElement( 'div' );
	card.className = 'desktop-mode-my-wordpress__user-stat';
	const v = document.createElement( 'span' );
	v.className = 'desktop-mode-my-wordpress__user-stat-value';
	v.textContent = value;
	card.appendChild( v );
	const l = document.createElement( 'span' );
	l.className = 'desktop-mode-my-wordpress__user-stat-label';
	l.textContent = label;
	card.appendChild( l );
	return card;
}

function renderLoading(): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__preview-loading';
	const spinner = document.createElement( 'wpd-spinner' );
	spinner.setAttribute( 'size', '128' );
	wrap.appendChild( spinner );
	return wrap;
}

function renderError( err: unknown ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__error';
	wrap.textContent =
		err instanceof Error ? err.message : __( 'Unknown error.', 'desktop-mode' );
	return wrap;
}

function stripTags( html: string ): string {
	const div = document.createElement( 'div' );
	div.innerHTML = html;
	return ( div.textContent ?? '' ).trim();
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

/**
 * Empty-state node — shown in the right pane when no tile is
 * selected. Same shell as the My WordPress empty preview so the
 * two surfaces feel like one product.
 */
export function renderPreviewEmpty(): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__preview-empty';
	wrap.textContent = __(
		'Select an item to preview it here.',
		'desktop-mode',
	);
	return wrap;
}
