/**
 * Native Comments window — conversation view.
 *
 * A two-pane redesign of the moderation surface: a rail of conversations
 * on the left (top-level comments per tab), and the full nested thread on
 * the right with per-message actions (reply, edit, approve, spam, trash)
 * and a docked reply composer.
 *
 * Reuses the existing REST helpers wholesale — this module owns rendering
 * and interaction only, never the transport.
 */

import { __, sprintf } from '../i18n';
import { decodeHTML } from '../utils';
import { applyAvatarSrc } from '../ui/util/avatar-resolve';
import {
	fetchComments,
	fetchCounts,
	fetchThread,
	bulkModerate,
	postReply,
	updateCommentContent,
	setActiveConfig,
	setActiveWindowId,
} from './rest';
import type {
	BulkAction,
	CommentCounts,
	CommentRow,
	CommentTab,
	CommentsConfig,
} from './types';
import {
	takeCommentsPostFilter,
	clearCommentsPostFilter,
	subscribeCommentsPostFilter,
} from './post-filter';
import { wpdConfirm } from '../ui/components/wpd-confirm-dialog/wpd-confirm-dialog';
import '../ui/components/wpd-avatar/wpd-avatar';
import '../ui/components/wpd-badge/wpd-badge';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-empty-state/wpd-empty-state';
import '../ui/components/wpd-icon/wpd-icon';
import '../ui/components/wpd-relative-time/wpd-relative-time';
import '../ui/components/wpd-spinner/wpd-spinner';
import '../ui/components/wpd-text-field/wpd-text-field';
import '../ui/components/wpd-textarea/wpd-textarea';
import '../ui/components/wpd-tabs/wpd-tabs';

const NS = 'desktop-mode-comments';
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Ctx {
	cfg: CommentsConfig;
	listEl: HTMLElement;
	convoEl: HTMLElement;
	tabsEl: HTMLElement;
	statusEl: HTMLElement | null;
	tab: CommentTab;
	search: string;
	threads: CommentRow[];
	selectedId: number | null;
	/** When > 0, the rail is scoped to this post (edit-comments.php?p=). */
	postFilter: number;
	/** Rail pagination — last loaded page and the server's page total. */
	page: number;
	totalPages: number;
	/** Monotonic token so a stale rail fetch can't overwrite a newer one. */
	railSeq: number;
	/** Announce (postId>0) or clear (0) the window-links identity. */
	announceIdentity: ( postId: number ) => void;
	/** Push a short sentence into the window's polite live region. */
	announce: ( message: string ) => void;
	reloadRail: () => Promise< void >;
	reloadConvo: () => Promise< void >;
}

/* -------------------------------------------------------------------------- */
/* Small presentation helpers                                                 */
/* -------------------------------------------------------------------------- */

function readConfig(): CommentsConfig | null {
	const w = window as unknown as {
		desktopModeWindowConfig?: Record< string, CommentsConfig | undefined >;
		desktopModeNativeWindowConfig?: Record< string, CommentsConfig | undefined >;
	};
	return (
		w.desktopModeWindowConfig?.[ 'desktop-mode-comments' ] ??
		w.desktopModeNativeWindowConfig?.[ 'desktop-mode-comments' ] ??
		null
	);
}

/** wp-admin base URL, for building editor links the shell intercepts. */
function adminUrl(): string {
	const desktop = ( window as unknown as {
		wp?: { desktop?: { config?: { adminUrl?: string } } };
	} ).wp?.desktop;
	return desktop?.config?.adminUrl || '/wp-admin/';
}

/**
 * The `external` glyph from `@wordpress/icons` — the same mark the block
 * editor puts on its own "View Post" link. Inlined rather than pulled
 * from Dashicons so the two surfaces are pixel-identical; a link that
 * leaves Desktop Mode should look the same wherever WordPress offers it.
 */
function externalIcon(): SVGElement {
	const svg = document.createElementNS( SVG_NS, 'svg' );
	svg.setAttribute( 'viewBox', '0 0 24 24' );
	svg.setAttribute( 'aria-hidden', 'true' );
	svg.setAttribute( 'focusable', 'false' );
	svg.setAttribute( 'class', `${ NS }__ext-icon` );
	[
		'M19.5 4.5h-7V6h4.44l-5.97 5.97 1.06 1.06L18 7.06v4.44h1.5v-7Z',
		'M18 18v-5h1.5v5c0 .83-.67 1.5-1.5 1.5H6c-.83 0-1.5-.67-1.5-1.5V6c0-.83.67-1.5 1.5-1.5h5V6H6v12h12Z',
	].forEach( ( d ) => {
		const path = document.createElementNS( SVG_NS, 'path' );
		path.setAttribute( 'd', d );
		svg.appendChild( path );
	} );
	return svg;
}

/**
 * Announce (or clear) this window's content identity so the window-links
 * engine draws the connection spline to the post's editor — the tie the
 * classic `edit-comments.php?p=` iframe got from the chromeless bridge.
 * Grouping is by `root`, so a comment window of post N roots at that post.
 */
function announcePostIdentity(
	body: HTMLElement,
	postId: number,
	title?: string,
): void {
	const relations = ( window as unknown as {
		wp?: { desktop?: { relations?: { set?: ( id: string, ref: unknown ) => void } } };
	} ).wp?.desktop?.relations;
	// The relations API keys by the manager's window id — the DOM root is
	// `id="wp-window-<windowId>"`, so strip the prefix (matches
	// resolveMountedWindowId in native-windows.ts).
	const root = body.closest< HTMLElement >( '[id^="wp-window-"]' );
	const windowId = root?.id.slice( 'wp-window-'.length );
	if ( ! relations?.set || ! windowId ) {
		return;
	}
	const ref =
		postId > 0
			? {
				type: 'comment',
				id: postId,
				root: { type: 'post', id: postId },
				label: title ? decodeHTML( title ) : undefined,
			}
			: null;
	try {
		relations.set( windowId, ref );
	} catch {
		// Malformed ref / API rejected it — the spline is cosmetic, ignore.
	}
}

function normalizeStatus( row: CommentRow ): string {
	const s = String( row.status );
	if ( s === 'approve' || s === 'approved' || s === '1' ) {
		return 'approved';
	}
	if ( s === 'hold' || s === '0' || s === 'unapproved' ) {
		return 'hold';
	}
	return s; // spam | trash
}

/** Human label for a moderation status. */
function statusLabel( status: string ): string {
	switch ( status ) {
		case 'approved':
			return __( 'Approved' );
		case 'hold':
			return __( 'Pending' );
		case 'spam':
			return __( 'Spam' );
		case 'trash':
			return __( 'Trash' );
		default:
			return status;
	}
}

/** `<wpd-badge>` tone that reads the way the status feels. */
function statusTone( status: string ): string {
	switch ( status ) {
		case 'approved':
			return 'success';
		case 'hold':
			return 'warning';
		case 'spam':
			return 'danger';
		default:
			return 'neutral';
	}
}

/**
 * Moderation status as a `<wpd-badge>`.
 *
 * `dotOnly` shrinks the pill to just its tone dot for the rail, where
 * there's no room for a word — the label rides along as slotted
 * screen-reader text, so the colour is never the only carrier of the
 * meaning, and the tooltip covers sighted users who can't read the hue.
 *
 * @param status  Normalized status.
 * @param dotOnly Collapse to the dot (rail) instead of a labelled pill.
 */
function statusBadge( status: string, dotOnly = false ): HTMLElement {
	const badge = document.createElement( 'wpd-badge' );
	badge.setAttribute( 'tone', statusTone( status ) );
	const label = statusLabel( status );
	if ( dotOnly ) {
		badge.className = `${ NS }__status`;
		badge.title = label;
		const sr = document.createElement( 'span' );
		sr.className = 'screen-reader-text';
		sr.textContent = label;
		badge.appendChild( sr );
	} else {
		badge.className = `${ NS }__msg-status`;
		badge.textContent = label;
	}
	return badge;
}

/**
 * A live timestamp for `date_gmt`.
 *
 * `<wpd-relative-time>` takes WordPress's MySQL-style `*_gmt` string
 * directly (it treats a space-separated value as UTC), formats through
 * `Intl.RelativeTimeFormat` so the copy pluralizes and localizes
 * properly, renders a semantic `<time datetime>`, carries the absolute
 * timestamp in `title`, and re-renders itself on one shared 30-second
 * ticker — so a rail left open overnight isn't still claiming "5m".
 *
 * @param gmt     A `*_gmt` datetime string.
 * @param compact Abbreviated form for the narrow rail cell.
 */
function timestamp( gmt: string, compact = false ): HTMLElement {
	const el = document.createElement( 'wpd-relative-time' );
	el.setAttribute( 'datetime', gmt );
	if ( compact ) {
		el.setAttribute( 'compact', '' );
	}
	return el;
}

function snippet( row: CommentRow ): string {
	const raw = row.content?.rendered ?? row.content?.raw ?? '';
	const text = decodeHTML( raw.replace( /<[^>]*>/g, ' ' ) ).replace( /\s+/g, ' ' ).trim();
	return text;
}

/**
 * The commenter's avatar.
 *
 * `<wpd-avatar>` already does everything the old hand-rolled disc did
 * — deterministic hue, initials fallback, circular clip — plus the two
 * things it got wrong. It falls back to the initials tile when the
 * image fails, and it is what `applyAvatarSrc` is documented to drive:
 * the helper probes a Gravatar URL and REMOVES `src` when the address
 * has no registered avatar. Pointed at a bare `<img>`, that left an
 * empty circle, because the disc had already thrown its initial away.
 *
 * @param row  Comment whose author is being pictured.
 * @param size Tile size in px — 36 in the rail, 34 in the thread.
 */
function avatar( row: CommentRow, size: number ): HTMLElement {
	const el = document.createElement( 'wpd-avatar' );
	el.className = `${ NS }__disc`;
	el.setAttribute( 'name', row.author_name || '?' );
	el.setAttribute( 'size', String( size ) );
	// Decorative: the author's name is already text next to it, so a
	// second announcement would just be noise.
	el.setAttribute( 'alt', '' );
	const url =
		row.author_avatar_urls?.[ '48' ] ??
		row.author_avatar_urls?.[ '96' ] ??
		row.author_avatar_urls?.[ '24' ] ??
		'';
	if ( url ) {
		applyAvatarSrc( el, url );
	}
	return el;
}

/**
 * One action in the per-message row.
 *
 * Rendered as `<wpd-button variant="link">` — the chrome-less variant —
 * so the row reads as wp-admin's own comment row actions
 * (`Approve | Reply | Edit | Spam | Trash`): plain links, pipe
 * separators from CSS, red for the two that take a comment out of the
 * conversation. Still the kit component rather than a bare `<a>`, so
 * the row keeps the framework focus ring, `disabled` semantics, and the
 * `busy` attribute that gives a moderation click its in-flight feedback.
 *
 * @param label   Visible action label.
 * @param tone    `danger` tints the link red (spam / trash).
 * @param onClick Receives the button so the caller can mark it busy.
 */
function actionButton(
	label: string,
	tone: 'default' | 'danger',
	onClick: ( button: HTMLElement ) => void,
): HTMLElement {
	const button = document.createElement( 'wpd-button' );
	button.className = `${ NS }__act${ tone === 'danger' ? ' is-danger' : '' }`;
	button.setAttribute( 'variant', 'link' );
	button.textContent = label;
	button.addEventListener( 'click', ( e ) => {
		e.stopPropagation();
		if ( button.hasAttribute( 'disabled' ) ) {
			return;
		}
		onClick( button );
	} );
	return button;
}

/* -------------------------------------------------------------------------- */
/* Editor primitive                                                           */
/* -------------------------------------------------------------------------- */

interface Editor {
	root: HTMLElement;
	getValue: () => string;
	setValue: ( value: string ) => void;
	focus: () => void;
	setDisabled: ( disabled: boolean ) => void;
}

/**
 * A `<wpd-textarea>` wired to the kit's event shape.
 *
 * `submit-on-enter` gives the reply composer chat semantics (Enter
 * sends, Shift+Enter newlines) straight from the component; the inline
 * comment editor leaves it off, since editing an existing multi-paragraph
 * comment wants Enter to mean "new line".
 */
function mountEditor( opts: {
	placeholder: string;
	ariaLabel: string;
	initial?: string;
	rows?: number;
	submitOnEnter?: boolean;
	onSubmit?: () => void;
} ): Editor {
	const el = document.createElement( 'wpd-textarea' );
	el.className = `${ NS }__reply-input`;
	el.setAttribute( 'placeholder', opts.placeholder );
	el.setAttribute( 'aria-label', opts.ariaLabel );
	el.setAttribute( 'rows', String( opts.rows ?? 3 ) );
	el.setAttribute( 'auto-grow', '' );
	el.setAttribute( 'max-rows', '10' );
	el.setAttribute( 'value', opts.initial ?? '' );
	if ( opts.submitOnEnter ) {
		el.setAttribute( 'submit-on-enter', '' );
	}

	// The component reflects `value` two-way, but mirroring it locally
	// keeps reads synchronous and independent of attribute timing.
	let current = opts.initial ?? '';
	const track = ( e: Event ): void => {
		current = String( ( e as CustomEvent< { value: string } > ).detail?.value ?? '' );
	};
	el.addEventListener( 'wpd-input-change', track );
	el.addEventListener( 'wpd-input-commit', track );
	if ( opts.onSubmit ) {
		el.addEventListener( 'wpd-submit', ( e ) => {
			track( e );
			opts.onSubmit?.();
		} );
	}

	// The real `<textarea>` lives in the component's shadow root and the
	// host does not delegate focus — go through the documented
	// imperative helpers rather than `host.focus()`, which would be a
	// silent no-op.
	const api = el as HTMLElement & {
		focusInput?: () => void;
		clear?: () => void;
		refreshAutosize?: () => void;
	};

	return {
		root: el,
		getValue: () => current.trim(),
		setValue: ( value: string ) => {
			current = value;
			if ( value === '' && api.clear ) {
				api.clear();
				return;
			}
			el.setAttribute( 'value', value );
			api.refreshAutosize?.();
		},
		focus: () => {
			if ( api.focusInput ) {
				api.focusInput();
			} else {
				el.focus();
			}
		},
		setDisabled: ( disabled: boolean ) => {
			if ( disabled ) {
				el.setAttribute( 'disabled', '' );
			} else {
				el.removeAttribute( 'disabled' );
			}
		},
	};
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

/** Mark one tab active by handing the value back to `<wpd-tabs>`. */
function setActiveTab( tabsEl: HTMLElement, tabValue: string ): void {
	// The component owns aria-selected + roving tabindex off this prop.
	( tabsEl as unknown as { value: string } ).value = tabValue;
	tabsEl.setAttribute( 'value', tabValue );
}

/**
 * Paint the per-tab count chips.
 *
 * "Mine" is deliberately left bare — the counts endpoint reports the
 * site totals, and showing a site-wide number next to a viewer-scoped
 * tab would read as a bug.
 */
function paintTabCounts( tabsEl: HTMLElement, counts: CommentCounts ): void {
	const forTab: Record< string, number | null > = {
		pending: counts.pending,
		all: counts.approved + counts.pending,
		spam: counts.spam,
		trash: counts.trash,
		mine: null,
	};
	tabsEl.querySelectorAll< HTMLElement >( 'wpd-tab' ).forEach( ( tab ) => {
		const value = tab.getAttribute( 'value' ) ?? '';
		const count = forTab[ value ];
		let chip = tab.querySelector< HTMLElement >( `.${ NS }__tab-count` );
		if ( count === null || count === undefined ) {
			chip?.remove();
			return;
		}
		if ( ! chip ) {
			chip = document.createElement( 'wpd-badge' );
			chip.className = `${ NS }__tab-count`;
			chip.setAttribute( 'tone', 'neutral' );
			chip.setAttribute( 'no-dot', '' );
			tab.appendChild( chip );
		}
		chip.textContent = String( count );
	} );
}

async function refreshCounts( ctx: Ctx ): Promise< void > {
	try {
		paintTabCounts( ctx.tabsEl, await fetchCounts( ctx.cfg ) );
	} catch {
		// Counts are decoration — a failure must never break the rail.
	}
}

/* -------------------------------------------------------------------------- */
/* Rail                                                                       */
/* -------------------------------------------------------------------------- */

function threadItem( ctx: Ctx, row: CommentRow ): HTMLElement {
	// `role="listitem"` has to live on a wrapper: putting it on the
	// button would override the button role and cost the row its
	// keyboard semantics.
	const slot = document.createElement( 'div' );
	slot.setAttribute( 'role', 'listitem' );
	slot.className = `${ NS }__thread-slot`;

	const item = document.createElement( 'button' );
	item.type = 'button';
	item.className = `${ NS }__thread`;
	item.dataset.id = String( row.id );
	if ( ctx.selectedId === row.id ) {
		item.classList.add( 'is-selected' );
		// `aria-current` (not `aria-selected`, which is only valid on
		// option/tab/row roles) is the correct "this is the one you're
		// looking at" signal for a list of buttons.
		item.setAttribute( 'aria-current', 'true' );
	}

	const main = document.createElement( 'div' );
	main.className = `${ NS }__thread-main`;
	const name = document.createElement( 'div' );
	name.className = `${ NS }__thread-name`;
	name.textContent = row.author_name || __( 'Anonymous' );
	name.appendChild( statusBadge( normalizeStatus( row ), true ) );
	const snip = document.createElement( 'div' );
	snip.className = `${ NS }__thread-snip`;
	snip.textContent = snippet( row );
	const post = document.createElement( 'div' );
	post.className = `${ NS }__thread-post`;
	post.textContent = decodeHTML( row.desktop_mode_post_title || '' );
	main.append( name, snip, post );

	const meta = document.createElement( 'div' );
	meta.className = `${ NS }__thread-meta`;
	const time = timestamp( row.date_gmt, true );
	time.className = `${ NS }__thread-time`;
	meta.appendChild( time );
	if ( row.desktop_mode_replies_count > 0 ) {
		const rc = document.createElement( 'wpd-badge' );
		rc.className = `${ NS }__reply-count`;
		rc.setAttribute( 'tone', 'neutral' );
		rc.setAttribute( 'no-dot', '' );
		rc.textContent = String( row.desktop_mode_replies_count );
		const rcLabel = document.createElement( 'span' );
		rcLabel.className = 'screen-reader-text';
		rcLabel.textContent = sprintf(
			/* translators: %d: number of direct replies. */
			__( '%d replies' ),
			row.desktop_mode_replies_count,
		);
		rc.appendChild( rcLabel );
		meta.appendChild( rc );
	}

	item.append( avatar( row, 36 ), main, meta );
	item.addEventListener( 'click', () => selectThread( ctx, row ) );
	slot.appendChild( item );
	return slot;
}

/** "Filtered to one post" banner + a Show-all escape hatch. */
function filterBanner( ctx: Ctx ): HTMLElement {
	const bar = document.createElement( 'div' );
	bar.className = `${ NS }__rail-filter`;
	const label = document.createElement( 'span' );
	label.className = `${ NS }__rail-filter-label`;
	const title = ctx.threads[ 0 ]?.desktop_mode_post_title;
	label.textContent = title
		? /* translators: %s: post title. */ sprintf( __( 'On: %s' ), decodeHTML( title ) )
		: __( 'Comments on this post' );
	const clear = document.createElement( 'wpd-button' );
	clear.className = `${ NS }__rail-filter-clear`;
	clear.setAttribute( 'variant', 'link' );
	clear.textContent = __( 'Show all' );
	clear.addEventListener( 'click', () => {
		ctx.postFilter = 0;
		clearCommentsPostFilter();
		ctx.announceIdentity( 0 );
		void loadRail( ctx );
	} );
	bar.append( label, clear );
	return bar;
}

/** Spinner row — used while a pane is fetching its first payload. */
function loadingRow(): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = `${ NS }__list-loading`;
	const spinner = document.createElement( 'wpd-spinner' );
	spinner.setAttribute( 'size', '24' );
	// The spinner is decorative; the live region carries the state for
	// anyone who isn't watching it turn.
	const sr = document.createElement( 'span' );
	sr.className = 'screen-reader-text';
	sr.textContent = __( 'Loading…' );
	wrap.append( spinner, sr );
	return wrap;
}

/** "Load more" footer — only when the server says there's another page. */
function loadMoreRow( ctx: Ctx ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = `${ NS }__load-more`;
	const button = document.createElement( 'wpd-button' );
	button.setAttribute( 'variant', 'ghost' );
	button.textContent = __( 'Load more' );
	button.addEventListener( 'click', () => {
		button.setAttribute( 'busy', '' );
		button.setAttribute( 'disabled', '' );
		void loadRail( ctx, { append: true } );
	} );
	wrap.appendChild( button );
	return wrap;
}

function renderRail( ctx: Ctx ): void {
	ctx.listEl.replaceChildren();
	if ( ctx.postFilter > 0 ) {
		ctx.listEl.appendChild( filterBanner( ctx ) );
	}
	if ( ctx.threads.length === 0 ) {
		ctx.listEl.appendChild(
			ctx.postFilter > 0
				? emptyState(
					'admin-comments',
					__( 'Nothing on this post here' ),
					__( 'This post has no comments in this view — try another tab.' ),
				)
				: emptyState(
					'admin-comments',
					__( 'No conversations yet' ),
					__( 'Comments in this view will show up here.' ),
				),
		);
		return;
	}
	ctx.threads.forEach( ( row ) => ctx.listEl.appendChild( threadItem( ctx, row ) ) );
	if ( ctx.page < ctx.totalPages ) {
		ctx.listEl.appendChild( loadMoreRow( ctx ) );
	}
}

/** Dim + freeze the selected rail row while its thread is mutating. */
function setRailBusy( ctx: Ctx, busy: boolean ): void {
	const row = ctx.listEl.querySelector< HTMLElement >(
		`.${ NS }__thread[data-id="${ ctx.selectedId }"]`,
	);
	row?.classList.toggle( 'is-busy', busy );
}

async function loadRail(
	ctx: Ctx,
	opts: { silent?: boolean; append?: boolean } = {},
): Promise< void > {
	// Sequence token: a slower earlier fetch (rapid tab switches, or a
	// debounced search landing after a tab click) must not overwrite the
	// rail with the wrong tab's rows.
	const seq = ++ctx.railSeq;
	const prevScroll = ctx.listEl.scrollTop;
	const page = opts.append ? ctx.page + 1 : 1;
	if ( ! opts.silent && ! opts.append ) {
		ctx.listEl.replaceChildren( loadingRow() );
	}
	try {
		const res = await fetchComments( ctx.cfg, {
			tab: ctx.tab,
			page,
			perPage: ctx.cfg.defaultPerPage || 20,
			search: ctx.search,
			currentUserId: ctx.cfg.currentUserId,
			post: ctx.postFilter || undefined,
			// The rail lists conversations, so ask the server for
			// top-level comments only. Client-filtering a mixed page
			// used to render an empty rail whenever a page happened to
			// contain nothing but replies.
			rootsOnly: true,
		} );
		if ( seq !== ctx.railSeq ) {
			return; // a newer load started; drop this stale response.
		}
		ctx.page = page;
		ctx.totalPages = Number.isFinite( res.totalPages ) ? res.totalPages : 1;
		ctx.threads = opts.append ? ctx.threads.concat( res.rows ) : res.rows;
		renderRail( ctx );
		if ( opts.silent || opts.append ) {
			ctx.listEl.scrollTop = prevScroll;
		}
		const stillThere = ctx.threads.some( ( r ) => r.id === ctx.selectedId );
		if ( ! stillThere ) {
			ctx.selectedId = null;
			if ( ctx.threads.length > 0 ) {
				selectThread( ctx, ctx.threads[ 0 ] );
			} else {
				showPlaceholder( ctx );
			}
		}
	} catch {
		if ( seq === ctx.railSeq ) {
			if ( opts.append ) {
				// Keep what's on screen; just re-offer the button.
				renderRail( ctx );
			} else {
				ctx.listEl.replaceChildren(
					emptyState(
						'warning',
						__( 'Could not load comments' ),
						__( 'Check your connection and try another tab.' ),
					),
				);
			}
		}
	}
}

/* -------------------------------------------------------------------------- */
/* Conversation pane                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The canonical "nothing selected / nothing here" shape.
 *
 * `<wpd-empty-state>` owns the icon + heading + description layout, so
 * every empty surface in the shell reads the same way.
 */
function emptyState(
	icon: string,
	heading: string,
	description = '',
): HTMLElement {
	const el = document.createElement( 'wpd-empty-state' );
	el.className = `${ NS }__placeholder`;
	el.setAttribute( 'icon', icon );
	el.setAttribute( 'heading', heading );
	if ( description ) {
		el.setAttribute( 'description', description );
	}
	return el;
}

function showPlaceholder( ctx: Ctx ): void {
	ctx.convoEl.replaceChildren(
		emptyState(
			'format-chat',
			__( 'No conversation selected' ),
			__( 'Pick one from the list to read and reply.' ),
		),
	);
}

function selectThread( ctx: Ctx, root: CommentRow ): void {
	// Re-picking the conversation that's already on screen is a no-op.
	// It used to re-fetch and repaint the whole thread, which threw away
	// scroll position, any half-written reply in the composer, and any
	// open inline editor — for a click that asked for nothing to change.
	// The `__thread-scroll` check keeps the click working as a retry
	// when the pane is showing the placeholder instead of a thread
	// (first paint, or a failed load).
	if (
		ctx.selectedId === root.id &&
		ctx.convoEl.querySelector( `.${ NS }__thread-scroll` )
	) {
		return;
	}
	ctx.selectedId = root.id;
	ctx.listEl
		.querySelectorAll( `.${ NS }__thread` )
		.forEach( ( el ) => {
			const on = ( el as HTMLElement ).dataset.id === String( root.id );
			el.classList.toggle( 'is-selected', on );
			if ( on ) {
				el.setAttribute( 'aria-current', 'true' );
			} else {
				el.removeAttribute( 'aria-current' );
			}
		} );
	void renderConvo( ctx, root );
}

async function renderConvo(
	ctx: Ctx,
	root: CommentRow,
	opts: { silent?: boolean } = {},
): Promise< void > {
	// Silent reloads (after an action) keep the current view on screen and
	// swap in the fresh tree in one shot — no "Loading…" flash, no lost
	// scroll position — so approving/replying doesn't make the pane blink.
	const prevScroll =
		ctx.convoEl.querySelector< HTMLElement >( `.${ NS }__thread-scroll` )?.scrollTop ?? 0;
	if ( ! opts.silent ) {
		ctx.convoEl.replaceChildren( loadingRow() );
	}

	let rows: CommentRow[] = [];
	try {
		rows = await fetchThread( ctx.cfg, root.post );
	} catch {
		rows = [ root ];
	}
	// Race guard: the user may have picked another thread meanwhile.
	if ( ctx.selectedId !== root.id ) {
		return;
	}

	const byParent = new Map< number, CommentRow[] >();
	rows.forEach( ( r ) => {
		const p = Number( r.parent ) || 0;
		const list = byParent.get( p ) ?? [];
		list.push( r );
		byParent.set( p, list );
	} );
	const rootRow = rows.find( ( r ) => r.id === root.id ) ?? root;

	const scroll = document.createElement( 'div' );
	scroll.className = `${ NS }__thread-scroll`;
	scroll.appendChild( renderMessage( ctx, rootRow, byParent ) );

	ctx.convoEl.replaceChildren(
		convoHead( rootRow ),
		scroll,
		composer( ctx, rootRow ),
	);
	scroll.scrollTop = prevScroll;
}

function convoHead( root: CommentRow ): HTMLElement {
	const head = document.createElement( 'div' );
	head.className = `${ NS }__convo-head`;
	const ctxBox = document.createElement( 'div' );
	ctxBox.className = `${ NS }__convo-context`;
	const kicker = document.createElement( 'div' );
	kicker.className = `${ NS }__convo-kicker`;
	kicker.textContent = __( 'In response to' );

	const title = decodeHTML( root.desktop_mode_post_title || __( '(no title)' ) );
	// The title IS the edit affordance — a same-origin wp-admin link with
	// no target, which the shell's link interceptor catches and mounts as
	// a window (the same path the Drafts widget uses); it does NOT
	// navigate away. The pencil beside it and the tooltip are the hint
	// that the title is clickable, so the action needs no separate button.
	let post: HTMLElement;
	if ( root.post > 0 ) {
		const link = document.createElement( 'a' );
		link.className = `${ NS }__convo-post ${ NS }__convo-post--editable`;
		link.href = `${ adminUrl() }post.php?post=${ root.post }&action=edit`;
		link.title = __( 'Edit this post' );
		link.append( document.createTextNode( title ) );
		const pencil = document.createElement( 'wpd-icon' );
		pencil.className = `${ NS }__convo-post-pencil`;
		pencil.setAttribute( 'name', 'edit' );
		pencil.setAttribute( 'size', '15' );
		link.appendChild( pencil );
		const hint = document.createElement( 'span' );
		hint.className = 'screen-reader-text';
		hint.textContent = __( 'Edit this post' );
		link.appendChild( hint );
		post = link;
	} else {
		post = document.createElement( 'div' );
		post.className = `${ NS }__convo-post`;
		post.textContent = title;
	}
	ctxBox.append( kicker, post );
	head.appendChild( ctxBox );

	const actions = document.createElement( 'div' );
	actions.className = `${ NS }__convo-head-actions`;
	if ( root.desktop_mode_post_link ) {
		const a = document.createElement( 'a' );
		a.className = `${ NS }__convo-link`;
		a.href = root.desktop_mode_post_link;
		a.target = '_blank';
		a.rel = 'noopener';
		a.append( document.createTextNode( __( 'View post' ) ), externalIcon() );
		// Every "opens elsewhere" link in wp-admin says so out loud.
		const newTab = document.createElement( 'span' );
		newTab.className = 'screen-reader-text';
		newTab.textContent = __( '(opens in a new tab)' );
		a.appendChild( newTab );
		actions.appendChild( a );
	}
	head.appendChild( actions );
	return head;
}

function renderMessage(
	ctx: Ctx,
	row: CommentRow,
	byParent: Map< number, CommentRow[] >,
): HTMLElement {
	const children = byParent.get( row.id ) ?? [];

	const msg = document.createElement( 'div' );
	msg.className = `${ NS }__msg`;
	msg.dataset.id = String( row.id );
	msg.dataset.status = normalizeStatus( row );

	const rail = document.createElement( 'div' );
	rail.className = `${ NS }__msg-rail`;
	rail.appendChild( avatar( row, 34 ) );
	if ( children.length > 0 ) {
		const line = document.createElement( 'div' );
		line.className = `${ NS }__msg-line`;
		rail.appendChild( line );
	}

	const bodyCol = document.createElement( 'div' );
	bodyCol.className = `${ NS }__msg-body`;

	const head = document.createElement( 'div' );
	head.className = `${ NS }__msg-head`;
	const name = document.createElement( 'span' );
	name.className = `${ NS }__msg-name`;
	name.textContent = row.author_name || __( 'Anonymous' );
	head.appendChild( name );
	if ( row.author > 0 && row.author === ctx.cfg.currentUserId ) {
		const you = document.createElement( 'wpd-badge' );
		you.className = `${ NS }__msg-you`;
		you.setAttribute( 'tone', 'info' );
		you.setAttribute( 'no-dot', '' );
		you.textContent = __( 'You' );
		head.appendChild( you );
	}
	const time = timestamp( row.date_gmt );
	time.className = `${ NS }__msg-time`;
	head.appendChild( time );
	// A pending / spam / trashed message in the middle of an otherwise
	// approved thread needs to say so — the tint alone doesn't.
	const status = normalizeStatus( row );
	if ( status !== 'approved' ) {
		head.appendChild( statusBadge( status ) );
	}

	const text = document.createElement( 'div' );
	text.className = `${ NS }__msg-text`;
	text.innerHTML = row.content?.rendered ?? '';

	bodyCol.append( head, text, messageActions( ctx, row ) );

	if ( children.length > 0 ) {
		const nested = document.createElement( 'div' );
		nested.className = `${ NS }__nested`;
		children.forEach( ( child ) =>
			nested.appendChild( renderMessage( ctx, child, byParent ) ),
		);
		bodyCol.appendChild( nested );
	}

	msg.append( rail, bodyCol );
	return msg;
}

function messageActions( ctx: Ctx, row: CommentRow ): HTMLElement {
	const actions = document.createElement( 'div' );
	actions.className = `${ NS }__msg-actions`;
	const status = normalizeStatus( row );

	// Order mirrors wp-admin's comment row actions: the moderation verb
	// first, then the authoring verbs, then the two destructive ones.
	const items: HTMLElement[] = [];
	if ( row.desktop_mode_can_moderate ) {
		const approveLabel = status === 'approved' ? __( 'Unapprove' ) : __( 'Approve' );
		const approveAction: BulkAction = status === 'approved' ? 'unapprove' : 'approve';
		items.push(
			actionButton( approveLabel, 'default', ( button ) =>
				void moderate( ctx, row.id, approveAction, button ),
			),
		);
	}
	// Replying posts a comment — gate on the same cap the reply route
	// enforces, so the action isn't offered to someone it will 403.
	if ( ctx.cfg.canModerate ) {
		items.push(
			actionButton( __( 'Reply' ), 'default', () => openComposerFor( ctx, row ) ),
		);
	}
	if ( row.desktop_mode_can_edit ) {
		items.push(
			actionButton( __( 'Edit' ), 'default', () => openInlineEdit( ctx, row ) ),
		);
	}
	if ( row.desktop_mode_can_moderate ) {
		if ( status !== 'spam' ) {
			items.push(
				actionButton( __( 'Spam' ), 'danger', ( button ) =>
					void moderate( ctx, row.id, 'spam', button ),
				),
			);
		}
		if ( status !== 'trash' ) {
			items.push(
				actionButton( __( 'Trash' ), 'danger', ( button ) =>
					void moderate( ctx, row.id, 'trash', button ),
				),
			);
		}
	}

	// Interleave the wp-admin pipe separators as real nodes. A CSS
	// `::before` on the action itself would be unreliable here — every
	// `<wpd-button>` is a shadow host, and generated content on a shadow
	// host is at the mercy of flat-tree slotting. Building them means
	// they land between whichever actions this viewer actually got, with
	// no separator dangling at either end.
	items.forEach( ( item, index ) => {
		if ( index > 0 ) {
			const sep = document.createElement( 'span' );
			sep.className = `${ NS }__act-sep`;
			sep.setAttribute( 'aria-hidden', 'true' );
			sep.textContent = '|';
			actions.appendChild( sep );
		}
		actions.appendChild( item );
	} );
	return actions;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

function toast( message: string ): void {
	const api = ( window as unknown as {
		wp?: { desktop?: { showToast?: ( o: { message: string } ) => void } };
	} ).wp?.desktop;
	if ( api?.showToast ) {
		api.showToast( { message } );
	}
}

/**
 * Confirmation copy for the two actions that take a comment out of the
 * conversation. Both are reversible from their own tab, so the prompt
 * says where it went rather than warning about permanence.
 */
const DESTRUCTIVE: Partial<
	Record< BulkAction, { title: string; message: string; confirmLabel: string } >
> = {
	spam: {
		title: __( 'Mark as spam?' ),
		message: __(
			'This comment moves out of the conversation. You can restore it from the Spam tab.',
		),
		confirmLabel: __( 'Mark as spam' ),
	},
	trash: {
		title: __( 'Move to trash?' ),
		message: __(
			'This comment moves out of the conversation. You can restore it from the Trash tab.',
		),
		confirmLabel: __( 'Move to trash' ),
	},
};

/** Past-tense confirmation for the live region + toast. */
function actionResultLabel( action: BulkAction ): string {
	switch ( action ) {
		case 'approve':
			return __( 'Comment approved.' );
		case 'unapprove':
			return __( 'Comment unapproved.' );
		case 'spam':
			return __( 'Comment marked as spam.' );
		case 'unspam':
			return __( 'Comment restored from spam.' );
		case 'trash':
			return __( 'Comment moved to trash.' );
		case 'untrash':
			return __( 'Comment restored from trash.' );
	}
}

async function moderate(
	ctx: Ctx,
	id: number,
	action: BulkAction,
	button?: HTMLElement,
): Promise< void > {
	const prompt = DESTRUCTIVE[ action ];
	if ( prompt && ! ( await wpdConfirm( { ...prompt, danger: true } ) ) ) {
		return;
	}
	button?.setAttribute( 'busy', '' );
	button?.setAttribute( 'disabled', '' );
	setRailBusy( ctx, true );
	try {
		await bulkModerate( ctx.cfg, [ id ], action );
		ctx.announce( actionResultLabel( action ) );
		// Thread and rail are independent reads — no reason to serialize
		// them behind one another.
		await Promise.all( [ ctx.reloadConvo(), ctx.reloadRail() ] );
		void refreshCounts( ctx );
	} catch {
		toast( __( 'Action failed.' ) );
		button?.removeAttribute( 'busy' );
		button?.removeAttribute( 'disabled' );
	} finally {
		setRailBusy( ctx, false );
	}
}

function composer( ctx: Ctx, target: CommentRow ): HTMLElement {
	const box = document.createElement( 'div' );
	box.className = `${ NS }__composer`;
	box.dataset.target = String( target.id );

	if ( ! ctx.cfg.canModerate ) {
		// Nothing to compose with — the reply route would reject it.
		box.classList.add( 'is-empty' );
		return box;
	}

	const to = document.createElement( 'div' );
	to.className = `${ NS }__composer-to`;
	const b = document.createElement( 'b' );
	b.textContent = target.author_name || __( 'Anonymous' );
	to.append( document.createTextNode( __( 'Replying to' ) + ' ' ), b );

	const send = document.createElement( 'wpd-button' );
	send.setAttribute( 'variant', 'primary' );
	send.textContent = __( 'Send reply' );

	const submit = async (): Promise< void > => {
		if ( send.hasAttribute( 'disabled' ) ) {
			return;
		}
		const value = editor.getValue();
		if ( ! value ) {
			toast( __( 'Reply is empty.' ) );
			return;
		}
		send.setAttribute( 'disabled', '' );
		send.setAttribute( 'busy', '' );
		editor.setDisabled( true );
		try {
			const targetId = Number( box.dataset.target ) || target.id;
			await postReply( ctx.cfg, targetId, value );
			editor.setValue( '' );
			ctx.announce( __( 'Reply sent.' ) );
			await Promise.all( [ ctx.reloadConvo(), ctx.reloadRail() ] );
			void refreshCounts( ctx );
		} catch {
			toast( __( 'Reply failed.' ) );
		} finally {
			// Always restore the control. The success path usually
			// replaces this whole composer, but `renderConvo`'s race
			// guard can bail out (the user picked another thread mid
			// flight) and leave this one on screen — permanently
			// disabled if the reset lived on the error path alone.
			send.removeAttribute( 'disabled' );
			send.removeAttribute( 'busy' );
			editor.setDisabled( false );
		}
	};

	const editor = mountEditor( {
		placeholder: __( 'Write a reply…' ),
		ariaLabel: __( 'Reply' ),
		submitOnEnter: true,
		onSubmit: () => void submit(),
	} );

	send.addEventListener( 'click', () => void submit() );

	const row = document.createElement( 'div' );
	row.className = `${ NS }__composer-row`;
	const hint = document.createElement( 'span' );
	hint.className = `${ NS }__composer-hint`;
	hint.textContent = __( 'Enter to send · Shift+Enter for a new line' );
	row.append( hint, send );

	box.append( to, editor.root, row );
	// Retarget helper: the per-message Reply button repoints this composer.
	( box as unknown as { __retarget?: ( r: CommentRow ) => void } ).__retarget = (
		r: CommentRow,
	) => {
		box.dataset.target = String( r.id );
		b.textContent = r.author_name || __( 'Anonymous' );
		editor.focus();
	};
	return box;
}

function openComposerFor( ctx: Ctx, target: CommentRow ): void {
	const box = ctx.convoEl.querySelector< HTMLElement >( `.${ NS }__composer` );
	const retarget = box
		? ( box as unknown as { __retarget?: ( r: CommentRow ) => void } ).__retarget
		: undefined;
	if ( retarget ) {
		retarget( target );
		box?.scrollIntoView( { block: 'nearest', behavior: 'smooth' } );
	}
}

function openInlineEdit( ctx: Ctx, row: CommentRow ): void {
	const msg = ctx.convoEl.querySelector< HTMLElement >(
		`.${ NS }__msg[data-id="${ row.id }"]`,
	);
	const text = msg?.querySelector< HTMLElement >( `.${ NS }__msg-text` );
	const actions = msg?.querySelector< HTMLElement >( `.${ NS }__msg-actions` );
	if ( ! text || ! actions || ! msg ) {
		return;
	}
	// Re-entrancy guard: a second Edit click used to stack a second
	// editor and a second button bar onto the same message, and Cancel
	// only ever tore one of them down. The `:scope >` chain keeps this
	// from matching an editor open on a NESTED reply.
	if ( msg.querySelector( `:scope > .${ NS }__msg-body > .${ NS }__edit-bar` ) ) {
		type FocusableEditor = HTMLElement & { focusInput?: () => void };
		const selector = `:scope > .${ NS }__msg-body > .${ NS }__reply-input`;
		const open = msg.querySelector< FocusableEditor >( selector );
		open?.focusInput?.();
		return;
	}

	const seed = row.content?.raw ?? decodeHTML( ( row.content?.rendered ?? '' ).replace( /<[^>]*>/g, '' ) );
	const editor = mountEditor( {
		placeholder: __( 'Edit comment…' ),
		ariaLabel: __( 'Comment text' ),
		initial: seed,
		rows: 4,
	} );
	text.hidden = true;
	actions.hidden = true;

	const bar = document.createElement( 'div' );
	bar.className = `${ NS }__composer-row ${ NS }__edit-bar`;
	const cancel = document.createElement( 'wpd-button' );
	cancel.setAttribute( 'variant', 'ghost' );
	cancel.textContent = __( 'Cancel' );
	const save = document.createElement( 'wpd-button' );
	save.setAttribute( 'variant', 'primary' );
	save.textContent = __( 'Save' );

	const teardown = (): void => {
		editor.root.remove();
		bar.remove();
		text.hidden = false;
		actions.hidden = false;
	};
	cancel.addEventListener( 'click', teardown );
	save.addEventListener( 'click', async () => {
		if ( save.hasAttribute( 'disabled' ) ) {
			return;
		}
		const value = editor.getValue();
		if ( ! value ) {
			toast( __( 'A comment cannot be empty.' ) );
			return;
		}
		save.setAttribute( 'disabled', '' );
		save.setAttribute( 'busy', '' );
		editor.setDisabled( true );
		try {
			await updateCommentContent( ctx.cfg, row.id, value );
			ctx.announce( __( 'Comment updated.' ) );
			await Promise.all( [ ctx.reloadConvo(), ctx.reloadRail() ] );
		} catch {
			toast( __( 'Edit failed.' ) );
		} finally {
			// Same reasoning as the composer: the redraw normally
			// disposes of this bar, but it must not be able to strand
			// the user with dead controls when it doesn't.
			save.removeAttribute( 'disabled' );
			save.removeAttribute( 'busy' );
			editor.setDisabled( false );
		}
	} );
	bar.append( cancel, save );
	actions.after( editor.root, bar );
	editor.focus();
}

/* -------------------------------------------------------------------------- */
/* Entry                                                                      */
/* -------------------------------------------------------------------------- */

export async function renderConversation( body: HTMLElement ): Promise< void > {
	const cfg = readConfig();
	if ( ! cfg ) {
		const fatal = document.createElement( 'p' );
		fatal.className = `${ NS }__fatal`;
		fatal.textContent = __( 'Comments window configuration missing.' );
		body.replaceChildren( fatal );
		return;
	}
	setActiveWindowId( 'desktop-mode-comments' );
	setActiveConfig( cfg );

	const listEl = body.querySelector< HTMLElement >( '[data-desktop-mode-comments-list]' );
	const convoEl = body.querySelector< HTMLElement >( '[data-desktop-mode-comments-convo]' );
	const tabsEl = body.querySelector< HTMLElement >( '[data-desktop-mode-comments-tabs]' );
	if ( ! listEl || ! convoEl || ! tabsEl ) {
		return;
	}
	const searchEl = body.querySelector< HTMLElement >( '[data-desktop-mode-comments-search]' );
	const statusEl = body.querySelector< HTMLElement >( '[data-desktop-mode-comments-status]' );

	// A pending `edit-comments.php?p=<id>` open scopes the rail to that
	// post; a filtered open starts on "All" so the post's whole thread is
	// visible, not just its pending comments.
	const initialFilter = takeCommentsPostFilter();

	const ctx: Ctx = {
		cfg,
		listEl,
		convoEl,
		tabsEl,
		statusEl,
		tab: initialFilter > 0 ? 'all' : 'pending',
		search: '',
		threads: [],
		selectedId: null,
		postFilter: initialFilter,
		page: 1,
		totalPages: 1,
		railSeq: 0,
		announceIdentity: ( postId: number ) =>
			announcePostIdentity( body, postId, ctx.threads[ 0 ]?.desktop_mode_post_title ),
		announce: ( message: string ) => {
			if ( statusEl ) {
				statusEl.textContent = message;
			}
		},
		reloadRail: async () => loadRail( ctx, { silent: true } ),
		reloadConvo: async () => {
			const sel = ctx.threads.find( ( r ) => r.id === ctx.selectedId );
			if ( sel ) {
				await renderConvo( ctx, sel, { silent: true } );
			}
		},
	};

	showPlaceholder( ctx );

	// Tabs — `<wpd-tabs>` owns aria-selected + roving tabindex; we only
	// set the initial value (a filtered open starts on All) and listen.
	setActiveTab( tabsEl, ctx.tab );
	tabsEl.addEventListener( 'wpd-tab-change', ( e ) => {
		const next = ( ( e as CustomEvent< { value: string } > ).detail?.value ||
			'pending' ) as CommentTab;
		if ( next === ctx.tab ) {
			return;
		}
		ctx.tab = next;
		void loadRail( ctx );
	} );

	// Search (debounced)
	let searchTimer: number | null = null;
	searchEl?.addEventListener( 'wpd-input-change', ( e ) => {
		const value = ( e as CustomEvent ).detail?.value ?? '';
		if ( searchTimer ) {
			window.clearTimeout( searchTimer );
		}
		searchTimer = window.setTimeout( () => {
			ctx.search = String( value );
			void loadRail( ctx );
		}, 300 );
	} );

	// React to a filter change while already open — native windows render
	// once, so a fresh `edit-comments.php?p=` open on an existing window
	// must re-scope here. Self-detaches when the window is gone.
	const unsubscribe = subscribeCommentsPostFilter( () => {
		if ( ! ctx.listEl.isConnected ) {
			unsubscribe();
			return;
		}
		const next = takeCommentsPostFilter();
		if ( next === ctx.postFilter ) {
			return;
		}
		ctx.postFilter = next;
		if ( next > 0 ) {
			ctx.tab = 'all';
			setActiveTab( tabsEl, 'all' );
		}
		void loadRail( ctx ).then( () => ctx.announceIdentity( ctx.postFilter ) );
	} );

	// Proactively drop the shared-store subscription when this window
	// closes, so repeated open/close cycles don't leak stale closures
	// (the in-callback isConnected check is only a lazy backstop).
	const myWindowId = body
		.closest< HTMLElement >( '[id^="wp-window-"]' )
		?.id.slice( 'wp-window-'.length );
	const onWindowClosed = ( e: Event ): void => {
		if ( ( e as CustomEvent ).detail?.windowId === myWindowId ) {
			if ( searchTimer ) {
				window.clearTimeout( searchTimer );
			}
			unsubscribe();
			document.removeEventListener( 'desktop-mode-window-closed', onWindowClosed );
		}
	};
	document.addEventListener( 'desktop-mode-window-closed', onWindowClosed );

	void refreshCounts( ctx );
	await loadRail( ctx );

	// Scoped to a post → announce identity so the connection spline to
	// the post's editor is drawn (parity with the classic iframe).
	if ( ctx.postFilter > 0 ) {
		ctx.announceIdentity( ctx.postFilter );
	}
}
