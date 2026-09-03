/**
 * Users app — the table: the column descriptors, the cell renderers,
 * the presence filter and its client-side slice.
 *
 * Cells render inside `<os-table>`'s shadow DOM, which document
 * stylesheets never reach, so they carry inline styles. Every
 * cap-gated affordance reads `ctx.extra` (`canEdit`, …) AND the
 * per-row `openstation_can_edit` flag; the flags are UX hints — the
 * server re-checks every action.
 */

import { __ } from '@openstation/app';
import { isMobileStamped } from '../../../src/mode/stamp';
import { applyAvatarSrc } from '../../../src/ui/util/avatar-resolve';
import { openUserEditWindow } from '../../../src/open-targets/user-edit-window';
import '../../../src/ui/components/os-avatar/os-avatar';
import '../../../src/ui/components/os-icon/os-icon';
import type { OsTableColumn } from '../../../src/ui/components/os-table/os-table';
import { relativeTime, toast } from './profile-client';
import type { ProfileConfig, UserListItem } from './types';

/** The presence filter above the table — a client-side slice of the page. */
export const STATUS_SEGMENTS = (): Array< { value: string; label: string } > => [
	{ value: '', label: __( 'All' ) },
	{ value: 'online', label: __( 'Online' ) },
	{ value: 'recent', label: __( 'Active 30d' ) },
	{ value: 'never', label: __( 'Never logged in' ) },
];

export function applyStatusFilter( rows: UserListItem[], status: string ): UserListItem[] {
	if ( status === 'online' ) {
		return rows.filter( ( r ) => r.openstation_presence === 'online' );
	}
	if ( status === 'recent' ) {
		const now = Math.floor( Date.now() / 1000 );
		return rows.filter( ( r ) => {
			const ts = r.openstation_last_login;
			return typeof ts === 'number' && ts > 0 && now - ts < 86400 * 30;
		} );
	}
	if ( status === 'never' ) {
		return rows.filter( ( r ) => typeof r.openstation_last_login !== 'number' || ! r.openstation_last_login );
	}
	return rows;
}

/** The columns a phone shows — a card per row, labelled lines under the name. */
const MOBILE_COLUMN_KEYS = new Set< string >( [ 'identity', 'email', 'role', 'last_login', 'actions' ] );

/**
 * Per-(rowId, columnKey) cell-node cache, so selection / pagination
 * repaints don't rebuild every avatar image (the avatar blink).
 */
export type UserCellCache = Map< string, Node >;

function memo( cache: UserCellCache, id: number, key: string, build: () => Node ): Node {
	const k = `${ id }::${ key }`;
	const cached = cache.get( k );
	if ( cached ) {
		return cached;
	}
	const node = build();
	cache.set( k, node );
	return node;
}

/** Drop the cached cells of one row — its payload changed. */
export function forgetRow( cache: UserCellCache, id: number ): void {
	for ( const k of Array.from( cache.keys() ) ) {
		if ( k.startsWith( `${ id }::` ) ) {
			cache.delete( k );
		}
	}
}

export interface RowActions {
	onSendReset: ( row: UserListItem ) => void;
	onResendWelcome: ( row: UserListItem ) => void;
}

const MUTED = 'var(--os-ui-fg-muted, #8c8f94)';

function buildIdentityCell( row: UserListItem, cfg: ProfileConfig ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:0;';

	// Presence is authoritative from the REST row (it already includes
	// the per-user heartbeat) — no `user-id` auto-subscribe here.
	const avatar = document.createElement( 'os-avatar' );
	avatar.setAttribute( 'size', '32' );
	if ( row.name ) {
		avatar.setAttribute( 'name', row.name );
	}
	avatar.setAttribute( 'presence', row.openstation_presence ?? 'offline' );
	const avatars = row.avatar_urls ?? {};
	const rawAvatar = avatars[ '48' ] ?? avatars[ '96' ] ?? avatars[ '24' ] ?? '';
	if ( rawAvatar ) {
		applyAvatarSrc( avatar, rawAvatar );
	}
	cell.appendChild( avatar );

	const text = document.createElement( 'span' );
	text.style.cssText = 'display:flex;flex-direction:column;min-width:0;line-height:1.25;';
	const name = document.createElement( 'a' );
	name.href = `${ cfg.editPostUrlBase ?? '' }?user_id=${ row.id }`;
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
		openProfile( row.id );
	} );
	text.appendChild( name );
	if ( row.slug ) {
		const sub = document.createElement( 'span' );
		sub.textContent = `@${ row.slug }`;
		sub.style.cssText = `font-size:11px;color:${ MUTED };white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;`;
		text.appendChild( sub );
	}
	cell.appendChild( text );
	return cell;
}

/** Open the User Edit window on this person; say so when the door is missing. */
export function openProfile( userId: number ): void {
	openUserEditWindow( userId, {
		source: 'users-window/row-click',
		fallback: () => {
			// eslint-disable-next-line no-console
			console.error( '[users] openWindow("desktop-mode-user-edit") returned false — window not registered server-side.' );
			toast( __( 'Profile window not registered — see console.' ), 'error' );
		},
	} );
}

function buildEmailCell( row: UserListItem ): HTMLElement {
	const cell = document.createElement( 'button' );
	cell.type = 'button';
	const email = typeof row.email === 'string' ? row.email : '';
	cell.textContent = email || '—';
	cell.disabled = email === '';
	cell.title = email ? __( 'Click to copy email' ) : '';
	cell.style.cssText = [
		'appearance:none',
		'background:transparent',
		'border:none',
		'padding:2px 6px',
		'font:inherit',
		'color:inherit',
		`cursor:${ email ? 'copy' : 'default' }`,
		'text-align:left',
		'font-size:13px',
		'border-radius:4px',
		'max-width:100%',
		'overflow:hidden',
		'text-overflow:ellipsis',
		'white-space:nowrap',
	].join( ';' );
	cell.addEventListener( 'click', ( e ) => {
		e.stopPropagation();
		if ( ! email ) {
			return;
		}
		void navigator.clipboard
			?.writeText( email )
			.then( () => {
				cell.textContent = __( 'Copied!' );
				cell.style.color = 'var(--wp-admin-theme-color, #2271b1)';
				setTimeout( () => {
					cell.textContent = email;
					cell.style.color = '';
				}, 1200 );
			} )
			.catch( () => undefined );
	} );
	return cell;
}

function buildRoleCell( row: UserListItem, cfg: ProfileConfig ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'display:inline-flex;flex-wrap:wrap;gap:4px;min-width:0;';
	const roles = Array.isArray( row.roles ) ? row.roles : [];
	if ( roles.length === 0 ) {
		const none = document.createElement( 'span' );
		none.textContent = __( 'No role' );
		none.style.cssText = `color:${ MUTED };font-style:italic;`;
		cell.appendChild( none );
		return cell;
	}
	const labels = cfg.allRoles ?? {};
	for ( const slug of roles ) {
		const chip = document.createElement( 'span' );
		chip.textContent = labels[ slug ] ?? slug;
		chip.style.cssText =
			'display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:rgba(34,113,177,0.10);color:#0a4b78;white-space:nowrap;';
		cell.appendChild( chip );
	}
	return cell;
}

function buildStatsCell( row: UserListItem ): HTMLElement {
	const stats = row.openstation_user_stats ?? { posts: 0, pages: 0, comments: 0 };
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'display:inline-flex;align-items:center;gap:10px;font-size:12px;font-variant-numeric:tabular-nums;';
	const mk = ( dashicon: string, count: number, label: string ): HTMLElement => {
		const span = document.createElement( 'span' );
		span.style.cssText = 'display:inline-flex;align-items:center;gap:3px;';
		span.title = label;
		// `<os-icon>` works inside any shadow tree — a bare dashicons
		// class renders blank in the table cell's shadow.
		const ic = document.createElement( 'os-icon' );
		ic.setAttribute( 'name', dashicon );
		ic.setAttribute( 'size', '14' );
		ic.style.color = MUTED;
		const txt = document.createElement( 'span' );
		txt.textContent = String( count );
		if ( count === 0 ) {
			txt.style.color = MUTED;
		}
		span.append( ic, txt );
		return span;
	};
	cell.append(
		mk( 'admin-post', stats.posts, __( 'Posts' ) ),
		mk( 'admin-page', stats.pages, __( 'Pages' ) ),
		mk( 'admin-comments', stats.comments, __( 'Comments' ) ),
	);
	return cell;
}

function buildLastLoginCell( row: UserListItem ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'font-size:13px;font-variant-numeric:tabular-nums;';
	const ts = row.openstation_last_login;
	if ( ! ts || typeof ts !== 'number' ) {
		cell.textContent = __( 'Never' );
		cell.style.color = MUTED;
		return cell;
	}
	cell.textContent = relativeTime( ts );
	cell.title = new Date( ts * 1000 ).toLocaleString();
	return cell;
}

function buildRegisteredCell( row: UserListItem ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'font-size:13px;font-variant-numeric:tabular-nums;';
	const raw = typeof row.registered_date === 'string' ? row.registered_date : '';
	if ( ! raw ) {
		cell.textContent = '—';
		cell.style.color = MUTED;
		return cell;
	}
	// `edit` context returns an ISO string with offset; only append
	// `Z` when no zone suffix is present.
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

function buildActionsCell( row: UserListItem, cfg: ProfileConfig, actions: RowActions ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText = 'display:inline-flex;gap:4px;align-items:center;';
	if ( cfg.canEdit !== true || row.openstation_can_edit !== true ) {
		cell.textContent = '—';
		cell.style.color = MUTED;
		return cell;
	}
	const mk = ( label: string, dashicon: string, fn: () => void ): HTMLElement => {
		const btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.title = label;
		btn.setAttribute( 'aria-label', label );
		// Palette tokens — `--wp-admin-theme-*` names fell back to
		// light literals on every dark desktop theme.
		btn.style.cssText =
			'appearance:none;border:1px solid var(--os-ui-border, #dcdcde);background:var(--os-ui-btn-bg, #fff);color:inherit;padding:4px 6px;border-radius:4px;cursor:pointer;line-height:1;';
		const ic = document.createElement( 'os-icon' );
		ic.setAttribute( 'name', dashicon );
		ic.setAttribute( 'size', '14' );
		btn.appendChild( ic );
		btn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			fn();
		} );
		return btn;
	};
	cell.append(
		mk( __( 'Send password reset' ), 'email-alt', () => actions.onSendReset( row ) ),
		mk( __( 'Resend welcome email' ), 'megaphone', () => actions.onResendWelcome( row ) ),
	);
	return cell;
}

/** The column descriptors, for a desk or a phone. */
export function buildColumns(
	cache: UserCellCache,
	cfg: ProfileConfig,
	actions: RowActions,
	phone: boolean = isMobileStamped(),
): OsTableColumn< UserListItem >[] {
	const cols: OsTableColumn< UserListItem >[] = [
		{
			key: 'identity',
			label: __( 'Name' ),
			sortable: false,
			sticky: true,
			minWidth: '260px',
			render: ( _v, row ) => memo( cache, row.id, 'identity', () => buildIdentityCell( row, cfg ) ),
		},
		{
			key: 'email',
			label: __( 'Email' ),
			minWidth: '220px',
			render: ( _v, row ) => memo( cache, row.id, 'email', () => buildEmailCell( row ) ),
		},
		{
			key: 'role',
			label: __( 'Role' ),
			width: '180px',
			render: ( _v, row ) => memo( cache, row.id, 'role', () => buildRoleCell( row, cfg ) ),
		},
		{
			key: 'stats',
			label: __( 'Content' ),
			width: '160px',
			sortValue: ( row ) => {
				const s = row.openstation_user_stats;
				return s ? s.posts + s.pages + s.comments : 0;
			},
			render: ( _v, row ) => memo( cache, row.id, 'stats', () => buildStatsCell( row ) ),
		},
		{
			key: 'last_login',
			label: __( 'Last login' ),
			width: '140px',
			sortable: false,
			sortValue: ( row ) => ( typeof row.openstation_last_login === 'number' ? row.openstation_last_login : 0 ),
			render: ( _v, row ) => memo( cache, row.id, 'last_login', () => buildLastLoginCell( row ) ),
		},
		{
			key: 'registered',
			label: __( 'Registered' ),
			width: '140px',
			sortable: true,
			render: ( _v, row ) => memo( cache, row.id, 'registered', () => buildRegisteredCell( row ) ),
		},
	];
	// Quick actions — only when the viewer has any edit cap; the cell
	// falls back to "—" per row when `openstation_can_edit` is false.
	// Not memoised: its closure captures `row`, which changes between
	// fetches — cheap to rebuild, fewer surprises.
	if ( cfg.canEdit === true ) {
		cols.push( {
			key: 'actions',
			label: __( 'Actions' ),
			stack: 'actions',
			width: '110px',
			sortable: false,
			render: ( _v, row ) => buildActionsCell( row, cfg, actions ),
		} );
	}
	return phone ? cols.filter( ( col ) => MOBILE_COLUMN_KEYS.has( col.key ) ) : cols;
}
