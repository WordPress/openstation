/**
 * Native Users window — render entry point.
 *
 * Mounted from the bottom of `./index.ts` when the shell opens the
 * `desktop-mode-users` window. Reuses the shared template selectors
 * (`data-desktop-mode-posts-*`) and `<wpd-table>` mount that the
 * Posts/Pages renderer already binds to, but draws a Users-shaped
 * row set: avatar + name, email, role, content stats, last login +
 * presence, registered date.
 *
 * SECURITY POSTURE
 * ================
 *
 * Every cap-gated UI affordance reads from
 * `cfg.{canEdit,canPromote,canCreate,canDelete}` AND from the
 * per-row `desktop_mode_can_edit` flag. The flags are UX hints —
 * the server re-checks every mutation, so a tampered flag here
 * just lets the user click a button that fails the REST call.
 *
 * @public
 * @since 0.18.0
 */

import { __, sprintf } from '../i18n';
import { trackedFetch } from '../tracked-fetch';
import { applyAvatarSrc } from '../ui/util/avatar-resolve';
import type { PostsWindowConfig } from './rest';
import {
	type CreateUserBody,
	type UserListItem,
	type UsersListParams,
	type UsersWindowClient,
} from './users-rest';
import { showUsersIntroDialog } from './users-intro-dialog';
// Static import — see `desktop.ts`'s onMatch comment for why this
// can't be `await import('./user-edit-target')`. The user-edit
// window's render callback fires synchronously inside `openWindow`,
// and any microtask delay here races the read in that callback and
// loses (the read sees `null` and falls back to the viewer's id).
import { setUserEditTarget } from './user-edit-target';
import type {
	WpdTable,
	WpdTableColumn,
} from '../ui/components/wpd-table/wpd-table';
import '../ui/components/wpd-avatar/wpd-avatar';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-icon/wpd-icon';
import '../ui/components/wpd-segmented/wpd-segmented';

interface ConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

function wpdConfirmGlobal( options: ConfirmOptions ): Promise< boolean > {
	const w = window as unknown as {
		wp?: { desktop?: { confirm?: ( o: ConfirmOptions ) => Promise< boolean > } };
	};
	const fn = w.wp?.desktop?.confirm;
	if ( typeof fn !== 'function' ) {
		// Fall back to a synchronous browser confirm so the absence of
		// the wpd-confirm-dialog wrapper never silently no-ops a
		// destructive action.
		// eslint-disable-next-line no-restricted-syntax, no-alert -- last-resort fallback when wp.desktop.confirm hasn't booted
		return Promise.resolve( window.confirm( options.message ) );
	}
	return fn( options );
}

function notifyToast(
	body: string,
	opts: { kind?: 'success' | 'error' | 'info' } = {},
): void {
	const w = window as unknown as {
		wp?: {
			desktop?: {
				notify?: ( o: {
					body: string;
					kind?: 'success' | 'error' | 'info';
				} ) => void;
			};
		};
	};
	const api = w.wp?.desktop;
	if ( api?.notify ) {
		api.notify( { body, kind: opts.kind } );
		return;
	}
	// eslint-disable-next-line no-console
	console.info( '[users-window]', body );
}

/**
 * Open the dedicated `desktop-mode-user-edit` native window for
 * the given user id. Single source of truth — both the row click
 * and the username-anchor click route through this. Logs the
 * exact failure path when something goes wrong so we can stop
 * playing console-warning whack-a-mole.
 */
function openUserEditWindow( userId: number ): void {
	if ( ! Number.isFinite( userId ) || userId <= 0 ) {
		return;
	}
	// Synchronous — must commit before `wp.desktop.openWindow` runs,
	// because the user-edit registry callback that reads the target
	// fires synchronously inside `openWindow` → `manager.open` →
	// `hydrateNative`. An `await import()` here pushes the write
	// past the read in microtask order and the form mounts for the
	// viewer instead of the clicked user.
	setUserEditTarget( userId );

	// eslint-disable-next-line no-console
	console.info(
		'[users-window] opening user-edit window for user',
		userId,
	);

	const w = window as unknown as {
		wp?: {
			desktop?: {
				openWindow?: ( id: string, opts?: { source?: string } ) => boolean;
			};
		};
	};

	// `wp.desktop.openWindow(id)` is the canonical public API for
	// opening a server-registered native window by id (documented
	// at desktop.ts:418). Earlier attempts called
	// `openNativeWindow` — that name lives only on an internal
	// deps object, never on the public facade, so it's `undefined`
	// at runtime. The error surfaces as "openNativeWindow
	// unavailable" in the console; the right cure is to use the
	// documented name.
	const fn = w.wp?.desktop?.openWindow;
	if ( typeof fn !== 'function' ) {
		// eslint-disable-next-line no-console
		console.error(
			'[users-window] wp.desktop.openWindow is missing — desktop shell may not be ready.',
		);
		notifyToast(
			__( 'Could not open profile window — desktop shell unavailable.' ),
			{ kind: 'error' },
		);
		return;
	}
	const opened = fn( 'desktop-mode-user-edit', {
		source: 'users-window/row-click',
	} );
	if ( ! opened ) {
		// eslint-disable-next-line no-console
		console.error(
			'[users-window] openWindow("desktop-mode-user-edit") returned false — window not registered server-side. Check includes/user-edit-window/window.php.',
		);
		notifyToast(
			__( 'Profile window not registered — see console.' ),
			{ kind: 'error' },
		);
	}
}

// ─── Template selectors (shared with Posts/Pages templates) ──────────
const ROOT = '[data-desktop-mode-posts-root]';
const STATUS = '[data-desktop-mode-posts-status]';
const SEARCH = '[data-desktop-mode-posts-search]';
const REFRESH = '[data-desktop-mode-posts-refresh]';
const NEW_BTN = '[data-desktop-mode-posts-new]';
const TABLE = '[data-desktop-mode-posts-table]';
const BULK = '[data-desktop-mode-posts-bulk]';
const COUNT = '[data-desktop-mode-posts-count]';
const PAGE_INDICATOR = '[data-desktop-mode-posts-page-indicator]';
const PREV = '[data-desktop-mode-posts-prev]';
const NEXT = '[data-desktop-mode-posts-next]';
const PER_PAGE = '[data-desktop-mode-posts-per-page]';
const BULK_ACTIONS_HOST = '[data-desktop-mode-posts-bulk-actions]';

const SEARCH_DEBOUNCE_MS = 250;

interface ViewState {
	page: number;
	perPage: number;
	search: string;
	/** 'all' | 'online' | 'recent' | 'never' */
	status: string;
	orderby: string;
	order: 'asc' | 'desc';
	roles: string[];
	searchDebounce: number | null;
}

// Small per-cell node cache so selection / pagination repaints don't
// rebuild every avatar img (avatar blink fix; same pattern as Posts).
type UserCellCache = Map< string, Node >;
function userCellKey( id: number, key: string ): string {
	return `${ id }::${ key }`;
}
function memoUserCell(
	cache: UserCellCache,
	id: number,
	key: string,
	build: () => Node,
): Node {
	const k = userCellKey( id, key );
	const cached = cache.get( k );
	if ( cached ) {
		return cached;
	}
	const node = build();
	cache.set( k, node );
	return node;
}

const _usersIntroShown = { v: false };
function maybeShowUsersIntro( client: UsersWindowClient ): void {
	if ( _usersIntroShown.v ) {
		return;
	}
	let cfg: PostsWindowConfig;
	try {
		cfg = client.getConfig();
	} catch {
		return;
	}
	if ( cfg.introSeen ) {
		return;
	}
	_usersIntroShown.v = true;
	void showUsersIntroDialog()
		.then( ( result ) => {
			if ( result === 'cancel' ) {
				_usersIntroShown.v = false;
				return;
			}
			void markUsersIntroSeen( client, cfg );
			if ( result === 'settings' ) {
				const w = window as unknown as {
					wp?: { desktop?: { openOsSettings?: () => void } };
				};
				w.wp?.desktop?.openOsSettings?.();
			}
		} )
		.catch( () => {
			_usersIntroShown.v = false;
		} );
}

async function markUsersIntroSeen(
	client: UsersWindowClient,
	cfg: PostsWindowConfig,
): Promise< void > {
	if ( ! cfg.introUrl ) {
		return;
	}
	try {
		await trackedFetch(
			cfg.introUrl,
			{
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': cfg.restNonce,
				},
				body: JSON.stringify( { slug: 'users' } ),
			},
			{
				windowId: client.windowId,
				source: 'users-window/intro',
			},
		);
		( cfg as { introSeen: boolean } ).introSeen = true;
	} catch {
		// non-fatal
	}
}

// ─── Cell builders ───────────────────────────────────────────────────

function buildIdentityCell(
	row: UserListItem,
	cfg: PostsWindowConfig,
): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText =
		'display:flex;align-items:center;gap:10px;min-width:0;';

	// `<wpd-avatar>` consolidates the hand-rolled image + presence dot
	// + initials fallback into one component. The Gravatar probe is
	// run via the shared `applyAvatarSrc` helper so users without a
	// registered avatar drop straight to initials.
	const avatar = document.createElement( 'wpd-avatar' );
	avatar.setAttribute( 'size', '32' );
	if ( row.name ) {
		avatar.setAttribute( 'name', row.name );
	}
	// Presence is authoritative from the REST row (already includes
	// the per-user heartbeat). Avoid `user-id` auto-subscribe here
	// since we already have a fresh snapshot — setting both would
	// race the explicit value against the next heartbeat tick.
	const presence = row.desktop_mode_presence ?? 'offline';
	avatar.setAttribute( 'presence', presence );
	const avatars = row.avatar_urls ?? {};
	const rawAvatar =
		avatars[ '48' ] ?? avatars[ '96' ] ?? avatars[ '24' ] ?? '';
	if ( rawAvatar ) {
		applyAvatarSrc( avatar, rawAvatar );
	}
	cell.appendChild( avatar );

	const text = document.createElement( 'span' );
	text.style.cssText =
		'display:flex;flex-direction:column;min-width:0;line-height:1.25;';

	const nameRow = document.createElement( 'span' );
	const name = document.createElement( 'a' );
	name.href = `${ cfg.editPostUrlBase }?user_id=${ row.id }`;
	name.textContent = row.name || `#${ row.id }`;
	name.title = name.textContent;
	name.setAttribute( 'data-noclick', '' );
	name.style.cssText =
		'font-weight:600;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;';
	name.addEventListener( 'mouseenter', () => {
		name.style.textDecoration = 'underline';
	} );
	name.addEventListener( 'mouseleave', () => {
		name.style.textDecoration = 'none';
	} );
	name.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		void openUserEditWindow( row.id );
	} );
	nameRow.appendChild( name );

	text.appendChild( nameRow );

	if ( row.slug ) {
		const sub = document.createElement( 'span' );
		sub.textContent = `@${ row.slug }`;
		sub.style.cssText =
			'font-size:11px;color:var(--wp-admin-theme-fg-muted, #8c8f94);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;';
		text.appendChild( sub );
	}

	cell.appendChild( text );
	return cell;
}

function buildEmailCell( row: UserListItem ): HTMLElement {
	const cell = document.createElement( 'button' );
	cell.type = 'button';
	const email = typeof row.email === 'string' ? row.email : '';
	cell.textContent = email || '—';
	cell.disabled = email === '';
	cell.title = email ? __( 'Click to copy email' ) : '';
	Object.assign( cell.style, {
		appearance: 'none',
		background: 'transparent',
		border: 'none',
		padding: '2px 6px',
		font: 'inherit',
		color: 'inherit',
		cursor: email ? 'copy' : 'default',
		textAlign: 'left',
		fontSize: '13px',
		borderRadius: '4px',
		maxWidth: '100%',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	} as Partial< CSSStyleDeclaration > );
	cell.addEventListener( 'click', ( e ) => {
		e.stopPropagation();
		if ( ! email ) {
			return;
		}
		void navigator.clipboard
			?.writeText( email )
			.then( () => {
				const orig = cell.textContent;
				cell.textContent = __( 'Copied!' );
				cell.style.color = 'var(--wp-admin-theme-color, #2271b1)';
				setTimeout( () => {
					cell.textContent = orig;
					cell.style.color = '';
				}, 1200 );
			} )
			.catch( () => {
				/* clipboard blocked */
			} );
	} );
	return cell;
}

function buildRoleCell(
	row: UserListItem,
	cfg: PostsWindowConfig,
): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText =
		'display:inline-flex;flex-wrap:wrap;gap:4px;min-width:0;';
	const roles = Array.isArray( row.roles ) ? row.roles : [];
	const labels: Record< string, string > = cfg.allRoles ?? {};
	if ( roles.length === 0 ) {
		const none = document.createElement( 'span' );
		none.textContent = __( 'No role' );
		none.style.cssText =
			'color:var(--wp-admin-theme-fg-muted, #8c8f94);font-style:italic;';
		cell.appendChild( none );
		return cell;
	}
	for ( const slug of roles ) {
		const chip = document.createElement( 'span' );
		chip.textContent = labels[ slug ] ?? slug;
		chip.style.cssText = [
			'display:inline-flex',
			'align-items:center',
			'padding:2px 8px',
			'border-radius:10px',
			'font-size:11px',
			'font-weight:600',
			'background:rgba(34,113,177,0.10)',
			'color:#0a4b78',
			'white-space:nowrap',
		].join( ';' );
		cell.appendChild( chip );
	}
	return cell;
}

function buildStatsCell( row: UserListItem ): HTMLElement {
	const stats = row.desktop_mode_user_stats ?? {
		posts: 0,
		pages: 0,
		comments: 0,
	};
	const cell = document.createElement( 'span' );
	cell.style.cssText =
		'display:inline-flex;align-items:center;gap:10px;font-size:12px;font-variant-numeric:tabular-nums;';

	const mk = (
		dashicon: string,
		count: number,
		label: string,
	): HTMLElement => {
		const span = document.createElement( 'span' );
		span.style.cssText = 'display:inline-flex;align-items:center;gap:3px;';
		span.title = label;
		// `<wpd-icon>` works inside any shadow tree — the
		// table-cell shadow eats the document-level dashicons CSS,
		// which is why a bare `class="dashicons …"` span was
		// rendering blank in earlier cuts.
		const ic = document.createElement( 'wpd-icon' );
		ic.setAttribute( 'name', dashicon );
		ic.setAttribute( 'size', '14' );
		ic.style.color = 'var(--wp-admin-theme-fg-muted, #8c8f94)';
		span.appendChild( ic );
		const txt = document.createElement( 'span' );
		txt.textContent = String( count );
		if ( count === 0 ) {
			txt.style.color = 'var(--wp-admin-theme-fg-muted, #8c8f94)';
		}
		span.appendChild( txt );
		return span;
	};

	cell.appendChild( mk( 'admin-post', stats.posts, __( 'Posts' ) ) );
	cell.appendChild( mk( 'admin-page', stats.pages, __( 'Pages' ) ) );
	cell.appendChild(
		mk( 'admin-comments', stats.comments, __( 'Comments' ) ),
	);
	return cell;
}

function relativeTime( ts: number ): string {
	const now = Math.floor( Date.now() / 1000 );
	const delta = now - ts;
	if ( delta < 60 ) {
		return __( 'just now' );
	}
	if ( delta < 3600 ) {
		const m = Math.floor( delta / 60 );
		// translators: %d is a number of minutes.
		return sprintf( __( '%d min ago' ), m );
	}
	if ( delta < 86400 ) {
		const h = Math.floor( delta / 3600 );
		// translators: %d is a number of hours.
		return sprintf( __( '%d h ago' ), h );
	}
	if ( delta < 86400 * 30 ) {
		const d = Math.floor( delta / 86400 );
		// translators: %d is a number of days.
		return sprintf( __( '%d d ago' ), d );
	}
	if ( delta < 86400 * 365 ) {
		const mo = Math.floor( delta / ( 86400 * 30 ) );
		// translators: %d is a number of months.
		return sprintf( __( '%d mo ago' ), mo );
	}
	const y = Math.floor( delta / ( 86400 * 365 ) );
	// translators: %d is a number of years.
	return sprintf( __( '%d y ago' ), y );
}

function buildLastLoginCell( row: UserListItem ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'font-size:13px;font-variant-numeric:tabular-nums;';
	const ts = row.desktop_mode_last_login;
	if ( ! ts || typeof ts !== 'number' ) {
		cell.textContent = __( 'Never' );
		cell.style.color = 'var(--wp-admin-theme-fg-muted, #8c8f94)';
		return cell;
	}
	cell.textContent = relativeTime( ts );
	const dt = new Date( ts * 1000 );
	cell.title = dt.toLocaleString();
	return cell;
}

function buildRegisteredCell( row: UserListItem ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'font-size:13px;font-variant-numeric:tabular-nums;';
	const raw = typeof row.registered_date === 'string' ? row.registered_date : '';
	if ( ! raw ) {
		cell.textContent = '—';
		cell.style.color = 'var(--wp-admin-theme-fg-muted, #8c8f94)';
		return cell;
	}
	// `_fields=registered_date` returns the bare WP format
	// (`YYYY-MM-DDTHH:MM:SS`) in `view` context and an ISO-8601 string
	// with offset (`…+00:00`) in `edit` context. Only append `Z` when
	// no timezone suffix is present — otherwise `Date.parse` chokes on
	// the doubled tz and we'd fall through to the raw string.
	const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test( raw );
	const ts = Math.floor( Date.parse( hasTz ? raw : raw + 'Z' ) / 1000 );
	if ( ! Number.isFinite( ts ) ) {
		cell.textContent = raw;
		return cell;
	}
	cell.textContent = relativeTime( ts );
	cell.title = new Date( ts * 1000 ).toLocaleString();
	return cell;
}

function buildActionsCell(
	row: UserListItem,
	cfg: PostsWindowConfig,
	client: UsersWindowClient,
): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText =
		'display:inline-flex;gap:4px;align-items:center;';

	const canEditViewer = cfg.canEdit === true;
	const canEditRow = row.desktop_mode_can_edit === true;
	if ( ! canEditViewer || ! canEditRow ) {
		cell.textContent = '—';
		cell.style.color = 'var(--wp-admin-theme-fg-muted, #8c8f94)';
		return cell;
	}

	const mk = ( label: string, dashicon: string, fn: () => void ): HTMLElement => {
		const btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.title = label;
		btn.setAttribute( 'aria-label', label );
		Object.assign( btn.style, {
			appearance: 'none',
			border: '1px solid var(--wp-admin-theme-border, #dcdcde)',
			background: 'var(--wp-admin-theme-bg, #fff)',
			color: 'inherit',
			padding: '4px 6px',
			borderRadius: '4px',
			cursor: 'pointer',
			lineHeight: '1',
		} as Partial< CSSStyleDeclaration > );
		const ic = document.createElement( 'wpd-icon' );
		ic.setAttribute( 'name', dashicon );
		ic.setAttribute( 'size', '14' );
		btn.appendChild( ic );
		btn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			fn();
		} );
		return btn;
	};

	cell.appendChild(
		mk(
			__( 'Send password reset' ),
			'email-alt',
			async () => {
				const ok = await wpdConfirmGlobal( {
					title: __( 'Send password reset email?' ),
					message: sprintf(
						// translators: %s is a user name.
						__( 'WordPress will email %s a password-reset link.' ),
						row.name,
					),
					confirmLabel: __( 'Send reset email' ),
				} );
				if ( ! ok ) {
					return;
				}
				const result = await client.sendPasswordReset( row.id );
				if ( result.ok ) {
					notifyToast(
						sprintf(
							// translators: %s is the user's email address.
							__( 'Reset email sent to %s.' ),
							result.email ?? row.email ?? '',
						),
						{ kind: 'success' },
					);
				} else {
					notifyToast(
						sprintf(
							// translators: %s is an error code.
							__( 'Could not send reset email (%s).' ),
							result.error ?? 'unknown',
						),
						{ kind: 'error' },
					);
				}
			},
		),
	);
	cell.appendChild(
		mk(
			__( 'Resend welcome email' ),
			'megaphone',
			async () => {
				const ok = await wpdConfirmGlobal( {
					title: __( 'Resend welcome email?' ),
					message: sprintf(
						// translators: %s is a user name.
						__(
							'WordPress will resend the original welcome email to %s.',
						),
						row.name,
					),
					confirmLabel: __( 'Resend' ),
				} );
				if ( ! ok ) {
					return;
				}
				const result = await client.resendWelcome( row.id );
				if ( result.ok ) {
					notifyToast(
						sprintf(
							// translators: %s is the user's email address.
							__( 'Welcome email resent to %s.' ),
							result.email ?? row.email ?? '',
						),
						{ kind: 'success' },
					);
				} else {
					notifyToast(
						sprintf(
							// translators: %s is an error code.
							__( 'Could not resend welcome (%s).' ),
							result.error ?? 'unknown',
						),
						{ kind: 'error' },
					);
				}
			},
		),
	);
	return cell;
}

function buildColumns(
	cache: UserCellCache,
	cfg: PostsWindowConfig,
	client: UsersWindowClient,
): WpdTableColumn< UserListItem >[] {
	const cols: WpdTableColumn< UserListItem >[] = [
		{
			key: 'identity',
			label: __( 'Name' ),
			sortable: false,
			sticky: true,
			minWidth: '260px',
			render: ( _v, row ) =>
				memoUserCell( cache, row.id, 'identity', () =>
					buildIdentityCell( row, cfg ),
				),
		},
		{
			key: 'email',
			label: __( 'Email' ),
			minWidth: '220px',
			render: ( _v, row ) =>
				memoUserCell( cache, row.id, 'email', () => buildEmailCell( row ) ),
		},
		{
			key: 'role',
			label: __( 'Role' ),
			width: '180px',
			render: ( _v, row ) =>
				memoUserCell( cache, row.id, 'role', () =>
					buildRoleCell( row, cfg ),
				),
		},
		{
			key: 'stats',
			label: __( 'Content' ),
			width: '160px',
			sortValue: ( row ) => {
				const s = row.desktop_mode_user_stats;
				return s ? s.posts + s.pages + s.comments : 0;
			},
			render: ( _v, row ) =>
				memoUserCell( cache, row.id, 'stats', () => buildStatsCell( row ) ),
		},
		{
			key: 'last_login',
			label: __( 'Last login' ),
			width: '140px',
			sortable: false,
			sortValue: ( row ) =>
				typeof row.desktop_mode_last_login === 'number'
					? row.desktop_mode_last_login
					: 0,
			render: ( _v, row ) =>
				memoUserCell( cache, row.id, 'last_login', () =>
					buildLastLoginCell( row ),
				),
		},
		{
			key: 'registered',
			label: __( 'Registered' ),
			width: '140px',
			sortable: true,
			render: ( _v, row ) =>
				memoUserCell( cache, row.id, 'registered', () =>
					buildRegisteredCell( row ),
				),
		},
	];

	// Quick actions column — only shown when the viewer has any
	// edit cap; cell falls back to "—" per-row when the row's
	// `desktop_mode_can_edit` is false (e.g. self-row, or a higher-
	// privileged user).
	if ( cfg.canEdit === true ) {
		cols.push( {
			key: 'actions',
			label: __( 'Actions' ),
			width: '110px',
			sortable: false,
			render: ( _v, row ) =>
				// Actions cell is intentionally NOT memoized — its closure
				// captures `row` and the row payload changes between
				// fetches. Cheap to rebuild, fewer surprises.
				buildActionsCell( row, cfg, client ),
		} );
	}

	return cols;
}

// ─── Status segments + role filter ──────────────────────────────────

function defaultStatusSegments(): Array< { value: string; label: string } > {
	return [
		{ value: '', label: __( 'All' ) },
		{ value: 'online', label: __( 'Online' ) },
		{ value: 'recent', label: __( 'Active 30d' ) },
		{ value: 'never', label: __( 'Never logged in' ) },
	];
}

function applyClientStatusFilter(
	rows: UserListItem[],
	status: string,
): UserListItem[] {
	if ( ! status ) {
		return rows;
	}
	if ( status === 'online' ) {
		return rows.filter( ( r ) => r.desktop_mode_presence === 'online' );
	}
	if ( status === 'recent' ) {
		const now = Math.floor( Date.now() / 1000 );
		return rows.filter( ( r ) => {
			const ts = r.desktop_mode_last_login;
			return typeof ts === 'number' && ts > 0 && now - ts < 86400 * 30;
		} );
	}
	if ( status === 'never' ) {
		return rows.filter(
			( r ) =>
				! r.desktop_mode_last_login ||
				typeof r.desktop_mode_last_login !== 'number',
		);
	}
	return rows;
}

// ─── Render entry point ─────────────────────────────────────────────

export async function renderUsersWindow(
	body: HTMLElement,
	client: UsersWindowClient,
): Promise< void > {
	const root = body.querySelector< HTMLElement >( ROOT );
	const table = body.querySelector< WpdTable< UserListItem > >( TABLE );
	if ( ! root || ! table ) {
		return;
	}

	// Whole-row click → open a SEPARATE `desktop-mode-user-edit`
	// native window for THAT user. The Users window's own Profile
	// tab is reserved for the viewer's own profile and never
	// changes target, so editing other users gets its own
	// dedicated window. wpd-table fires `wpd-table-row-click` for
	// cell clicks outside `data-noclick` descendants (so the
	// row-checkbox / quick-action buttons keep their own behavior).
	table.addEventListener( 'wpd-table-row-click', ( e: Event ) => {
		const detail = ( e as CustomEvent< { row: UserListItem } > ).detail;
		const id = detail?.row?.id;
		if ( typeof id !== 'number' || id <= 0 ) {
			return;
		}
		void openUserEditWindow( id );
	} );

	maybeShowUsersIntro( client );

	const cfg = client.getConfig();
	const view: ViewState = {
		page: 1,
		perPage: Math.max( 1, cfg.defaultPerPage || 20 ),
		search: '',
		status: '',
		orderby: 'name',
		order: 'asc',
		roles: [],
		searchDebounce: null,
	};

	const cellCache: UserCellCache = new Map();

	table.columns = buildColumns( cellCache, cfg, client );
	table.getRowId = ( row ) => row.id;
	table.sort = { key: 'name', direction: 'asc' };

	// `selectable` attr was set via PHP (`selectable="multi"`) but the
	// row checkbox column only makes sense when the viewer can act on
	// rows. Read-only viewers (cap `list_users` only) get the attribute
	// stripped so the table paints without checkboxes.
	if ( ! cfg.canEdit && ! cfg.canPromote && ! cfg.canDelete ) {
		table.removeAttribute( 'selectable' );
	}

	let totalPages = 0;
	let totalRows = 0;
	let refreshSeq = 0;

	const perPageEl = root.querySelector< HTMLSelectElement >( PER_PAGE );
	if ( perPageEl ) {
		perPageEl.value = String( view.perPage );
	}

	const indicator = root.querySelector< HTMLElement >( PAGE_INDICATOR );
	const prevBtn = root.querySelector< HTMLButtonElement >( PREV );
	const nextBtn = root.querySelector< HTMLButtonElement >( NEXT );
	const bulkBar = root.querySelector< HTMLElement >( BULK );
	const countEl = root.querySelector< HTMLElement >( COUNT );
	const bulkActionsHost = root.querySelector< HTMLElement >( BULK_ACTIONS_HOST );
	const statusHost = root.querySelector< HTMLElement >( STATUS );

	// Status segments — Online / Recent / Never logged in.
	if ( statusHost ) {
		statusHost.replaceChildren();
		for ( const seg of defaultStatusSegments() ) {
			const el = document.createElement( 'wpd-segment' );
			el.setAttribute( 'value', seg.value );
			el.textContent = seg.label;
			statusHost.appendChild( el );
		}
		statusHost.addEventListener( 'wpd-segmented-change', ( e: Event ) => {
			const detail = ( e as CustomEvent< { value: string } > ).detail;
			view.status = detail?.value ?? '';
			view.page = 1;
			void refresh();
		} );
	}

	// Search box.
	const searchEl = root.querySelector< HTMLInputElement >( SEARCH );
	if ( searchEl ) {
		searchEl.addEventListener( 'input', () => {
			if ( view.searchDebounce !== null ) {
				clearTimeout( view.searchDebounce );
			}
			view.searchDebounce = window.setTimeout( () => {
				view.search = searchEl.value.trim();
				view.page = 1;
				void refresh();
			}, SEARCH_DEBOUNCE_MS );
		} );
	}

	// Refresh / Add new buttons.
	const refreshBtn = root.querySelector< HTMLButtonElement >( REFRESH );
	refreshBtn?.addEventListener( 'click', () => {
		void refresh();
	} );
	const newBtn = root.querySelector< HTMLButtonElement >( NEW_BTN );
	if ( newBtn ) {
		if ( ! cfg.canCreate ) {
			newBtn.style.display = 'none';
		} else {
			// "Add new" lives as the second tab in this very window —
			// no need to open user-new.php in a separate iframe.
			// Clicking the toolbar button switches the active tab so
			// the form is one click away without leaving the
			// All-users surface.
			newBtn.addEventListener( 'click', ( e ) => {
				e.preventDefault();
				const tabs = body.querySelector(
					'[data-desktop-mode-users-tabs]',
				) as ( HTMLElement & { value?: string } ) | null;
				if ( ! tabs ) {
					return;
				}
				tabs.value = 'add-new';
				tabs.setAttribute( 'value', 'add-new' );
			} );
		}
	}

	// Per-page select.
	perPageEl?.addEventListener( 'change', () => {
		const n = parseInt( perPageEl.value, 10 );
		if ( Number.isFinite( n ) && n > 0 ) {
			view.perPage = n;
			view.page = 1;
			void refresh();
		}
	} );

	// Bulk-action bar.
	const renderBulkBar = (): void => {
		if ( ! bulkBar || ! bulkActionsHost ) {
			return;
		}
		const sel = table.selection;
		const ids: number[] = sel ? ( Array.from( sel ) as number[] ) : [];
		if ( ids.length === 0 ) {
			bulkBar.hidden = true;
			return;
		}
		bulkBar.hidden = false;
		if ( countEl ) {
			countEl.textContent = sprintf(
				// translators: %d is a count of selected users.
				__( '%d selected' ),
				ids.length,
			);
		}
		bulkActionsHost.replaceChildren();

		// Bulk role-change menu — only when the viewer has
		// `promote_users` AND there's at least one assignable role.
		const assignable = cfg.assignableRoles ?? {};
		const assignableKeys = Object.keys( assignable );
		if ( cfg.canPromote && assignableKeys.length > 0 ) {
			const wrap = document.createElement( 'span' );
			wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';

			const roleDropdown = document.createElement( 'select' );
			Object.assign( roleDropdown.style, {
				padding: '4px 8px',
				borderRadius: '4px',
				border: '1px solid var(--wp-admin-theme-border, #dcdcde)',
				background: 'var(--wp-admin-theme-bg, #fff)',
				color: 'inherit',
				font: 'inherit',
				fontSize: '13px',
			} as Partial< CSSStyleDeclaration > );
			const placeholder = document.createElement( 'option' );
			placeholder.value = '';
			placeholder.textContent = __( 'Set role to…' );
			roleDropdown.appendChild( placeholder );
			for ( const slug of assignableKeys ) {
				const opt = document.createElement( 'option' );
				opt.value = slug;
				opt.textContent = assignable[ slug ];
				roleDropdown.appendChild( opt );
			}

			const apply = document.createElement( 'wpd-button' );
			apply.setAttribute( 'variant', 'primary' );
			apply.textContent = __( 'Apply' );
			apply.addEventListener( 'click', async ( e ) => {
				e.preventDefault();
				const role = roleDropdown.value;
				if ( ! role ) {
					return;
				}
				const ok = await wpdConfirmGlobal( {
					title: __( 'Change role for selected users?' ),
					message: sprintf(
						// translators: %1$d is a user count, %2$s is a role label.
						__( "Set %1$d user(s)' role to %2$s?" ),
						ids.length,
						assignable[ role ],
					),
					confirmLabel: __( 'Set role' ),
				} );
				if ( ! ok ) {
					return;
				}
				const out = await client.bulkSetRole( ids, role ).catch( ( err ) => {
					notifyToast(
						String( ( err as Error ).message ?? err ),
						{ kind: 'error' },
					);
					return null;
				} );
				if ( ! out ) {
					return;
				}
				const successes = Object.values( out.results ).filter(
					( r ) => r.ok,
				).length;
				const failures = ids.length - successes;
				if ( successes > 0 ) {
					notifyToast(
						sprintf(
							// translators: %1$d users updated, %2$d failed.
							__( 'Role updated for %1$d user(s) (%2$d skipped).' ),
							successes,
							failures,
						),
						{ kind: failures > 0 ? 'info' : 'success' },
					);
				} else {
					notifyToast( __( 'No users updated.' ), { kind: 'error' } );
				}
				void refresh();
			} );

			wrap.appendChild( roleDropdown );
			wrap.appendChild( apply );
			bulkActionsHost.appendChild( wrap );
		}
	};

	table.addEventListener( 'wpd-table-selection-change', renderBulkBar );

	prevBtn?.addEventListener( 'click', () => {
		if ( view.page > 1 ) {
			view.page -= 1;
			void refresh();
		}
	} );
	nextBtn?.addEventListener( 'click', () => {
		if ( view.page < totalPages ) {
			view.page += 1;
			void refresh();
		}
	} );

	const updatePager = (): void => {
		if ( indicator ) {
			indicator.textContent = sprintf(
				// translators: %1$d current page, %2$d total pages, %3$d total rows.
				__( 'Page %1$d of %2$d · %3$d users' ),
				view.page,
				Math.max( 1, totalPages ),
				totalRows,
			);
		}
		if ( prevBtn ) {
			prevBtn.disabled = view.page <= 1;
		}
		if ( nextBtn ) {
			nextBtn.disabled = view.page >= totalPages;
		}
	};

	const buildParams = (): UsersListParams => {
		return {
			page: view.page,
			perPage: view.perPage,
			search: view.search || undefined,
			roles: view.roles.length > 0 ? view.roles : undefined,
			orderby: view.orderby,
			order: view.order,
		};
	};

	const refresh = async (): Promise< void > => {
		const mySeq = ++refreshSeq;
		table.toggleAttribute( 'loading', true );
		try {
			const result = await client.fetchUsers( buildParams() );
			if ( mySeq !== refreshSeq ) {
				return;
			}
			if (
				result.items.length === 0 &&
				view.page > 1 &&
				result.totalPages > 0 &&
				view.page > result.totalPages
			) {
				view.page = 1;
				await refresh();
				return;
			}
			cellCache.clear();
			// Status segments are client-side filters (presence + last-login
			// computed) so we apply them after the fetch lands.
			const filtered = applyClientStatusFilter( result.items, view.status );
			table.data = filtered;
			totalRows = result.total;
			totalPages = result.totalPages;
			updatePager();
			renderBulkBar();
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( '[users-window] fetch failed:', err );
			notifyToast(
				__( 'Could not load users. Try Refresh.' ),
				{ kind: 'error' },
			);
		} finally {
			table.toggleAttribute( 'loading', false );
		}
	};

	// Add User form — mounted when the user activates the "add-new"
	// tab. The form lives in the PHP template; we wire submit /
	// reset / generate-password / role+locale dropdowns here.
	mountAddUserForm( body, client, cfg, {
		afterCreate: () => {
			// Reset the create form and bounce back to the all-users
			// tab so the new user shows up in the list.
			const tabs = body.querySelector(
				'[data-desktop-mode-users-tabs]',
			) as ( HTMLElement & { value?: string } ) | null;
			if ( tabs ) {
				tabs.value = 'all';
				tabs.setAttribute( 'value', 'all' );
			}
			view.page = 1;
			void refresh();
		},
	} );

	// Profile sub-tab — wired here so the row-click → set target →
	// switch tab → mount edit form flow lives in the same module
	// as the table itself. Lazy-imports the edit module the first
	// time a profile is requested.
	wireProfileSubTab( body, cfg );

	// Live refresh on `desktop-mode.user.changed` — fires when the
	// User-edit window saves a profile. We patch ONLY the affected
	// rows in place via `fetchOneUser`; a full `refresh()` would
	// clear the cell cache, reset scroll, and flicker the table for
	// every other row that didn't change.
	const patchUserRow = async ( id: number ): Promise< void > => {
		try {
			const updated = await client.fetchOneUser( id );
			const list = table.data as readonly UserListItem[];
			const idx = list.findIndex( ( r ) => r.id === id );
			if ( idx < 0 ) {
				// User isn't on the current page (filtered/paged out) —
				// nothing to repaint.
				return;
			}
			if ( ! updated ) {
				// Row went away (deleted). Drop it locally; a full
				// pager update would need totalRows decrement, but a
				// stale missing row is more disruptive than a slightly
				// off count until the next list fetch.
				const next = list.slice();
				next.splice( idx, 1 );
				table.data = next;
				return;
			}
			// Invalidate cached cells for this id so the table rebuilds
			// them from the new payload (role chip, email, registered
			// date, last-login dot, …).
			for ( const k of Array.from( cellCache.keys() ) ) {
				if ( k.startsWith( `${ id }::` ) ) {
					cellCache.delete( k );
				}
			}
			const next = list.slice();
			next[ idx ] = updated;
			// Re-apply the active status filter so a row that no longer
			// matches (e.g. presence flipped offline while "Online" is
			// selected) doesn't linger.
			table.data = applyClientStatusFilter( next, view.status );
		} catch ( err ) {
			// Non-fatal — log and fall back to a full refresh so the
			// user doesn't end up looking at a stale row.
			// eslint-disable-next-line no-console
			console.warn( '[users-window] row patch failed, falling back to refresh', err );
			void refresh();
		}
	};

	const subscribeApi = (
		window as unknown as {
			wp?: {
				desktop?: {
					subscribe?: (
						channel: string,
						handler: ( payload: unknown ) => void,
					) => () => void;
				};
			};
		}
	).wp?.desktop;
	const unsubscribe = subscribeApi?.subscribe?.(
		'desktop-mode.user.changed',
		( payload: unknown ) => {
			const ids = ( payload as { ids?: unknown } )?.ids;
			if ( ! Array.isArray( ids ) ) {
				return;
			}
			for ( const raw of ids ) {
				const id = typeof raw === 'number' ? raw : Number( raw );
				if ( Number.isFinite( id ) && id > 0 ) {
					void patchUserRow( id );
				}
			}
		},
	);
	if ( unsubscribe ) {
		document.addEventListener(
			'desktop-mode-window-closed',
			( e: Event ) => {
				const detail = ( e as CustomEvent< { windowId?: string } > )
					.detail;
				if ( detail?.windowId === 'desktop-mode-users' ) {
					unsubscribe();
				}
			},
			{ once: false },
		);
	}

	// Initial fetch.
	void refresh();
}

/**
 * Wire the in-window Profile tab to the viewer's own user id.
 *
 * The tab template is just `<wpd-user-profile>` — set its
 * `user-id` attribute once and the component takes it from there
 * (lazy-loads, fetches, mounts the full surface). Editing OTHER
 * users opens a separate `desktop-mode-user-edit` window via
 * row click.
 */
function wireProfileSubTab(
	body: HTMLElement,
	cfg: PostsWindowConfig,
): void {
	const profile = body.querySelector(
		'wpd-user-profile[data-wpd-user-profile-self]',
	) as HTMLElement | null;
	if ( ! profile ) {
		return;
	}
	const viewerId = ( cfg as unknown as { currentUserId?: number } )
		.currentUserId;
	if ( typeof viewerId === 'number' && viewerId > 0 ) {
		profile.setAttribute( 'user-id', String( viewerId ) );
	}
}

// ─── Add User form ──────────────────────────────────────────────────

interface AddUserFormOpts {
	afterCreate(): void;
}

/**
 * `<wpd-form>` element with the public methods we use here. Cast the
 * raw DOM node to this shape so callers don't need a Component-class
 * import inside this feature module.
 */
interface WpdFormElement extends HTMLElement {
	getValues(): Record< string, unknown >;
	setBusy( busy: boolean ): void;
	setError( message: string | null ): void;
	setFieldInvalid(
		name: string,
		invalid?: boolean,
		message?: string | null,
	): void;
	clearErrors(): void;
}

/**
 * Wire up the `<wpd-form>` rendered by `window.php` when the user
 * has `create_users`. The form does the heavy lifting (validation,
 * value collection, busy state, error banner, responsive layout);
 * this function only:
 *
 *   1. populates the runtime-driven `role` + `locale` selects,
 *   2. wires the bespoke "Generate strong password" button,
 *   3. listens for `wpd-form-submit` and posts to the create
 *      endpoint, mapping common server errors to per-field invalid
 *      flags so the UX is "the email field lights up", not "a
 *      banner says try again."
 *
 * Idempotent — safe to call on every render.
 *
 * @since 0.18.0
 */
function mountAddUserForm(
	body: HTMLElement,
	client: UsersWindowClient,
	cfg: PostsWindowConfig,
	opts: AddUserFormOpts,
): void {
	const formNullable = body.querySelector(
		'[data-desktop-mode-users-add-form]',
	) as WpdFormElement | null;
	if ( ! formNullable ) {
		return;
	}
	// Capture as a non-nullable const so closures (mountSelect /
	// onSubmit / event listeners) keep the narrowed type without
	// TS losing it across nested function declarations.
	const form: WpdFormElement = formNullable;

	const defaultRole = cfg.defaultRole ?? 'subscriber';

	// ── Mount the role + locale `<wpd-select>`s. They're built JS-side
	// because their option lists come from the runtime config blob,
	// not from PHP literals.
	const assignableRoles =
		cfg.assignableRoles && Object.keys( cfg.assignableRoles ).length > 0
			? cfg.assignableRoles
			: { [ defaultRole ]: defaultRole };
	mountSelect( form, 'role', __( 'Role' ), assignableRoles, defaultRole );
	mountSelect(
		form,
		'locale',
		__( 'Language' ),
		cfg.locales ?? { '': __( 'Site default' ) },
		'',
	);

	// ── "Generate strong password" — bespoke button, lives outside
	// the wpd-form's auto-collected fields (it's an action, not data).
	const generateBtn = form.querySelector< HTMLElement >(
		'[data-action="generate-password"]',
	);
	generateBtn?.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		const pwd = generateStrongPassword( 18 );
		const pwdField = form.querySelector< HTMLElement & { value?: string } >(
			'wpd-text-field[name="password"]',
		);
		if ( pwdField ) {
			pwdField.value = pwd;
			pwdField.setAttribute( 'value', pwd );
		}
		void navigator.clipboard?.writeText( pwd ).catch( () => {} );
		notifyToast( __( 'Generated password copied to clipboard.' ), {
			kind: 'success',
		} );
	} );

	// ── Submit handler. The form has already validated `required`
	// fields by the time this fires, so we just normalize the payload
	// and POST.
	let pending = false;
	form.addEventListener( 'wpd-form-submit', ( e ) => {
		const detail = ( e as CustomEvent< { values: Record< string, unknown > } > )
			.detail;
		void onSubmit( detail.values );
	} );

	async function onSubmit( values: Record< string, unknown > ): Promise< void > {
		if ( pending ) {
			return;
		}
		pending = true;
		form.setBusy( true );
		form.clearErrors();

		const payload: CreateUserBody = {
			username: String( values.username ?? '' ).trim(),
			email: String( values.email ?? '' ).trim(),
			first_name: optionalString( values.first_name ),
			last_name: optionalString( values.last_name ),
			url: optionalString( values.url ),
			locale: String( values.locale ?? '' ),
			password: optionalString( values.password ),
			role: optionalString( values.role ),
			send_notification: Boolean( values.send_notification ),
		};

		const result = await client.createUser( payload );
		pending = false;
		form.setBusy( false );

		if ( ! result.ok ) {
			handleCreateError( form, result.error, result.message, payload );
			return;
		}

		notifyToast(
			sprintf(
				// translators: %s is the user's email address.
				__( 'User created — welcome email sent to %s.' ),
				result.email ?? payload.email,
			),
			{ kind: 'success' },
		);
		opts.afterCreate();
	}
}

/**
 * Populate a `<wpd-select name=...>` declared in the PHP template
 * with options from `optionsMap`. The element itself is rendered
 * server-side so it upgrades alongside the rest of the form; we
 * only inject the runtime-driven option list.
 *
 * Uses the canonical `<wpd-select>.items` setter — appending
 * `<wpd-option>` children manually races the connect-time render
 * (the component's MutationObserver fires on a later microtask),
 * which is exactly what we hit on the first cut: the dropdown
 * rendered with no options.
 *
 * The unused `_label` parameter keeps the call-sites self-documenting
 * — the PHP template carries the visible label, but reading the
 * intended label at the call site makes the JS easier to follow.
 */
interface WpdSelectElement extends HTMLElement {
	items: ReadonlyArray< { value: string; label: string } >;
	value: string;
}

function mountSelect(
	form: HTMLElement,
	name: string,
	_label: string,
	optionsMap: Record< string, string >,
	initialValue: string,
): void {
	const select = form.querySelector< WpdSelectElement >(
		`wpd-select[name="${ name }"]`,
	);
	if ( ! select ) {
		return;
	}
	const items = Object.entries( optionsMap ).map( ( [ value, label ] ) => ( {
		value,
		label,
	} ) );
	select.items = items;
	if ( initialValue && optionsMap[ initialValue ] !== undefined ) {
		select.value = initialValue;
		select.setAttribute( 'value', initialValue );
	}
}

/**
 * Map server-side error codes to per-field invalid flags + a
 * top-of-form summary. The banner says what's wrong; the highlighted
 * field tells the user where to look.
 */
function handleCreateError(
	form: WpdFormElement,
	code: string | undefined,
	message: string | undefined,
	payload: CreateUserBody,
): void {
	let summary = message;
	if ( ! summary ) {
		switch ( code ) {
			case 'desktop_mode_users_username_exists':
			case 'existing_user_login':
				summary = __( 'That username is already in use.' );
				break;
			case 'desktop_mode_users_email_exists':
			case 'existing_user_email':
				summary = __( 'That email is already in use.' );
				break;
			case 'desktop_mode_users_username_invalid':
				summary = __( 'Username is not valid.' );
				break;
			case 'desktop_mode_users_email_invalid':
				summary = __( 'A valid email address is required.' );
				break;
			case 'desktop_mode_users_role_forbidden':
				summary = __( 'You are not allowed to assign that role.' );
				break;
			default:
				summary = __( 'Could not create the user.' );
		}
	}
	form.setError( summary );
	if (
		code === 'desktop_mode_users_username_exists' ||
		code === 'existing_user_login' ||
		code === 'desktop_mode_users_username_invalid'
	) {
		form.setFieldInvalid( 'username' );
	}
	if (
		code === 'desktop_mode_users_email_exists' ||
		code === 'existing_user_email' ||
		code === 'desktop_mode_users_email_invalid'
	) {
		form.setFieldInvalid( 'email' );
	}
	if ( code === 'desktop_mode_users_role_forbidden' ) {
		form.setFieldInvalid( 'role' );
	}
	notifyToast( summary, { kind: 'error' } );
	// Surface a debugging breadcrumb so a curious dev can correlate
	// a "could not create" toast with the actual server response.
	// eslint-disable-next-line no-console
	console.warn( '[users-window] create failed', { code, payload } );
}

function optionalString( value: unknown ): string | undefined {
	if ( typeof value !== 'string' ) {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

/**
 * Strong-password generator. Mirrors WP core's `wp_generate_password`
 * default character set with symbols enabled. Used by the Add User
 * form's "Generate strong password" button.
 *
 * @since 0.18.0
 */
function generateStrongPassword( length: number ): string {
	const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
	const lower = 'abcdefghjkmnpqrstuvwxyz';
	const digits = '23456789';
	const symbols = '!@#$%^&*-_=+';
	const all = upper + lower + digits + symbols;
	const buf = new Uint32Array( length );
	crypto.getRandomValues( buf );
	let out = '';
	for ( let i = 0; i < length; i += 1 ) {
		out += all[ buf[ i ] % all.length ];
	}
	return out;
}
