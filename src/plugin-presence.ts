import { __ } from './i18n';
import { showToast } from './toast';
import { trackedFetch } from './tracked-fetch';
import { joinRestUrl } from './rest-url';
import { createSharedStore } from './shared-store';
import { leaveForClassicAdmin, LEAVE_DELAY_MS } from './exit-openstation';

const NONCE_FIELD = 'desktop_mode_nonces';

const NAMESPACE_PATH = 'desktop-mode/v1';

const CONFIRM_COOLDOWN_MS = 30_000;

const MAX_NEGATIVE_CONFIRMS = 3;

interface PresenceState {
	confirmInFlight: boolean;

	lastConfirmAt: number | null;
	exiting: boolean;
	booted: boolean;
	negativeConfirms: number;
}

const store = createSharedStore< PresenceState >(
	'desktop-mode/plugin-presence',
	() => ( {
		confirmInFlight: false,
		lastConfirmAt: null,
		exiting: false,
		booted: false,
		negativeConfirms: 0,
	} ),
);

interface ShellConfig {
	adminUrl?: string;
	restUrl?: string;
}

function readConfig(): ShellConfig {
	return (
		( window as unknown as { wp?: { os?: { config?: ShellConfig } } } ).wp
			?.os?.config ?? {}
	);
}

function adminPath(): string {
	const raw = readConfig().adminUrl || '/wp-admin/';
	let path: string;
	try {
		path = new URL( raw, window.location.href ).pathname;
	} catch {
		path = '/wp-admin/';
	}
	return path.endsWith( '/' ) ? path : `${ path }/`;
}

function namespaceUrl(): string | null {
	const root = readConfig().restUrl;
	if ( ! root ) {
		return null;
	}
	return joinRestUrl( root, NAMESPACE_PATH );
}

function noteStillPresent(): void {
	store.state.negativeConfirms = 0;
}

async function confirmAbsence(): Promise< void > {
	const s = store.state;
	if ( s.exiting || s.confirmInFlight ) {
		return;
	}
	if ( s.negativeConfirms >= MAX_NEGATIVE_CONFIRMS ) {
		return;
	}
	const url = namespaceUrl();
	if ( ! url ) {
		return;
	}
	const now = Date.now();
	if ( s.lastConfirmAt !== null && now - s.lastConfirmAt < CONFIRM_COOLDOWN_MS ) {
		return;
	}
	s.lastConfirmAt = now;
	s.confirmInFlight = true;
	try {
		const res = await trackedFetch(
			url,
			{ credentials: 'same-origin' },
			{ silent: true, source: 'desktop-mode/plugin-presence' },
		);
		if ( res.status !== 404 ) {
			s.negativeConfirms += 1;
			return;
		}

		const body = ( await res.json() ) as { code?: string } | null;
		if ( body?.code !== 'rest_no_route' ) {
			s.negativeConfirms += 1;
			return;
		}
		exitToClassicAdmin();
	} catch {

	} finally {
		s.confirmInFlight = false;
	}
}

function exitToClassicAdmin(): void {
	if ( store.state.exiting ) {
		return;
	}
	store.state.exiting = true;

	leaveForClassicAdmin( readConfig().adminUrl || '' );

	try {
		showToast( {
			message: __(
				'OpenStation is no longer active. Returning to the WordPress dashboard…',
			),
			duration: LEAVE_DELAY_MS,
		} );
	} catch {

	}
}

export function noteFrameLoaded( frame: HTMLIFrameElement ): void {
	if ( store.state.exiting ) {
		return;
	}
	let doc: Document | null = null;
	try {
		doc = frame.contentDocument;
	} catch {
		return;
	}
	if ( ! doc?.body || ! doc.location ) {
		return;
	}

	if ( ! doc.location.pathname.startsWith( adminPath() ) ) {
		return;
	}
	if ( doc.body.classList.contains( 'os-chromeless' ) ) {
		noteStillPresent();
		return;
	}
	void confirmAbsence();
}

interface JQueryLike {
	( selector: Document ): {
		on: ( event: string, handler: ( ...args: unknown[] ) => void ) => void;
	};
}

export function bootPluginPresenceWatch(): void {
	if ( store.state.booted ) {
		return;
	}
	store.state.booted = true;
	const $ = ( window as unknown as { jQuery?: JQueryLike } ).jQuery;
	if ( ! $ ) {
		return;
	}
	$( document ).on( 'heartbeat-tick', ( ...args: unknown[] ) => {
		const response = args[ 1 ] as Record< string, unknown > | undefined;
		if ( ! response ) {
			return;
		}
		if ( response[ NONCE_FIELD ] !== undefined ) {
			noteStillPresent();
			return;
		}
		void confirmAbsence();
	} );
}

export function _resetPluginPresenceForTests(): void {
	store.reset();
}
