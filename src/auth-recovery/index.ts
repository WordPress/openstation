import { heartbeat } from '../heartbeat';
import { doAction, HOOKS } from '../hooks';

const AUTH_FIELD = 'desktop_mode_auth';

const FAILURE_COOLDOWN_MS = 5000;

const TICK_COOLDOWN_MS = 1000;

const RECOVERY_COOLDOWN_MS = 10_000;

interface WpWithHeartbeat {
	wp?: {
		heartbeat?: { connectNow?: () => void };
	};
}

let booted = false;
let sawLoggedOut = false;
let authLostAnnounced = false;
let bootUid = 0;
let failureCooldownUntil = 0;
let tickCooldownUntil = 0;
let tickTimer: number | null = null;
let lastRecoveryAt = 0;
let messageListener: ( ( ev: MessageEvent ) => void ) | null = null;
let modalObserver: MutationObserver | null = null;
let reloadShell: () => void = () => {
	try {
		window.location.reload();
	} catch {

	}
};

function connectNow(): void {
	try {
		const hb = ( window as unknown as WpWithHeartbeat ).wp?.heartbeat;
		if ( hb && typeof hb.connectNow === 'function' ) {
			hb.connectNow();
		}
	} catch {

	}
}

function forceTickSoon( cooldownMs: number = TICK_COOLDOWN_MS ): void {
	const now = Date.now();
	if ( now < tickCooldownUntil ) {
		if ( tickTimer === null ) {
			tickTimer = window.setTimeout( () => {
				tickTimer = null;
				tickCooldownUntil = Date.now() + TICK_COOLDOWN_MS;
				connectNow();
			}, tickCooldownUntil - now );
		}
		return;
	}
	tickCooldownUntil = now + cooldownMs;
	connectNow();
}

function announceAuthLost(): void {
	sawLoggedOut = true;
	if ( authLostAnnounced ) {
		return;
	}
	authLostAnnounced = true;
	doAction( HOOKS.AUTH_LOST );
	document.dispatchEvent( new CustomEvent( 'os-auth-lost' ) );
}

function reloadChromelessIframes(): void {
	for ( const frame of _reloadableIframes() ) {
		try {
			frame.contentWindow?.location.reload();
		} catch {

		}
	}
}

export function _reloadableIframes(): HTMLIFrameElement[] {
	let frames: NodeListOf< HTMLIFrameElement >;
	try {
		frames = document.querySelectorAll( 'iframe' );
	} catch {
		return [];
	}
	return Array.from( frames ).filter(
		( frame ) =>
			frame.id !== 'wp-auth-check-frame' &&
			! frame.closest( '#wp-auth-check-wrap' ),
	);
}

function runRecovery(): void {
	const now = Date.now();
	if ( now - lastRecoveryAt < RECOVERY_COOLDOWN_MS ) {
		return;
	}
	lastRecoveryAt = now;
	sawLoggedOut = false;
	authLostAnnounced = false;

	if ( tickTimer !== null ) {
		window.clearTimeout( tickTimer );
		tickTimer = null;
	}
	tickCooldownUntil = 0;
	forceTickSoon();

	reloadChromelessIframes();

	doAction( HOOKS.AUTH_RESTORED );
	document.dispatchEvent( new CustomEvent( 'os-auth-restored' ) );
}

function checkUid( value: unknown ): void {
	const uid =
		value && typeof value === 'object'
			? Number( ( value as { uid?: unknown } ).uid )
			: NaN;
	if ( ! Number.isFinite( uid ) || uid <= 0 ) {
		return;
	}
	if ( bootUid <= 0 ) {
		bootUid = uid;
		return;
	}
	if ( uid !== bootUid ) {
		reloadShell();
	}
}

export function noteAuthFailure( status: number, url: string ): void {
	if ( status !== 401 && status !== 403 ) {
		return;
	}
	let resolved: URL;
	try {
		resolved = new URL( String( url || '' ), window.location.href );
	} catch {
		return;
	}
	if ( resolved.origin !== window.location.origin ) {
		return;
	}

	if (
		resolved.pathname.indexOf( '/wp-admin/admin-ajax.php' ) !== -1 &&
		/(?:^|&|\?)action=heartbeat(?:&|$)/.test( resolved.search )
	) {
		return;
	}
	if ( resolved.pathname.indexOf( '/wp-login.php' ) !== -1 ) {
		return;
	}
	const now = Date.now();
	if ( now < failureCooldownUntil ) {
		return;
	}
	failureCooldownUntil = now + FAILURE_COOLDOWN_MS;
	connectNow();
}

function observeAuthCheckModal(): void {
	const wrap = document.getElementById( 'wp-auth-check-wrap' );
	if ( ! wrap || typeof MutationObserver === 'undefined' ) {
		return;
	}
	let wasVisible = ! wrap.classList.contains( 'hidden' );
	modalObserver = new MutationObserver( () => {
		const visible = ! wrap.classList.contains( 'hidden' );
		if ( wasVisible && ! visible ) {
			forceTickSoon();
		}
		wasVisible = visible;
	} );
	modalObserver.observe( wrap, {
		attributes: true,
		attributeFilter: [ 'class' ],
	} );
}

export interface AuthRecoveryOpts {

	currentUserId?: number;

	reloadShell?: () => void;
}

export function bootAuthRecovery( opts: AuthRecoveryOpts = {} ): void {
	if ( booted ) {
		return;
	}
	booted = true;
	bootUid = Number( opts.currentUserId ) > 0 ? Number( opts.currentUserId ) : 0;
	if ( opts.reloadShell ) {
		reloadShell = opts.reloadShell;
	}

	heartbeat.subscribe< boolean >( 'wp-auth-check', ( value ) => {
		if ( value === false ) {
			announceAuthLost();
			return;
		}
		if ( value === true && sawLoggedOut ) {
			runRecovery();
		}
	} );

	heartbeat.subscribe( 'nonces_expired', () => {
		if ( sawLoggedOut ) {
			runRecovery();
			return;
		}
		forceTickSoon();
	} );

	heartbeat.subscribe( AUTH_FIELD, checkUid );

	messageListener = ( ev: MessageEvent ) => {
		if ( ev.origin !== window.location.origin ) {
			return;
		}
		const data = ev.data as { type?: string } | null;
		if ( ! data || typeof data !== 'object' ) {
			return;
		}
		if ( data.type === 'os-reauth-detected' ) {
			runRecovery();
		}
	};
	window.addEventListener( 'message', messageListener );

	observeAuthCheckModal();
}

export function _resetAuthRecoveryForTests(): void {
	booted = false;
	sawLoggedOut = false;
	authLostAnnounced = false;
	bootUid = 0;
	failureCooldownUntil = 0;
	tickCooldownUntil = 0;
	lastRecoveryAt = 0;
	if ( tickTimer !== null ) {
		window.clearTimeout( tickTimer );
		tickTimer = null;
	}
	if ( messageListener ) {
		window.removeEventListener( 'message', messageListener );
		messageListener = null;
	}
	if ( modalObserver ) {
		modalObserver.disconnect();
		modalObserver = null;
	}
	reloadShell = () => {
		try {
			window.location.reload();
		} catch {

		}
	};
}
