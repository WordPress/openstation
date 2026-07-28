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
	fetchThread,
	bulkModerate,
	postReply,
	updateCommentContent,
	setActiveConfig,
	setActiveWindowId,
} from './rest';
import type {
	BulkAction,
	CommentRow,
	CommentTab,
	CommentsConfig,
} from './types';
import {
	takeCommentsPostFilter,
	clearCommentsPostFilter,
	subscribeCommentsPostFilter,
} from './post-filter';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-text-field/wpd-text-field';

const NS = 'desktop-mode-comments';

interface Ctx {
	cfg: CommentsConfig;
	listEl: HTMLElement;
	convoEl: HTMLElement;
	tab: CommentTab;
	search: string;
	threads: CommentRow[];
	selectedId: number | null;
	/** When > 0, the rail is scoped to this post (edit-comments.php?p=). */
	postFilter: number;
	/** Monotonic token so a stale rail fetch can't overwrite a newer one. */
	railSeq: number;
	/** Announce (postId>0) or clear (0) the window-links identity. */
	announceIdentity: ( postId: number ) => void;
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

/** Deterministic hue so each author keeps a stable avatar tint. */
function hueFor( name: string ): number {
	let h = 0;
	for ( let i = 0; i < name.length; i++ ) {
		h = ( h * 31 + name.charCodeAt( i ) ) % 360;
	}
	return h;
}

function initialOf( name: string ): string {
	const trimmed = ( name || '' ).trim();
	return trimmed ? trimmed[ 0 ].toUpperCase() : '?';
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

function timeAgo( gmt: string ): string {
	const then = new Date( gmt + 'Z' ).getTime();
	if ( Number.isNaN( then ) ) {
		return '';
	}
	const secs = Math.max( 0, Math.round( ( Date.now() - then ) / 1000 ) );
	if ( secs < 60 ) {
		return __( 'now' );
	}
	const mins = Math.round( secs / 60 );
	if ( mins < 60 ) {
		/* translators: %d: minutes ago (compact). */
		return sprintf( __( '%dm' ), mins );
	}
	const hours = Math.round( mins / 60 );
	if ( hours < 24 ) {
		/* translators: %d: hours ago (compact). */
		return sprintf( __( '%dh' ), hours );
	}
	const days = Math.round( hours / 24 );
	if ( days < 7 ) {
		/* translators: %d: days ago (compact). */
		return sprintf( __( '%dd' ), days );
	}
	return new Date( gmt + 'Z' ).toLocaleDateString();
}

function snippet( row: CommentRow ): string {
	const raw = row.content?.rendered ?? row.content?.raw ?? '';
	const text = decodeHTML( raw.replace( /<[^>]*>/g, ' ' ) ).replace( /\s+/g, ' ' ).trim();
	return text;
}

/** A round avatar disc: real gravatar if present, tinted initial otherwise. */
function disc( row: CommentRow ): HTMLElement {
	const el = document.createElement( 'span' );
	el.className = `${ NS }__disc`;
	el.style.setProperty( '--disc-h', String( hueFor( row.author_name || '?' ) ) );
	el.textContent = initialOf( row.author_name );
	const url =
		row.author_avatar_urls?.[ '48' ] ??
		row.author_avatar_urls?.[ '96' ] ??
		row.author_avatar_urls?.[ '24' ] ??
		'';
	if ( url ) {
		const img = document.createElement( 'img' );
		img.alt = '';
		applyAvatarSrc( img, url );
		el.textContent = '';
		el.appendChild( img );
	}
	return el;
}

function iconButton(
	label: string,
	dashicon: string,
	variant: '' | 'is-primary' | 'is-danger',
	onClick: () => void,
): HTMLButtonElement {
	const b = document.createElement( 'button' );
	b.type = 'button';
	b.className = `${ NS }__act${ variant ? ' ' + variant : '' }`;
	b.innerHTML = `<span class="dashicons ${ dashicon }" aria-hidden="true"></span>`;
	b.append( document.createTextNode( label ) );
	b.setAttribute( 'aria-label', label );
	b.addEventListener( 'click', ( e ) => {
		e.stopPropagation();
		onClick();
	} );
	return b;
}

/** Mark one tab active — toggles both the class and `aria-selected`. */
function setActiveTab( tabrowEl: HTMLElement, tabValue: string ): void {
	tabrowEl.querySelectorAll< HTMLElement >( `.${ NS }__tab` ).forEach( ( t ) => {
		const on = t.dataset.tab === tabValue;
		t.classList.toggle( 'is-active', on );
		t.setAttribute( 'aria-selected', on ? 'true' : 'false' );
	} );
}

/* -------------------------------------------------------------------------- */
/* Rail                                                                       */
/* -------------------------------------------------------------------------- */

function threadItem( ctx: Ctx, row: CommentRow ): HTMLElement {
	const item = document.createElement( 'button' );
	item.type = 'button';
	item.className = `${ NS }__thread`;
	item.setAttribute( 'role', 'option' );
	item.dataset.id = String( row.id );
	if ( ctx.selectedId === row.id ) {
		item.classList.add( 'is-selected' );
		item.setAttribute( 'aria-selected', 'true' );
	}

	const main = document.createElement( 'div' );
	main.className = `${ NS }__thread-main`;
	const name = document.createElement( 'div' );
	name.className = `${ NS }__thread-name`;
	name.textContent = row.author_name || __( 'Anonymous' );
	const status = document.createElement( 'span' );
	status.className = `${ NS }__status`;
	status.dataset.status = normalizeStatus( row );
	status.title = normalizeStatus( row );
	name.appendChild( status );
	const snip = document.createElement( 'div' );
	snip.className = `${ NS }__thread-snip`;
	snip.textContent = snippet( row );
	const post = document.createElement( 'div' );
	post.className = `${ NS }__thread-post`;
	post.textContent = decodeHTML( row.desktop_mode_post_title || '' );
	main.append( name, snip, post );

	const meta = document.createElement( 'div' );
	meta.className = `${ NS }__thread-meta`;
	const time = document.createElement( 'span' );
	time.className = `${ NS }__thread-time`;
	time.textContent = timeAgo( row.date_gmt );
	meta.appendChild( time );
	if ( row.desktop_mode_replies_count > 0 ) {
		const rc = document.createElement( 'span' );
		rc.className = `${ NS }__reply-count`;
		/* translators: %d: number of direct replies. */
		rc.textContent = sprintf( __( '%d ↩' ), row.desktop_mode_replies_count );
		meta.appendChild( rc );
	}

	item.append( disc( row ), main, meta );
	item.addEventListener( 'click', () => selectThread( ctx, row ) );
	return item;
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
	const clear = document.createElement( 'button' );
	clear.type = 'button';
	clear.className = `${ NS }__rail-filter-clear`;
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

function renderRail( ctx: Ctx ): void {
	ctx.listEl.replaceChildren();
	if ( ctx.postFilter > 0 ) {
		ctx.listEl.appendChild( filterBanner( ctx ) );
	}
	if ( ctx.threads.length === 0 ) {
		const empty = document.createElement( 'div' );
		empty.className = `${ NS }__list-empty`;
		empty.textContent =
			ctx.postFilter > 0
				? __( 'No comments on this post in this view — try another tab.' )
				: __( 'No conversations here yet.' );
		ctx.listEl.appendChild( empty );
		return;
	}
	ctx.threads.forEach( ( row ) => ctx.listEl.appendChild( threadItem( ctx, row ) ) );
}

async function loadRail( ctx: Ctx, opts: { silent?: boolean } = {} ): Promise< void > {
	// Sequence token: a slower earlier fetch (rapid tab switches, or a
	// debounced search landing after a tab click) must not overwrite the
	// rail with the wrong tab's rows.
	const seq = ++ctx.railSeq;
	const prevScroll = ctx.listEl.scrollTop;
	if ( ! opts.silent ) {
		ctx.listEl.innerHTML = `<div class="${ NS }__list-loading">${ __( 'Loading…' ) }</div>`;
	}
	try {
		const res = await fetchComments( ctx.cfg, {
			tab: ctx.tab,
			page: 1,
			perPage: ctx.cfg.defaultPerPage || 20,
			search: ctx.search,
			currentUserId: ctx.cfg.currentUserId,
			post: ctx.postFilter || undefined,
		} );
		if ( seq !== ctx.railSeq ) {
			return; // a newer load started; drop this stale response.
		}
		// The rail lists conversations, i.e. top-level comments only;
		// replies surface inside the thread on the right, not as their
		// own rows. (`wp/v2/comments` returns every depth flat.)
		ctx.threads = res.rows.filter( ( r ) => ( Number( r.parent ) || 0 ) === 0 );
		renderRail( ctx );
		if ( opts.silent ) {
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
			ctx.listEl.innerHTML = `<div class="${ NS }__list-empty">${ __( 'Could not load comments.' ) }</div>`;
		}
	}
}

/* -------------------------------------------------------------------------- */
/* Conversation pane                                                          */
/* -------------------------------------------------------------------------- */

function showPlaceholder( ctx: Ctx ): void {
	ctx.convoEl.replaceChildren();
	const ph = document.createElement( 'div' );
	ph.className = `${ NS }__placeholder`;
	ph.innerHTML = `<span class="dashicons dashicons-format-chat" aria-hidden="true"></span><p>${ __(
		'Select a conversation to read and reply.',
	) }</p>`;
	ctx.convoEl.appendChild( ph );
}

function selectThread( ctx: Ctx, root: CommentRow ): void {
	ctx.selectedId = root.id;
	ctx.listEl
		.querySelectorAll( `.${ NS }__thread` )
		.forEach( ( el ) => {
			const on = ( el as HTMLElement ).dataset.id === String( root.id );
			el.classList.toggle( 'is-selected', on );
			if ( on ) {
				el.setAttribute( 'aria-selected', 'true' );
			} else {
				el.removeAttribute( 'aria-selected' );
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
		const loading = document.createElement( 'div' );
		loading.className = `${ NS }__placeholder`;
		loading.textContent = __( 'Loading…' );
		ctx.convoEl.replaceChildren( loading );
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
	const kicker = document.createElement( 'div' );
	kicker.className = `${ NS }__convo-kicker`;
	kicker.textContent = __( 'In response to' );
	const post = document.createElement( 'div' );
	post.className = `${ NS }__convo-post`;
	post.textContent = decodeHTML( root.desktop_mode_post_title || __( '(no title)' ) );
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
		a.textContent = __( 'View post ↗' );
		actions.appendChild( a );
	}
	// Pencil → open the post's block editor as a window inside Desktop
	// Mode. A same-origin wp-admin link with no target is caught by the
	// shell's link interceptor and mounted as a chromeless window (the
	// same path the Drafts widget uses); it does NOT navigate away.
	if ( root.post > 0 ) {
		const edit = document.createElement( 'a' );
		edit.className = `${ NS }__convo-edit`;
		edit.href = `${ adminUrl() }post.php?post=${ root.post }&action=edit`;
		edit.title = __( 'Edit post' );
		edit.setAttribute( 'aria-label', __( 'Edit post' ) );
		edit.innerHTML = '<span class="dashicons dashicons-edit" aria-hidden="true"></span>';
		actions.appendChild( edit );
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

	const rail = document.createElement( 'div' );
	rail.className = `${ NS }__msg-rail`;
	rail.appendChild( disc( row ) );
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
		const you = document.createElement( 'span' );
		you.className = `${ NS }__msg-you`;
		you.textContent = __( 'You' );
		head.appendChild( you );
	}
	const time = document.createElement( 'span' );
	time.className = `${ NS }__msg-time`;
	try {
		time.textContent = new Date( row.date_gmt + 'Z' ).toLocaleString();
	} catch {
		time.textContent = row.date_gmt;
	}
	head.appendChild( time );

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

	actions.appendChild(
		iconButton( __( 'Reply' ), 'dashicons-undo', 'is-primary', () =>
			openComposerFor( ctx, row ),
		),
	);
	if ( row.desktop_mode_can_edit ) {
		actions.appendChild(
			iconButton( __( 'Edit' ), 'dashicons-edit', '', () =>
				openInlineEdit( ctx, row ),
			),
		);
	}
	if ( row.desktop_mode_can_moderate ) {
		const approveLabel = status === 'approved' ? __( 'Unapprove' ) : __( 'Approve' );
		const approveAction: BulkAction = status === 'approved' ? 'unapprove' : 'approve';
		actions.appendChild(
			iconButton( approveLabel, 'dashicons-yes', '', () =>
				moderate( ctx, row.id, approveAction ),
			),
		);
		if ( status !== 'spam' ) {
			actions.appendChild(
				iconButton( __( 'Spam' ), 'dashicons-warning', 'is-danger', () =>
					moderate( ctx, row.id, 'spam' ),
				),
			);
		}
		actions.appendChild(
			iconButton( __( 'Trash' ), 'dashicons-trash', 'is-danger', () =>
				moderate( ctx, row.id, 'trash' ),
			),
		);
	}
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

async function moderate( ctx: Ctx, id: number, action: BulkAction ): Promise< void > {
	try {
		await bulkModerate( ctx.cfg, [ id ], action );
		await ctx.reloadConvo();
		await ctx.reloadRail();
	} catch {
		toast( __( 'Action failed.' ) );
	}
}

/** A minimal reply/edit editor reusing the window's existing input styles. */
function mountEditor( placeholder: string, initial = '' ): {
	root: HTMLElement;
	getValue: () => string;
	focus: () => void;
} {
	const wrap = document.createElement( 'div' );
	wrap.className = `${ NS }__reply ${ NS }__reply--plain`;
	const ta = document.createElement( 'textarea' );
	ta.className = `${ NS }__reply-input`;
	ta.rows = 3;
	ta.placeholder = placeholder;
	ta.value = initial;
	wrap.appendChild( ta );
	return {
		root: wrap,
		getValue: () => ta.value.trim(),
		focus: () => ta.focus(),
	};
}

function composer( ctx: Ctx, target: CommentRow ): HTMLElement {
	const box = document.createElement( 'div' );
	box.className = `${ NS }__composer`;
	box.dataset.target = String( target.id );

	const to = document.createElement( 'div' );
	to.className = `${ NS }__composer-to`;
	const b = document.createElement( 'b' );
	b.textContent = target.author_name || __( 'Anonymous' );
	to.append( document.createTextNode( __( 'Replying to' ) + ' ' ), b );

	const editor = mountEditor( __( 'Write a reply…' ) );

	const row = document.createElement( 'div' );
	row.className = `${ NS }__composer-row`;
	const send = document.createElement( 'wpd-button' );
	send.setAttribute( 'variant', 'primary' );
	send.textContent = __( 'Send reply' );
	send.addEventListener( 'click', async () => {
		const value = editor.getValue();
		if ( ! value ) {
			toast( __( 'Reply is empty.' ) );
			return;
		}
		send.setAttribute( 'disabled', '' );
		try {
			const targetId = Number( box.dataset.target ) || target.id;
			await postReply( ctx.cfg, targetId, value );
			await ctx.reloadConvo();
			await ctx.reloadRail();
		} catch {
			toast( __( 'Reply failed.' ) );
			send.removeAttribute( 'disabled' );
		}
	} );
	row.appendChild( send );

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
	if ( ! text || ! actions ) {
		return;
	}
	const seed = row.content?.raw ?? decodeHTML( ( row.content?.rendered ?? '' ).replace( /<[^>]*>/g, '' ) );
	const editor = mountEditor( __( 'Edit comment…' ), seed );
	text.hidden = true;
	actions.hidden = true;

	const bar = document.createElement( 'div' );
	bar.className = `${ NS }__composer-row`;
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
		const value = editor.getValue();
		if ( ! value ) {
			return;
		}
		save.setAttribute( 'disabled', '' );
		try {
			await updateCommentContent( ctx.cfg, row.id, value );
			await ctx.reloadConvo();
			await ctx.reloadRail();
		} catch {
			toast( __( 'Edit failed.' ) );
			save.removeAttribute( 'disabled' );
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
		body.innerHTML = `<p class="${ NS }__fatal">${ __(
			'Comments window configuration missing.',
		) }</p>`;
		return;
	}
	setActiveWindowId( 'desktop-mode-comments' );
	setActiveConfig( cfg );

	const listEl = body.querySelector< HTMLElement >( '[data-desktop-mode-comments-list]' );
	const convoEl = body.querySelector< HTMLElement >( '[data-desktop-mode-comments-convo]' );
	const tabrowEl = body.querySelector< HTMLElement >( '[data-desktop-mode-comments-tabs]' );
	if ( ! listEl || ! convoEl || ! tabrowEl ) {
		return;
	}
	const searchEl = body.querySelector< HTMLElement >( '[data-desktop-mode-comments-search]' );

	// A pending `edit-comments.php?p=<id>` open scopes the rail to that
	// post; a filtered open starts on "All" so the post's whole thread is
	// visible, not just its pending comments.
	const initialFilter = takeCommentsPostFilter();

	const ctx: Ctx = {
		cfg,
		listEl,
		convoEl,
		tab: initialFilter > 0 ? 'all' : 'pending',
		search: '',
		threads: [],
		selectedId: null,
		postFilter: initialFilter,
		railSeq: 0,
		announceIdentity: ( postId: number ) =>
			announcePostIdentity( body, postId, ctx.threads[ 0 ]?.desktop_mode_post_title ),
		reloadRail: async () => loadRail( ctx, { silent: true } ),
		reloadConvo: async () => {
			const sel = ctx.threads.find( ( r ) => r.id === ctx.selectedId );
			if ( sel ) {
				await renderConvo( ctx, sel, { silent: true } );
			}
		},
	};

	// Tabs — sync the active chip to ctx.tab (a filtered open starts on All).
	setActiveTab( tabrowEl, ctx.tab );
	tabrowEl.querySelectorAll< HTMLElement >( `.${ NS }__tab` ).forEach( ( tabEl ) => {
		tabEl.addEventListener( 'click', () => {
			const next = ( tabEl.dataset.tab || 'pending' ) as CommentTab;
			if ( next === ctx.tab ) {
				return;
			}
			ctx.tab = next;
			setActiveTab( tabrowEl, next );
			void loadRail( ctx );
		} );
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
			setActiveTab( tabrowEl, 'all' );
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
			unsubscribe();
			document.removeEventListener( 'desktop-mode-window-closed', onWindowClosed );
		}
	};
	document.addEventListener( 'desktop-mode-window-closed', onWindowClosed );

	await loadRail( ctx );

	// Scoped to a post → announce identity so the connection spline to
	// the post's editor is drawn (parity with the classic iframe).
	if ( ctx.postFilter > 0 ) {
		ctx.announceIdentity( ctx.postFilter );
	}
}
