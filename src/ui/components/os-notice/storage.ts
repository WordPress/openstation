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

	}
	return {};
}

function writeMap( map: Record< string, true > ): void {
	try {
		window.localStorage.setItem( storageKey(), JSON.stringify( map ) );
	} catch {

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

export function _resetNoticeDismissalsForTests(): void {
	try {
		window.localStorage.removeItem( storageKey() );
	} catch {

	}
}
