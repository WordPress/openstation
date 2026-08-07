/**
 * Per-user dismissal storage for `<os-notice>`.
 *
 * Notices that carry a `notice-id` record their dismissal in
 * `localStorage` under a per-user key so the same user never sees the
 * same dismissed banner twice across reloads. The key includes the
 * current user id (read from `wp.os.config.currentUserId` on
 * first read) so a shared browser doesn't carry one user's
 * dismissals into another's session. When the id is unavailable
 * (logged-out, pre-hydration) we fall back to `anon`.
 */

const KEY_PREFIX = 'desktop-mode-notice-dismissed';

interface MaybeWpDesktop {
	os?: { config?: { currentUserId?: number } };
}

function currentUserSuffix(): string {
	const w = ( window as unknown as { wp?: MaybeWpDesktop } ).wp;
	const uid = w?.os?.config?.currentUserId;
	if ( typeof uid === 'number' && uid > 0 ) {
		return String( uid );
	}
	return 'anon';
}

function storageKey(): string {
	return `${ KEY_PREFIX }:${ currentUserSuffix() }`;
}

function readMap(): Record< string, true > {
	try {
		const raw = window.localStorage.getItem( storageKey() );
		if ( ! raw ) {
			return {};
		}
		const parsed = JSON.parse( raw ) as unknown;
		if ( parsed && typeof parsed === 'object' && ! Array.isArray( parsed ) ) {
			return parsed as Record< string, true >;
		}
	} catch {
		// localStorage may be disabled (Safari private mode, quota
		// exceeded, etc.) — fall through to the empty map. A notice
		// that can't persist still shows once per page load.
	}
	return {};
}

function writeMap( map: Record< string, true > ): void {
	try {
		window.localStorage.setItem( storageKey(), JSON.stringify( map ) );
	} catch {
		// Same rationale as readMap — silently no-op when storage
		// isn't writable.
	}
}

export function isNoticeDismissed( id: string ): boolean {
	if ( ! id ) {
		return false;
	}
	return readMap()[ id ] === true;
}

export function markNoticeDismissed( id: string ): void {
	if ( ! id ) {
		return;
	}
	const map = readMap();
	map[ id ] = true;
	writeMap( map );
}

export function clearNoticeDismissed( id: string ): void {
	if ( ! id ) {
		return;
	}
	const map = readMap();
	if ( map[ id ] ) {
		delete map[ id ];
		writeMap( map );
	}
}

/**
 * Test-only escape hatch — drops every dismissal record for the
 * current user.
 *
 * @internal
 */
export function _resetNoticeDismissalsForTests(): void {
	try {
		window.localStorage.removeItem( storageKey() );
	} catch {
		// no-op
	}
}
