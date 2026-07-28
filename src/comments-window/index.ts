/**
 * Native Comments window — render entry point.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-comments` window opens. Wires up Pending/All/Spam/
 * Trash/Mine tabs, populates a `<wpd-table>` from `wp/v2/comments`
 * with server-side pagination, exposes bulk approve/spam/trash with
 * an 8-second undo toast, opens an inline reply editor on demand,
 * paints a spam-confidence chip per row, surfaces an author-insights
 * drawer on avatar click, paints a realtime "N new" pill at the top
 * of Pending when heartbeat reports growth, and publishes activity
 * events on `desktop-mode-comments/*` for plugins / widgets / dock
 * badge updates.
 *
 * Web-component registrations: the main `desktop.min.js` ships only
 * the `<wpd-*>` tags it constructs itself. This bundle leaf-imports
 * the additional ones it needs (`<wpd-table>`, `<wpd-avatar>`,
 * `<wpd-chip>`). `defineComponent()` is idempotent.
 *
 * @public
 */

import { __, _n, sprintf } from '../i18n';
import { trackedFetch } from '../tracked-fetch';
import { applyAvatarSrc } from '../ui/util/avatar-resolve';
// Side-effect imports — register the `<wpd-*>` components this
// bundle constructs that the main shell does not ship.
import '../ui/components/wpd-table/wpd-table';
import '../ui/components/wpd-avatar/wpd-avatar';
import '../ui/components/wpd-chip/wpd-chip';
// `<wpd-tabs>` (Pending/All/Spam/Trash/Mine) is emitted by
// `includes/comments-window/window.php`, never built via
// `document.createElement` here — so the lint rule that scans
// `createElement('wpd-*')` doesn't see it. Register the compound
// class set explicitly so the server-rendered tabs work.
import '../ui/components/wpd-tabs/wpd-tabs';
import { showCommentsIntroDialog } from './intro-dialog';
import {
	bulkModerate,
	fetchAuthorInsights,
	fetchComments,
	fetchCounts,
	fetchReplies,
	getActiveConfig,
	postReply,
	setActiveConfig,
	setActiveWindowId,
	updateCommentContent,
	type ListParams,
} from './rest';
import type {
	AuthorInsights,
	BulkAction,
	CommentRow,
	CommentTab,
	CommentsConfig,
} from './types';
import type {
	WpdTable,
	WpdTableColumn,
} from '../ui/components/wpd-table/wpd-table';
import '../ui/components/wpd-button/wpd-button';

export type { BulkAction, CommentRow, CommentTab, CommentsConfig } from './types';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

interface ConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

interface ShellApi {
	showToast?: ( opts: {
		message: string;
		duration?: number;
		action?: { label: string; onClick: () => void };
	} ) => void;
	confirm?: ( opts: ConfirmOptions ) => Promise< boolean >;
	openWindow?: ( opts: { id: string } ) => void;
	dock?: { setBadge?: ( id: string, count: number ) => void };
	taskbar?: { setBadge?: ( id: string, count: number ) => void };
	icons?: { setBadge?: ( id: string, count: number ) => void };
	activity?: {
		publish?: ( channel: string, payload: unknown ) => void;
	};
	subscribe?: (
		topic: string,
		cb: ( payload: unknown ) => void,
	) => () => void;
	ai?: {
		ask?: ( prompt: string ) => Promise< { answer: string } >;
	};
}

function getApi(): ShellApi | undefined {
	return ( window as unknown as { wp?: { desktop?: ShellApi } } ).wp?.desktop;
}

function showToast(
	message: string,
	duration = 4000,
	action?: { label: string; onClick: () => void },
): void {
	const api = getApi();
	if ( api?.showToast ) {
		api.showToast( { message, duration, action } );
		return;
	}
	// eslint-disable-next-line no-console
	console.info( '[comments-window]', message );
}

function publish( channel: string, payload: unknown ): void {
	getApi()?.activity?.publish?.( channel, payload );
}

function updateDockBadge( count: number ): void {
	const api = getApi();
	api?.dock?.setBadge?.( 'desktop-mode-comments', count );
	api?.taskbar?.setBadge?.( 'desktop-mode-comments', count );
	api?.icons?.setBadge?.( 'desktop-mode-comments', count );
}

/* -------------------------------------------------------------------------- */
/* Config harvest                                                             */
/* -------------------------------------------------------------------------- */

function readConfig(): CommentsConfig | null {
	const cfg = ( window as unknown as {
		desktopModeWindowConfig?: Record< string, CommentsConfig | undefined >;
		desktopModeNativeWindowConfig?: Record< string, CommentsConfig | undefined >;
	} );
	const fromShared = cfg.desktopModeWindowConfig?.[ 'desktop-mode-comments' ];
	if ( fromShared ) {
		return fromShared;
	}
	const fromLazy = cfg.desktopModeNativeWindowConfig?.[ 'desktop-mode-comments' ];
	return fromLazy ?? null;
}

/* -------------------------------------------------------------------------- */
/* Spam confidence chip                                                       */
/* -------------------------------------------------------------------------- */

function spamChipFor( row: CommentRow ): HTMLElement {
	const score = Math.max( 0, Math.min( 100, row.desktop_mode_spam_score ) );
	// Three tones map straight to <wpd-chip>'s shared palette:
	//   low (0–39)   → positive  (green)
	//   medium (40–69) → warning (amber)
	//   high (70–100)  → danger  (red)
	let tone: 'positive' | 'warning' | 'danger' = 'positive';
	if ( score >= 70 ) {
		tone = 'danger';
	} else if ( score >= 40 ) {
		tone = 'warning';
	}
	const chip = document.createElement( 'wpd-chip' );
	chip.setAttribute( 'label', String( score ) );
	chip.setAttribute( 'tone', tone );
	chip.dataset.score = String( score );
	chip.dataset.tone = tone;
	// `<wpd-chip>`'s default layout reserves a 4px `gap` between the
	// (empty) icon slot and the label — for a single-character score
	// that visibly off-centers the digit. Zero the gap and bump the
	// horizontal padding so a 3-digit score (100) and a 1-digit
	// score (0) both feel evenly weighted. Tabular numerals keep the
	// width predictable across rows. Also forces a min-width so all
	// chips line up the same in the column.
	( chip as HTMLElement ).style.cssText = [
		'--wpd-chip-gap:0',
		'--wpd-chip-padding:2px 12px',
		'--wpd-chip-font-weight:700',
		'min-inline-size:44px',
		'justify-content:center',
		'font-variant-numeric:tabular-nums',
	].join( ';' );
	if ( row.desktop_mode_ai_verdict ) {
		chip.dataset.ai = '1';
		// AI halo — the only piece <wpd-chip> doesn't ship out of
		// the box. Layered as an inline boxShadow + dot child so it
		// survives <wpd-table>'s shadow-DOM rendering.
		( chip as HTMLElement ).style.boxShadow =
			'0 0 0 2px rgba(99,102,241,0.5)';
		( chip as HTMLElement ).style.position = 'relative';
		( chip as HTMLElement ).style.borderRadius = '999px';
		const dot = document.createElement( 'span' );
		dot.style.cssText = [
			'position:absolute',
			'top:-3px',
			'inset-inline-end:-3px',
			'width:8px',
			'height:8px',
			'border-radius:50%',
			'background:linear-gradient(135deg,#818cf8,#6366f1)',
			'box-shadow:0 0 0 2px #fff',
			'pointer-events:none',
		].join( ';' );
		chip.appendChild( dot );
	}
	const notes: string[] = [];
	if ( row.desktop_mode_akismet === 'true' ) {
		notes.push( __( 'Akismet flagged this comment as spam.' ) );
	} else if ( row.desktop_mode_akismet === 'false' ) {
		notes.push( __( 'Akismet cleared this comment.' ) );
	}
	const verdict = row.desktop_mode_ai_verdict;
	if ( verdict ) {
		if ( verdict.spam ) {
			notes.push( __( 'AI: looks like promotional spam.' ) );
		}
		if ( verdict.harmful ) {
			notes.push( __( 'AI: hostile / abusive tone.' ) );
		}
		if ( ! verdict.spam && ! verdict.harmful ) {
			notes.push( __( 'AI: looks safe.' ) );
		}
		if ( verdict.summary ) {
			notes.push( verdict.summary );
		}
	}
	chip.title = notes.length > 0
		? sprintf(
			/* translators: 1: spam score 0–100, 2: extra moderation notes. */
			__( 'Spam score: %1$d / 100. %2$s' ),
			score,
			notes.join( ' ' ),
		)
		: sprintf(
			/* translators: %d: spam score 0–100. */
			__( 'Spam score: %d / 100.' ),
			score,
		);
	return chip;
}

/* -------------------------------------------------------------------------- */
/* Inline reply editor                                                        */
/* -------------------------------------------------------------------------- */

interface ReplyEditorHandle {
	root: HTMLElement;
	getValue(): string;
	focus(): void;
	destroy(): void;
}

function mountRichEditor( placeholder: string ): ReplyEditorHandle {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-comments__reply';

	const toolbar = document.createElement( 'div' );
	toolbar.className = 'desktop-mode-comments__reply-toolbar';
	const cmds: Array< { cmd: string; icon: string; label: string } > = [
		{ cmd: 'bold', icon: 'dashicons-editor-bold', label: __( 'Bold' ) },
		{ cmd: 'italic', icon: 'dashicons-editor-italic', label: __( 'Italic' ) },
		{ cmd: 'insertUnorderedList', icon: 'dashicons-editor-ul', label: __( 'Bulleted list' ) },
		{ cmd: 'insertOrderedList', icon: 'dashicons-editor-ol', label: __( 'Numbered list' ) },
	];
	cmds.forEach( ( c ) => {
		const btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.className = 'desktop-mode-comments__reply-tool';
		btn.title = c.label;
		btn.setAttribute( 'aria-label', c.label );
		btn.innerHTML = `<span class="dashicons ${ c.icon }" aria-hidden="true"></span>`;
		btn.addEventListener( 'mousedown', ( e ) => e.preventDefault() );
		btn.addEventListener( 'click', () => {
			document.execCommand( c.cmd );
			editable.focus();
		} );
		toolbar.appendChild( btn );
	} );
	const linkBtn = document.createElement( 'button' );
	linkBtn.type = 'button';
	linkBtn.className = 'desktop-mode-comments__reply-tool';
	linkBtn.title = __( 'Wrap selection in a link' );
	linkBtn.setAttribute( 'aria-label', __( 'Wrap selection in a link' ) );
	linkBtn.innerHTML =
		'<span class="dashicons dashicons-admin-links" aria-hidden="true"></span>';
	linkBtn.addEventListener( 'mousedown', ( e ) => e.preventDefault() );
	linkBtn.addEventListener( 'click', () => {
		// Pulls the URL from the selected text directly — selection
		// must already be a valid http(s):// URL. Keeps the bundle out
		// of the modal/prompt business; a richer link UX can be a
		// follow-up component.
		const selection = editable.ownerDocument.getSelection?.()?.toString().trim() ?? '';
		if ( /^https?:\/\//i.test( selection ) ) {
			document.execCommand( 'createLink', false, selection );
		} else {
			showToast(
				__( 'Select a full URL (https://…) in your reply, then click the link button.' ),
			);
		}
	} );
	toolbar.appendChild( linkBtn );

	const editable = document.createElement( 'div' );
	editable.className = 'desktop-mode-comments__reply-input';
	editable.contentEditable = 'true';
	editable.setAttribute( 'role', 'textbox' );
	editable.setAttribute( 'aria-multiline', 'true' );
	editable.setAttribute( 'aria-label', placeholder );
	editable.dataset.placeholder = placeholder;

	wrap.append( toolbar, editable );

	return {
		root: wrap,
		getValue: () => editable.innerHTML.trim(),
		focus: () => editable.focus(),
		destroy: () => wrap.remove(),
	};
}

function mountPlainEditor( placeholder: string ): ReplyEditorHandle {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-comments__reply desktop-mode-comments__reply--plain';
	const ta = document.createElement( 'textarea' );
	ta.className = 'desktop-mode-comments__reply-input';
	ta.placeholder = placeholder;
	ta.rows = 3;
	wrap.appendChild( ta );
	return {
		root: wrap,
		getValue: () => ta.value.trim(),
		focus: () => ta.focus(),
		destroy: () => wrap.remove(),
	};
}

function mountReplyEditor(
	flavor: CommentsConfig[ 'replyEditor' ],
	placeholder: string,
): ReplyEditorHandle {
	if ( flavor === 'plain' ) {
		return mountPlainEditor( placeholder );
	}
	// Gutenberg flavor is a planned follow-up — fall through to rich
	// for now so the surface ships. The filter
	// `desktop_mode_comments_window_reply_editor` already lets a site
	// pick this, so when the Gutenberg path lands no PHP changes.
	return mountRichEditor( placeholder );
}

/* -------------------------------------------------------------------------- */
/* Author insights drawer                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Show the drawer flyover. Owns the open/close lifecycle: backdrop
 * fade-in, panel slide-in, ESC + click-outside-to-close, ARIA state
 * sync. Idempotent — calling it again while open just re-renders
 * the contents for the new email (no exit/enter animation between
 * authors).
 */
/**
 * Resolve (or create) the dim backdrop. The PHP template emits it as
 * a sibling of the drawer host, but a JS-only reload of the bundle
 * (without a full admin-page refresh) leaves the user on the old
 * template that doesn't have it yet — so we self-heal by injecting
 * the element when missing.
 */
function ensureBackdrop( host: HTMLElement ): HTMLElement | null {
	// Mount on the WINDOW ROOT, not the comments body — that way the
	// dim wash covers the title bar too. The framework window
	// element wraps everything (titlebar + body), so a backdrop
	// pinned with `inset: 0` to the window root produces a single
	// continuous overlay across the whole window surface. The
	// template-rendered backdrop (a child of `.desktop-mode-comments`)
	// is left in place and ignored when present — we always re-anchor
	// to the window root here.
	const windowRoot =
		host.closest< HTMLElement >( '.desktop-mode-window' ) ??
		host.parentElement;
	if ( ! windowRoot ) {
		return null;
	}
	let backdrop = windowRoot.querySelector< HTMLElement >(
		':scope > [data-desktop-mode-comments-drawer-backdrop]',
	);
	if ( ! backdrop ) {
		backdrop = document.createElement( 'div' );
		backdrop.className = 'desktop-mode-comments__drawer-backdrop';
		backdrop.setAttribute( 'data-desktop-mode-comments-drawer-backdrop', '' );
		// First child so the backdrop sits BENEATH the title bar +
		// body in stacking order. The drawer (rendered inside the
		// body) still floats above via its own z-index.
		windowRoot.insertBefore( backdrop, windowRoot.firstChild );
	}
	return backdrop;
}

function closeAuthorDrawer( host: HTMLElement ): void {
	host.removeAttribute( 'data-open' );
	host.setAttribute( 'aria-hidden', 'true' );
	const backdrop = ensureBackdrop( host );
	backdrop?.removeAttribute( 'data-open' );
	// Tear down the outside-click + esc listeners attached on open.
	const tearDown = ( host as unknown as { __teardown?: () => void } )
		.__teardown;
	if ( tearDown ) {
		tearDown();
		delete ( host as unknown as { __teardown?: () => void } ).__teardown;
	}
}

async function openAuthorDrawer(
	cfg: CommentsConfig,
	host: HTMLElement,
	email: string,
): Promise< void > {
	const backdrop = ensureBackdrop( host );
	const wasOpen = host.getAttribute( 'data-open' ) === 'true';
	host.replaceChildren();
	const loading = document.createElement( 'p' );
	loading.className = 'desktop-mode-comments__drawer-loading';
	loading.textContent = __( 'Loading author insights…' );
	host.appendChild( loading );

	if ( ! wasOpen ) {
		// Flip `data-open` on the NEXT frame so the browser commits
		// the initial pose (off-screen, transparent) BEFORE the
		// transition target lands. Without the rAF the transition
		// is skipped — browsers collapse the two states into a
		// single layout pass.
		host.setAttribute( 'aria-hidden', 'false' );
		backdrop?.setAttribute( 'data-open', 'false' );
		requestAnimationFrame( () => {
			host.setAttribute( 'data-open', 'true' );
			backdrop?.setAttribute( 'data-open', 'true' );
		} );

		// Close on outside-click (the backdrop) + Esc.
		const onEsc = ( e: KeyboardEvent ): void => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				closeAuthorDrawer( host );
			}
		};
		const onBackdropClick = (): void => closeAuthorDrawer( host );
		document.addEventListener( 'keydown', onEsc );
		backdrop?.addEventListener( 'click', onBackdropClick );
		( host as unknown as { __teardown?: () => void } ).__teardown = () => {
			document.removeEventListener( 'keydown', onEsc );
			backdrop?.removeEventListener( 'click', onBackdropClick );
		};
	}

	let data: AuthorInsights;
	try {
		data = await fetchAuthorInsights( cfg, email );
	} catch ( err ) {
		host.replaceChildren();
		const errEl = document.createElement( 'p' );
		errEl.className = 'desktop-mode-comments__drawer-error';
		errEl.textContent =
			err instanceof Error ? err.message : __( 'Could not load insights.' );
		host.appendChild( errEl );
		return;
	}

	host.replaceChildren();

	const header = document.createElement( 'header' );
	header.className = 'desktop-mode-comments__drawer-header';
	const avatar = document.createElement( 'wpd-avatar' );
	avatar.setAttribute( 'size', '64' );
	if ( data.userName ) {
		avatar.setAttribute( 'name', data.userName );
	}
	if ( data.avatarUrl ) {
		applyAvatarSrc( avatar, data.avatarUrl );
	}
	if ( data.userId > 0 ) {
		avatar.setAttribute( 'user-id', String( data.userId ) );
	}
	avatar.className = 'desktop-mode-comments__drawer-avatar';
	const headerText = document.createElement( 'div' );
	const name = document.createElement( 'h2' );
	name.textContent = data.userName || data.email;
	const sub = document.createElement( 'p' );
	sub.textContent = data.email;
	sub.className = 'desktop-mode-comments__drawer-sub';
	headerText.append( name, sub );
	header.append( avatar, headerText );
	host.appendChild( header );

	const reliability = document.createElement( 'div' );
	reliability.className = 'desktop-mode-comments__drawer-meter';
	const reliabilityLabel = document.createElement( 'span' );
	reliabilityLabel.textContent = sprintf(
		/* translators: %d: 0–100 reliability score. */
		__( 'Reliability: %d / 100' ),
		data.reliability,
	);
	const meter = document.createElement( 'div' );
	meter.className = 'desktop-mode-comments__drawer-bar';
	meter.style.setProperty( '--value', `${ data.reliability }%` );
	reliability.append( reliabilityLabel, meter );
	host.appendChild( reliability );

	const stats = document.createElement( 'dl' );
	stats.className = 'desktop-mode-comments__drawer-stats';
	const lines: Array< [ string, string ] > = [
		[ __( 'Total comments' ), String( data.total ) ],
		[ __( 'Approved' ), String( data.counts.approve ) ],
		[ __( 'Pending' ), String( data.counts.hold ) ],
		[ __( 'Spam' ), String( data.counts.spam ) ],
		[ __( 'Trash' ), String( data.counts.trash ) ],
		[
			__( 'First seen' ),
			data.oldest ? new Date( data.oldest + 'Z' ).toLocaleDateString() : '—',
		],
		[
			__( 'Last seen' ),
			data.newest ? new Date( data.newest + 'Z' ).toLocaleDateString() : '—',
		],
	];
	lines.forEach( ( [ label, value ] ) => {
		const dt = document.createElement( 'dt' );
		dt.textContent = label;
		const dd = document.createElement( 'dd' );
		dd.textContent = value;
		stats.append( dt, dd );
	} );
	host.appendChild( stats );

	const closeBtn = document.createElement( 'button' );
	closeBtn.type = 'button';
	closeBtn.className = 'desktop-mode-comments__drawer-close';
	closeBtn.textContent = __( 'Close' );
	closeBtn.addEventListener( 'click', () => closeAuthorDrawer( host ) );
	host.appendChild( closeBtn );

	publish( 'desktop-mode-comments/insights-opened', { email: data.email } );
}

/* -------------------------------------------------------------------------- */
/* Per-panel state                                                            */
/* -------------------------------------------------------------------------- */

interface PanelState {
	root: HTMLElement;
	tab: CommentTab;
	page: number;
	perPage: number;
	search: string;
	total: number;
	totalPages: number;
	rows: CommentRow[];
	table?: WpdTable< CommentRow >;
	tableHost?: HTMLElement;
	repliesByParent: Map< number, CommentRow[] >;
	openReplies: Set< number >;
}

const undoStack: Array< {
	action: BulkAction;
	ids: number[];
	inverse: BulkAction | null;
	expiresAt: number;
} > = [];

function inverseAction( action: BulkAction ): BulkAction | null {
	switch ( action ) {
		case 'approve':
			return 'unapprove';
		case 'unapprove':
			return 'approve';
		case 'spam':
			return 'unspam';
		case 'unspam':
			return 'spam';
		case 'trash':
			return 'untrash';
		case 'untrash':
			return 'trash';
	}
}

function actionPastTense( action: BulkAction, count: number ): string {
	switch ( action ) {
		case 'approve':
			/* translators: %d: number of comments. */
			return sprintf( __( 'Approved %d.' ), count );
		case 'unapprove':
			/* translators: %d: number of comments. */
			return sprintf( __( 'Unapproved %d.' ), count );
		case 'spam':
			/* translators: %d: number of comments. */
			return sprintf( __( 'Marked %d as spam.' ), count );
		case 'unspam':
			/* translators: %d: number of comments. */
			return sprintf( __( 'Un-spammed %d.' ), count );
		case 'trash':
			/* translators: %d: number of comments. */
			return sprintf( __( 'Trashed %d.' ), count );
		case 'untrash':
			/* translators: %d: number of comments. */
			return sprintf( __( 'Restored %d.' ), count );
	}
}

/* -------------------------------------------------------------------------- */
/* Main render                                                                */
/* -------------------------------------------------------------------------- */

async function renderCommentsWindow( body: HTMLElement ): Promise< void > {
	const cfg = readConfig();
	if ( ! cfg ) {
		body.innerHTML = `<p class="desktop-mode-comments__fatal">${ __(
			'Comments window configuration missing.',
		) }</p>`;
		return;
	}
	setActiveConfig( cfg );

	const tabsEl = body.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-tabs]',
	);
	const newPillEl = body.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-new-pill]',
	);
	const drawerEl = body.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-drawer]',
	);
	if ( ! tabsEl || ! newPillEl || ! drawerEl ) {
		return;
	}
	const helpEl = body.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-help]',
	);

	const panels: Record< CommentTab, PanelState > = {
		pending: makePanel( body, 'pending', cfg ),
		all: makePanel( body, 'all', cfg ),
		spam: makePanel( body, 'spam', cfg ),
		trash: makePanel( body, 'trash', cfg ),
		mine: makePanel( body, 'mine', cfg ),
	};

	let activeTab: CommentTab = 'pending';
	let lastSeenPending = 0;

	const refresh = async (
		tab: CommentTab,
		opts: { force?: boolean } = {},
	): Promise< void > => {
		const state = panels[ tab ];
		if ( ! state.table || ! state.tableHost ) {
			return;
		}
		state.table.setAttribute( 'loading', '' );
		try {
			const params: ListParams = {
				tab,
				page: state.page,
				perPage: state.perPage,
				search: state.search,
				currentUserId: cfg.currentUserId,
			};
			const result = await fetchComments( cfg, params );
			state.rows = result.rows;
			state.total = result.total;
			state.totalPages = result.totalPages;
			state.repliesByParent.clear();
			state.openReplies.clear();
			// Wait for the custom element to upgrade before pushing data
			// into it; see the matching note in wirePanel().
			await customElements.whenDefined( 'wpd-table' );
			state.table.data = state.rows;
			// `<wpd-table>` keeps its selection set across `data`
			// reassignment, and bulk actions here act on the RAW
			// selected ids (not resolved through the visible rows) —
			// so ids from the previous result set would silently ride
			// into the next moderation action. Every data replacement
			// starts with a clean selection.
			state.table.clearSelection();
			updatePager( state );
			if ( tab === 'pending' && ! opts.force ) {
				if ( lastSeenPending === 0 ) {
					lastSeenPending = result.total;
				}
			}
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( '[comments-window] refresh failed:', err );
			showToast(
				err instanceof Error ? err.message : __( 'Could not load comments.' ),
			);
		} finally {
			state.table.removeAttribute( 'loading' );
		}
	};

	const setActive = ( tab: CommentTab ): void => {
		// <wpd-tabpanel for="…"> auto-toggles `hidden` based on the
		// parent <wpd-tabs value>, so we DON'T flip it ourselves — that
		// would race the component. We do mirror `value` though so a
		// programmatic refresh (heartbeat reload, etc.) lands on the
		// right panel.
		activeTab = tab;
		tabsEl.setAttribute( 'value', tab );
		void refresh( tab );
	};

	tabsEl.addEventListener( 'wpd-tab-change', ( e: Event ) => {
		const next = ( e as CustomEvent ).detail?.value as CommentTab | undefined;
		if ( next ) {
			setActive( next );
		}
	} );

	// Wire each panel
	Object.values( panels ).forEach( ( state ) => {
		wirePanel( state, cfg, async ( ids, action ) => {
			await runBulk( ids, action, state, refresh, cfg );
		}, drawerEl );
	} );

	// First load
	setActive( 'pending' );

	// Realtime: heartbeat-driven counts ping
	let countsTimer: number | null = null;
	const pollCounts = async (): Promise< void > => {
		try {
			const counts = await fetchCounts( cfg );
			updateDockBadge( counts.pending );
			if ( activeTab === 'pending' ) {
				const diff = counts.pending - lastSeenPending;
				if ( diff > 0 ) {
					newPillEl.hidden = false;
					newPillEl.replaceChildren();
					const label = document.createElement( 'span' );
					label.textContent = sprintf(
						/* translators: %d: number of new pending comments. */
						__( '%d new pending — reload' ),
						diff,
					);
					const btn = document.createElement( 'button' );
					btn.type = 'button';
					btn.textContent = __( 'Reload' );
					btn.addEventListener( 'click', () => {
						newPillEl.hidden = true;
						lastSeenPending = counts.pending;
						void refresh( 'pending', { force: true } );
					} );
					newPillEl.append( label, btn );
				}
			}
		} catch {
			/* silent — background poll */
		}
	};
	countsTimer = window.setInterval( pollCounts, 30000 );
	void pollCounts();

	// Realtime: cross-window broadcast. Any comment mutation elsewhere
	// (an edit-comments.php iframe, a post's discussion box, the
	// recycle bin, another user via the heartbeat catch-all) fires
	// `desktop-mode.comment.changed` — refresh the active panel
	// directly instead of showing the "reload" pill; the pill/count
	// poller stays as the fallback for anything the broadcast misses.
	let unsubBroadcast: ( () => void ) | null = null;
	{
		const api = getApi();
		if ( typeof api?.subscribe === 'function' ) {
			unsubBroadcast = api.subscribe(
				'desktop-mode.comment.changed',
				() => {
					void refresh( activeTab, { force: true } ).then( () => {
						if ( activeTab === 'pending' ) {
							// The refreshed list already shows the new
							// state — re-baseline so the next counts
							// poll doesn't offer a stale "reload" pill.
							lastSeenPending = panels.pending.total;
							newPillEl.hidden = true;
						}
					} );
				},
			);
		}
	}

	// Keyboard moderation
	const onKey = ( e: KeyboardEvent ): void => {
		const ownerDoc = body.ownerDocument;
		if ( ! body.contains( ownerDoc.activeElement ) ) {
			return;
		}
		const target = ownerDoc.activeElement as HTMLElement | null;
		const editing =
			!! target &&
			( target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable ||
				target.tagName === 'WPD-TEXT-FIELD' );
		if ( editing ) {
			return;
		}
		const state = panels[ activeTab ];
		if ( ! state.table ) {
			return;
		}
		const ids = Array.from( state.table.selection )
			.map( ( v ) => Number( v ) )
			.filter( Boolean );
		switch ( e.key ) {
			case 'j':
			case 'k':
				e.preventDefault();
				moveFocus( state, e.key === 'j' ? 1 : -1 );
				break;
			case 'a':
				if ( ids.length > 0 ) {
					e.preventDefault();
					const targetAction: BulkAction =
						activeTab === 'pending' ? 'approve' : 'unapprove';
					void runBulk( ids, targetAction, state, refresh, cfg );
				}
				break;
			case 's':
				if ( ids.length > 0 ) {
					e.preventDefault();
					void runBulk(
						ids,
						activeTab === 'spam' ? 'unspam' : 'spam',
						state,
						refresh,
						cfg,
					);
				}
				break;
			case 'd':
				if ( ids.length > 0 ) {
					e.preventDefault();
					void runBulk(
						ids,
						activeTab === 'trash' ? 'untrash' : 'trash',
						state,
						refresh,
						cfg,
					);
				}
				break;
			case 'u':
				e.preventDefault();
				void undoLast( cfg, refresh, activeTab );
				break;
			case 'r':
				if ( ids.length === 1 ) {
					e.preventDefault();
					openReplyFor( state, ids[ 0 ], cfg );
				}
				break;
			case 'e':
				if ( ids.length === 1 ) {
					e.preventDefault();
					openEditFor( state, ids[ 0 ], cfg, refresh );
				}
				break;
			case '?':
				if ( helpEl ) {
					e.preventDefault();
					helpEl.hidden = ! helpEl.hidden;
					helpEl
						.querySelector( '[data-desktop-mode-comments-help-close]' )
						?.addEventListener(
							'click',
							() => {
								helpEl.hidden = true;
							},
							{ once: true },
						);
				}
				break;
		}
	};
	document.addEventListener( 'keydown', onKey );

	// Intro dialog — show once per user.
	if ( ! cfg.introSeen ) {
		void ( async () => {
			const outcome = await showCommentsIntroDialog();
			if ( outcome !== 'cancel' ) {
				try {
					await trackedFetch(
						cfg.introUrl,
						{
							method: 'POST',
							credentials: 'same-origin',
							headers: {
								'X-WP-Nonce': cfg.restNonce,
								'Content-Type': 'application/json',
							},
							body: JSON.stringify( { slug: cfg.introSlug } ),
						},
						{ source: 'desktop-mode/comments/intro-seen', silent: true },
					);
				} catch {
					/* non-fatal */
				}
			}
			if ( outcome === 'settings' ) {
				getApi()?.openWindow?.( { id: 'desktop-mode-os-settings' } );
			}
		} )();
	}

	// Cleanup on window close — listen for the framework's
	// desktop-mode-window-closed CustomEvent and tear ourselves down.
	const onClosed = ( e: Event ): void => {
		const detail = ( e as CustomEvent ).detail as { windowId?: string } | undefined;
		if ( detail?.windowId !== 'desktop-mode-comments' ) {
			return;
		}
		if ( countsTimer ) {
			window.clearInterval( countsTimer );
			countsTimer = null;
		}
		try {
			unsubBroadcast?.();
		} catch {
			/* swallow */
		}
		unsubBroadcast = null;
		document.removeEventListener( 'keydown', onKey );
		document.removeEventListener( 'desktop-mode-window-closed', onClosed );
		setActiveConfig( null );
	};
	document.addEventListener( 'desktop-mode-window-closed', onClosed );
}

/* -------------------------------------------------------------------------- */
/* Per-panel wiring                                                            */
/* -------------------------------------------------------------------------- */

function makePanel(
	body: HTMLElement,
	tab: CommentTab,
	cfg: CommentsConfig,
): PanelState {
	const root = body.querySelector< HTMLElement >(
		`[data-desktop-mode-comments-panel="${ tab }"]`,
	);
	if ( ! root ) {
		throw new Error( `[comments-window] panel ${ tab } not found` );
	}

	root.innerHTML = `
		<header class="desktop-mode-comments__toolbar">
			<div class="desktop-mode-comments__toolbar-left">
				<wpd-text-field
					data-desktop-mode-comments-search
					placeholder="${ __( 'Search comments…' ) }"
				></wpd-text-field>
			</div>
			<div class="desktop-mode-comments__toolbar-right" data-desktop-mode-comments-bulk hidden>
				<span class="desktop-mode-comments__count" data-desktop-mode-comments-count></span>
				<span class="desktop-mode-comments__bulk-actions" data-desktop-mode-comments-bulk-actions></span>
			</div>
			<div class="desktop-mode-comments__toolbar-trailing">
				<wpd-button variant="ghost" data-desktop-mode-comments-refresh title="${ __(
					'Refresh',
				) }">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</wpd-button>
			</div>
		</header>
		<div class="desktop-mode-comments__body" data-desktop-mode-comments-body>
			<wpd-table
				data-desktop-mode-comments-table
				selectable="multi"
				sticky-header
				hover
				striped
				bordered
				loading
			>
				<div slot="empty" class="desktop-mode-comments__empty">
					<span class="dashicons dashicons-admin-comments" aria-hidden="true"></span>
					<p>${ __( 'No comments to moderate here.' ) }</p>
				</div>
			</wpd-table>
		</div>
		<footer class="desktop-mode-comments__pager">
			<div class="desktop-mode-comments__pager-meta" data-desktop-mode-comments-page-indicator>—</div>
			<div class="desktop-mode-comments__pager-nav">
				<wpd-button variant="ghost" data-desktop-mode-comments-prev disabled>
					<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>
					${ __( 'Previous' ) }
				</wpd-button>
				<wpd-button variant="ghost" data-desktop-mode-comments-next disabled>
					${ __( 'Next' ) }
					<span class="dashicons dashicons-arrow-right-alt2" aria-hidden="true"></span>
				</wpd-button>
				<label class="desktop-mode-comments__pager-perpage">
					${ __( 'Per page' ) }
					<select data-desktop-mode-comments-per-page>
						<option value="10">10</option>
						<option value="20" selected>20</option>
						<option value="50">50</option>
						<option value="100">100</option>
					</select>
				</label>
			</div>
		</footer>
	`;

	return {
		root,
		tab,
		page: 1,
		perPage: cfg.defaultPerPage,
		search: '',
		total: 0,
		totalPages: 1,
		rows: [],
		repliesByParent: new Map(),
		openReplies: new Set(),
	};
}

function buildColumns(
	cfg: CommentsConfig,
	state: PanelState,
	drawerEl: HTMLElement,
): WpdTableColumn< CommentRow >[] {
	const cols: WpdTableColumn< CommentRow >[] = [];

	cols.push( {
		key: 'author_name',
		label: __( 'Author' ),
		sticky: true,
		minWidth: '180px',
		render: ( _v, row ) => {
			const wrap = document.createElement( 'div' );
			wrap.style.cssText =
				'display:flex;gap:10px;align-items:center;min-width:0;';

			const avatar = document.createElement( 'wpd-avatar' );
			avatar.setAttribute( 'size', '32' );
			avatar.setAttribute( 'clickable', '' );
			avatar.setAttribute( 'title', __( 'Show author insights' ) );
			// Set the NAME up front so initials paint instantly while
			// the Gravatar HEAD probe is in flight. If the probe
			// resolves to a real URL the avatar swaps to the image;
			// if it 404s the initials stay put.
			if ( row.author_name ) {
				avatar.setAttribute( 'name', row.author_name );
			}
			const rawAvatarUrl = row.author_avatar_urls?.[ '48' ] ?? '';
			if ( rawAvatarUrl ) {
				applyAvatarSrc( avatar, rawAvatarUrl );
			}
			if ( row.author > 0 ) {
				avatar.setAttribute( 'user-id', String( row.author ) );
			}
			avatar.addEventListener( 'wpd-avatar-click', ( e ) => {
				e.stopPropagation();
				void openAuthorDrawer( cfg, drawerEl, row.author_email );
			} );

			// Cell rendering is inside `<wpd-table>`'s shadow root, so
			// class-based CSS in the light-DOM `comments-window.css`
			// stylesheet can't reach in — inline styles do. Matches
			// the pattern used throughout `src/posts-window/index.ts`.
			const meta = document.createElement( 'div' );
			meta.style.cssText =
				'display:flex;flex-direction:column;gap:2px;min-width:0;' +
				'line-height:1.3;';
			const name = document.createElement( 'strong' );
			name.style.cssText =
				'font-weight:600;color:#1d2327;' +
				'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			name.textContent = row.author_name || __( 'Anonymous' );
			const email = document.createElement( 'small' );
			email.style.cssText =
				'color:#646970;font-size:12px;' +
				'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			email.textContent = row.author_email;
			meta.append( name, email );
			wrap.append( avatar, meta );
			return wrap;
		},
	} );

	cols.push( {
		key: 'content',
		label: __( 'Comment' ),
		minWidth: '320px',
		render: ( _v, row ) => {
			const wrap = document.createElement( 'div' );
			wrap.className = 'desktop-mode-comments__content';
			const body = document.createElement( 'div' );
			body.className = 'desktop-mode-comments__content-body';
			body.innerHTML = row.content?.rendered ?? '';
			wrap.appendChild( body );

			if ( row.desktop_mode_replies_count > 0 ) {
				const tog = document.createElement( 'button' );
				tog.type = 'button';
				tog.className = 'desktop-mode-comments__replies-toggle';
				tog.textContent = sprintf(
					/* translators: %d: number of direct replies. */
					_n(
						'+ %d reply',
						'+ %d replies',
						row.desktop_mode_replies_count,
					),
					row.desktop_mode_replies_count,
				);
				tog.addEventListener( 'click', ( e ) => {
					e.stopPropagation();
					void toggleReplies( state, row.id, cfg, wrap );
				} );
				wrap.appendChild( tog );
			}

			return wrap;
		},
	} );

	cols.push( {
		key: 'desktop_mode_post_title',
		label: __( 'In response to' ),
		minWidth: '180px',
		render: ( _v, row ) => {
			if ( ! row.desktop_mode_post_link ) {
				return row.desktop_mode_post_title;
			}
			const a = document.createElement( 'a' );
			a.href = row.desktop_mode_post_link;
			a.target = '_blank';
			a.rel = 'noopener';
			a.textContent = row.desktop_mode_post_title;
			return a;
		},
	} );

	cols.push( {
		key: 'desktop_mode_spam_score',
		label: __( 'Spam' ),
		align: 'center',
		sortable: true,
		width: '78px',
		render: ( _v, row ) => spamChipFor( row ),
	} );

	cols.push( {
		key: 'date_gmt',
		label: __( 'Submitted on' ),
		sortable: true,
		width: '160px',
		render: ( _v, row ) => {
			try {
				return new Date( row.date_gmt + 'Z' ).toLocaleString();
			} catch {
				return row.date_gmt;
			}
		},
	} );

	return cols;
}

function wirePanel(
	state: PanelState,
	cfg: CommentsConfig,
	runBulkLocal: ( ids: number[], action: BulkAction ) => Promise< void >,
	drawerEl: HTMLElement,
): void {
	const table = state.root.querySelector< WpdTable< CommentRow > >(
		'[data-desktop-mode-comments-table]',
	);
	const body = state.root.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-body]',
	);
	const bulkBar = state.root.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-bulk]',
	);
	const bulkActionsHost = state.root.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-bulk-actions]',
	);
	const countEl = state.root.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-count]',
	);
	if ( ! table || ! body || ! bulkBar || ! bulkActionsHost || ! countEl ) {
		return;
	}
	const searchEl = state.root.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-search]',
	);
	const refreshBtn = state.root.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-refresh]',
	);
	const prevBtn = state.root.querySelector< HTMLButtonElement >(
		'[data-desktop-mode-comments-prev]',
	);
	const nextBtn = state.root.querySelector< HTMLButtonElement >(
		'[data-desktop-mode-comments-next]',
	);
	const perPageSel = state.root.querySelector< HTMLSelectElement >(
		'[data-desktop-mode-comments-per-page]',
	);
	state.table = table;
	state.tableHost = body;
	// Custom elements upgrade asynchronously. If the desktop bundle is
	// still loading when this code runs, `<wpd-table>` is a plain
	// HTMLElement and setting `.columns` / `.data` lands them as
	// expandos that the WpdTable class never reads — symptom is
	// "loading attribute stuck, no rows ever paint, no console error".
	// Wait for the upgrade before configuring.
	void customElements.whenDefined( 'wpd-table' ).then( () => {
		table.columns = buildColumns( cfg, state, drawerEl );
		table.getRowId = ( row: CommentRow ) => row.id;
		if ( state.rows.length > 0 ) {
			table.data = state.rows;
		}
	} );

	// Bulk action chips
	const renderBulkActions = (): void => {
		bulkActionsHost.replaceChildren();
		const actions: Array< { label: string; action: BulkAction; danger?: boolean } > = [];
		if ( state.tab === 'pending' || state.tab === 'all' || state.tab === 'mine' ) {
			actions.push( { label: __( 'Approve' ), action: 'approve' } );
			actions.push( { label: __( 'Unapprove' ), action: 'unapprove' } );
		}
		if ( state.tab === 'spam' ) {
			actions.push( { label: __( 'Not spam' ), action: 'unspam' } );
		} else {
			actions.push( { label: __( 'Spam' ), action: 'spam' } );
		}
		if ( state.tab === 'trash' ) {
			actions.push( { label: __( 'Restore' ), action: 'untrash' } );
		} else {
			actions.push( { label: __( 'Trash' ), action: 'trash', danger: true } );
		}
		actions.forEach( ( a ) => {
			const btn = document.createElement( 'wpd-button' );
			btn.setAttribute( 'variant', a.danger ? 'danger' : 'ghost' );
			btn.textContent = a.label;
			btn.addEventListener( 'click', () => {
				const sel = Array.from( table.selection )
					.map( ( v ) => Number( v ) )
					.filter( Boolean );
				if ( sel.length > 0 ) {
					void runBulkLocal( sel, a.action );
				}
			} );
			bulkActionsHost.appendChild( btn );
		} );
	};
	renderBulkActions();

	table.addEventListener( 'wpd-table-selection-change', () => {
		const count = table.selection.size;
		bulkBar.hidden = count === 0;
		countEl.textContent = sprintf(
			/* translators: %d: count of selected rows. */
			__( '%d selected' ),
			count,
		);
	} );

	let searchDebounce: number | null = null;
	searchEl?.addEventListener( 'wpd-input-change', ( e ) => {
		const val = ( e as CustomEvent ).detail?.value ?? '';
		if ( searchDebounce ) {
			window.clearTimeout( searchDebounce );
		}
		searchDebounce = window.setTimeout( () => {
			state.search = String( val );
			state.page = 1;
			void reloadActivePanel( state );
		}, 300 );
	} );

	refreshBtn?.addEventListener( 'click', () => {
		void reloadActivePanel( state );
	} );

	prevBtn?.addEventListener( 'click', () => {
		if ( state.page > 1 ) {
			state.page -= 1;
			void reloadActivePanel( state );
		}
	} );
	nextBtn?.addEventListener( 'click', () => {
		if ( state.page < state.totalPages ) {
			state.page += 1;
			void reloadActivePanel( state );
		}
	} );
	perPageSel?.addEventListener( 'change', () => {
		state.perPage = parseInt( perPageSel.value, 10 ) || 20;
		state.page = 1;
		void reloadActivePanel( state );
	} );
}

async function reloadActivePanel( state: PanelState ): Promise< void > {
	const cfg = getActiveConfig();
	if ( ! cfg || ! state.table ) {
		return;
	}
	state.table.setAttribute( 'loading', '' );
	try {
		const result = await fetchComments( cfg, {
			tab: state.tab,
			page: state.page,
			perPage: state.perPage,
			search: state.search,
			currentUserId: cfg.currentUserId,
		} );
		state.rows = result.rows;
		state.total = result.total;
		state.totalPages = result.totalPages;
		await customElements.whenDefined( 'wpd-table' );
		state.table.data = state.rows;
		// See the matching note in refresh(): stale selected ids must
		// not survive a data replacement (pagination, search, manual
		// refresh) — they'd be swept into the next bulk action.
		state.table.clearSelection();
		updatePager( state );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[comments-window] reload failed:', err );
		showToast(
			err instanceof Error ? err.message : __( 'Could not load comments.' ),
		);
	} finally {
		state.table.removeAttribute( 'loading' );
	}
}

function updatePager( state: PanelState ): void {
	const indicator = state.root.querySelector< HTMLElement >(
		'[data-desktop-mode-comments-page-indicator]',
	);
	const prevBtn = state.root.querySelector(
		'[data-desktop-mode-comments-prev]',
	) as ( HTMLElement & { disabled: boolean } ) | null;
	const nextBtn = state.root.querySelector(
		'[data-desktop-mode-comments-next]',
	) as ( HTMLElement & { disabled: boolean } ) | null;
	if ( indicator ) {
		indicator.textContent = sprintf(
			/* translators: 1: current page, 2: total pages, 3: total rows. */
			__( 'Page %1$d of %2$d (%3$d total)' ),
			state.page,
			state.totalPages,
			state.total,
		);
	}
	// `<wpd-button>`'s `disabled` is a Component-base reflected prop:
	// assigning `false` removes the attribute via the
	// HTML-convention reflection rule installed in
	// `src/ui/core/component.ts`. This is the test surface for that
	// framework fix — if pagination starts working again, the fix is
	// solid for every other `<wpd-*>` boolean attribute too.
	if ( prevBtn ) {
		prevBtn.disabled = state.page <= 1;
	}
	if ( nextBtn ) {
		nextBtn.disabled = state.page >= state.totalPages;
	}
}

/* -------------------------------------------------------------------------- */
/* Replies sub-row                                                            */
/* -------------------------------------------------------------------------- */

async function toggleReplies(
	state: PanelState,
	parentId: number,
	cfg: CommentsConfig,
	host: HTMLElement,
): Promise< void > {
	const existing = host.querySelector( '.desktop-mode-comments__replies' );
	if ( existing ) {
		existing.remove();
		state.openReplies.delete( parentId );
		return;
	}
	state.openReplies.add( parentId );

	let replies = state.repliesByParent.get( parentId );
	if ( ! replies ) {
		try {
			replies = await fetchReplies( cfg, parentId );
			state.repliesByParent.set( parentId, replies );
		} catch ( err ) {
			showToast(
				err instanceof Error ? err.message : __( 'Could not load replies.' ),
			);
			return;
		}
	}

	const tree = document.createElement( 'div' );
	tree.className = 'desktop-mode-comments__replies';
	replies.forEach( ( r ) => {
		const item = document.createElement( 'div' );
		item.className = 'desktop-mode-comments__reply-row';
		const author = document.createElement( 'strong' );
		author.textContent = r.author_name || __( 'Anonymous' );
		const sep = document.createTextNode( ' — ' );
		const cnt = document.createElement( 'span' );
		cnt.innerHTML = r.content?.rendered ?? '';
		item.append( author, sep, cnt );
		tree.appendChild( item );
	} );
	host.appendChild( tree );
}

/* -------------------------------------------------------------------------- */
/* Inline reply / edit                                                        */
/* -------------------------------------------------------------------------- */

function openReplyFor(
	state: PanelState,
	id: number,
	cfg: CommentsConfig,
): void {
	const row = state.rows.find( ( r ) => r.id === id );
	if ( ! row ) {
		return;
	}
	const tr = state.tableHost?.querySelector< HTMLElement >(
		`tr[data-row-id="${ id }"]`,
	);
	const host = tr?.nextElementSibling?.classList.contains(
		'desktop-mode-comments__inline-host',
	)
		? ( tr.nextElementSibling as HTMLElement )
		: ( () => {
			const ins = document.createElement( 'div' );
			ins.className = 'desktop-mode-comments__inline-host';
			tr?.after( ins );
			return ins;
		} )();
	host.replaceChildren();
	const editor = mountReplyEditor(
		cfg.replyEditor,
		__( 'Write a reply…' ),
	);
	host.appendChild( editor.root );
	const actions = document.createElement( 'div' );
	actions.className = 'desktop-mode-comments__inline-actions';
	const cancel = document.createElement( 'wpd-button' );
	cancel.setAttribute( 'variant', 'ghost' );
	cancel.textContent = __( 'Cancel' );
	cancel.addEventListener( 'click', () => {
		editor.destroy();
		host.remove();
	} );
	const send = document.createElement( 'wpd-button' );
	send.setAttribute( 'variant', 'primary' );
	send.textContent = __( 'Send reply' );
	send.addEventListener( 'click', async () => {
		const value = editor.getValue();
		if ( ! value ) {
			showToast( __( 'Reply is empty.' ) );
			return;
		}
		try {
			await postReply( cfg, id, value );
			showToast( __( 'Reply posted.' ) );
			publish( 'desktop-mode-comments/replied', {
				parentId: id,
				postId: row.post,
			} );
			editor.destroy();
			host.remove();
		} catch ( err ) {
			showToast(
				err instanceof Error ? err.message : __( 'Reply failed.' ),
			);
		}
	} );
	actions.append( cancel, send );
	host.appendChild( actions );
	editor.focus();
}

function openEditFor(
	state: PanelState,
	id: number,
	cfg: CommentsConfig,
	refresh: ( tab: CommentTab ) => Promise< void >,
): void {
	const row = state.rows.find( ( r ) => r.id === id );
	if ( ! row || ! row.desktop_mode_can_edit ) {
		showToast( __( 'You can\'t edit this comment.' ) );
		return;
	}
	const tr = state.tableHost?.querySelector< HTMLElement >(
		`tr[data-row-id="${ id }"]`,
	);
	if ( ! tr ) {
		return;
	}
	const host = document.createElement( 'div' );
	host.className = 'desktop-mode-comments__inline-host';
	tr.after( host );
	const editor = mountReplyEditor( cfg.replyEditor, __( 'Edit comment…' ) );
	host.appendChild( editor.root );
	// Seed with current content
	const editable = editor.root.querySelector< HTMLElement >(
		'.desktop-mode-comments__reply-input',
	);
	if ( editable ) {
		if ( editable instanceof HTMLTextAreaElement ) {
			editable.value = row.content?.raw ?? '';
		} else {
			editable.innerHTML = row.content?.rendered ?? '';
		}
	}

	const actions = document.createElement( 'div' );
	actions.className = 'desktop-mode-comments__inline-actions';
	const cancel = document.createElement( 'wpd-button' );
	cancel.setAttribute( 'variant', 'ghost' );
	cancel.textContent = __( 'Cancel' );
	cancel.addEventListener( 'click', () => {
		editor.destroy();
		host.remove();
	} );
	const save = document.createElement( 'wpd-button' );
	save.setAttribute( 'variant', 'primary' );
	save.textContent = __( 'Save' );
	save.addEventListener( 'click', async () => {
		try {
			await updateCommentContent( cfg, id, editor.getValue() );
			showToast( __( 'Comment updated.' ) );
			publish( 'desktop-mode-comments/edited', { id } );
			editor.destroy();
			host.remove();
			await refresh( state.tab );
		} catch ( err ) {
			showToast(
				err instanceof Error ? err.message : __( 'Edit failed.' ),
			);
		}
	} );
	actions.append( cancel, save );
	host.appendChild( actions );
	editor.focus();
}

/* -------------------------------------------------------------------------- */
/* Bulk + undo                                                                */
/* -------------------------------------------------------------------------- */

async function runBulk(
	ids: number[],
	action: BulkAction,
	state: PanelState,
	refresh: ( tab: CommentTab, opts?: { force?: boolean } ) => Promise< void >,
	cfg: CommentsConfig,
): Promise< void > {
	try {
		const result = await bulkModerate( cfg, ids, action );
		const inverse = inverseAction( action );
		if ( inverse && result.processed.length > 0 ) {
			undoStack.push( {
				action,
				ids: result.processed,
				inverse,
				expiresAt: Date.now() + 8000,
			} );
			showToast(
				actionPastTense( action, result.processed.length ),
				8000,
				{
					label: __( 'Undo' ),
					onClick: () => {
						void undoLast( cfg, refresh, state.tab );
					},
				},
			);
		} else {
			showToast( actionPastTense( action, result.processed.length ) );
		}
		publish( `desktop-mode-comments/${ action }d`, {
			ids: result.processed,
			counts: result.counts,
		} );
		updateDockBadge( result.counts.pending );
		// Clear BEFORE the refresh, not just via refresh()'s own
		// post-assignment clear: if the follow-up fetch fails, the
		// bulk action still completed and the acted-on ids must not
		// linger in the bulk bar. clearSelection() emits
		// `wpd-table-selection-change`, which hides the bar.
		state.table?.clearSelection();
		await refresh( state.tab, { force: true } );
	} catch ( err ) {
		/* translators: %s: bulk action name (e.g. "approve", "spam"). */
		const fallback = sprintf( __( 'Bulk %s failed.' ), action );
		showToast( err instanceof Error ? err.message : fallback );
	}
}

async function undoLast(
	cfg: CommentsConfig,
	refresh: ( tab: CommentTab, opts?: { force?: boolean } ) => Promise< void >,
	currentTab: CommentTab,
): Promise< void > {
	const last = undoStack.pop();
	if ( ! last || ! last.inverse || Date.now() > last.expiresAt ) {
		return;
	}
	try {
		await bulkModerate( cfg, last.ids, last.inverse );
		showToast( __( 'Undone.' ) );
		await refresh( currentTab, { force: true } );
	} catch ( err ) {
		showToast(
			err instanceof Error ? err.message : __( 'Undo failed.' ),
		);
	}
}

/* -------------------------------------------------------------------------- */
/* Keyboard nav helpers                                                       */
/* -------------------------------------------------------------------------- */

function moveFocus( state: PanelState, direction: 1 | -1 ): void {
	if ( ! state.table || state.rows.length === 0 ) {
		return;
	}
	const selected = Array.from( state.table.selection )
		.map( ( v ) => Number( v ) )
		.filter( Boolean );
	const currentIndex =
		selected.length > 0
			? state.rows.findIndex( ( r ) => r.id === selected[ 0 ] )
			: -1;
	let nextIndex = currentIndex + direction;
	if ( nextIndex < 0 ) {
		nextIndex = 0;
	}
	if ( nextIndex >= state.rows.length ) {
		nextIndex = state.rows.length - 1;
	}
	const nextId = state.rows[ nextIndex ]?.id;
	if ( ! nextId ) {
		return;
	}
	// clearSelection() + select() rather than assigning `selection`:
	// the bare setter emits no `wpd-table-selection-change`, so the
	// "N selected" chip and bulk bar would silently desync from the
	// keyboard cursor — while a / s / d act on the real selection.
	state.table.clearSelection();
	state.table.select( nextId );
	const tr = state.tableHost?.querySelector< HTMLElement >(
		`tr[data-row-id="${ nextId }"]`,
	);
	tr?.scrollIntoView( { block: 'nearest', behavior: 'smooth' } );
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

const registry = ( window.desktopModeNativeWindows ??
	( window.desktopModeNativeWindows = {} ) ) as Record<
	string,
	RenderCallback | undefined
>;
registry[ 'desktop-mode-comments' ] = ( body: HTMLElement ) => {
	setActiveWindowId( 'desktop-mode-comments' );
	return renderCommentsWindow( body ).catch( ( err ) => {
		// eslint-disable-next-line no-console
		console.error( '[comments-window] render failed:', err );
	} ) as unknown as void;
};
