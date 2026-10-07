import type { PwaConfig } from '../types';

export type SwRegistrationStatus =
	| 'pending'
	| 'registered'
	| 'foreign-sw'
	| 'unsupported'
	| 'failed';

let _registration: ServiceWorkerRegistration | null = null;
let _registrationFailed = false;
let _updatesBound = false;
let _shellUpdateAnnounced = false;

let _waitingWorker: ServiceWorker | null = null;

let _swapExpected = false;

let _swapListeners: Array< () => void > = [];
let _status: SwRegistrationStatus = 'pending';

export interface ShellUpdateInfo {

	current: string;

	served: string;
}

const BUILD_REPLY_TIMEOUT_MS = 5000;

const SWAP_TIMEOUT_MS = 3000;

function watchForUpdates(
	registration: ServiceWorkerRegistration,
	config: Pick< PwaConfig, 'shellBuild' >,
	onShellUpdated?: ( info: ShellUpdateInfo ) => void,
): void {
	if ( _updatesBound ) {
		return;
	}
	_updatesBound = true;
	const current = typeof config.shellBuild === 'string' ? config.shellBuild : '';

	const consider = ( worker: ServiceWorker, waiting: boolean ): void => {
		void askWorkerForBuild( worker ).then( ( served ) => {
			const changed = current !== '' && served !== '' && served !== current;
			if ( ! changed ) {
				if ( waiting ) {
					requestSwap( worker );
				}
				return;
			}
			if ( waiting ) {
				_waitingWorker = worker;
			}
			if ( _shellUpdateAnnounced || ! onShellUpdated ) {
				return;
			}
			_shellUpdateAnnounced = true;
			onShellUpdated( { current, served } );
		} );
	};

	const track = ( worker: ServiceWorker | null ): void => {
		if ( ! worker || typeof worker.addEventListener !== 'function' ) {
			return;
		}
		worker.addEventListener( 'statechange', () => {
			if ( worker.state === 'installed' && navigator.serviceWorker.controller ) {
				consider( worker, true );
			}
		} );
	};

	if ( registration.waiting && navigator.serviceWorker.controller ) {
		consider( registration.waiting, true );
	}
	track( registration.installing ?? null );
	if ( typeof registration.addEventListener === 'function' ) {
		registration.addEventListener( 'updatefound', () => {
			track( registration.installing ?? null );
		} );
	}

	navigator.serviceWorker.addEventListener( 'controllerchange', () => {
		_waitingWorker = null;
		if ( _swapExpected ) {
			_swapExpected = false;
			const listeners = _swapListeners;
			_swapListeners = [];
			for ( const done of listeners ) {
				done();
			}
			return;
		}

		const controller = navigator.serviceWorker.controller;
		if ( controller ) {
			consider( controller, false );
		}
	} );
}

function requestSwap( worker: ServiceWorker ): void {
	_swapExpected = true;
	try {
		worker.postMessage( { type: 'os-sw-skip-waiting' } );
	} catch {
		_swapExpected = false;
	}
}

export function applyPendingUpdate(): Promise< void > {
	const worker = _waitingWorker;
	if ( ! worker ) {
		return Promise.resolve();
	}
	return new Promise( ( resolve ) => {
		let done = false;
		const finish = (): void => {
			if ( done ) {
				return;
			}
			done = true;
			window.clearTimeout( timer );
			resolve();
		};
		const timer = window.setTimeout( finish, SWAP_TIMEOUT_MS );
		_swapListeners.push( finish );
		requestSwap( worker );
		if ( ! _swapExpected ) {
			finish();
		}
	} );
}

function askWorkerForBuild( worker: ServiceWorker ): Promise< string > {
	return new Promise( ( resolve ) => {
		let done = false;
		let timer = 0;
		const onMessage = ( ev: MessageEvent ): void => {
			const data = ev.data as { type?: unknown; shellBuild?: unknown } | null;
			if ( data && data.type === 'os-sw-build' ) {
				finish( typeof data.shellBuild === 'string' ? data.shellBuild : '' );
			}
		};
		const finish = ( value: string ): void => {
			if ( done ) {
				return;
			}
			done = true;
			window.clearTimeout( timer );
			navigator.serviceWorker.removeEventListener( 'message', onMessage );
			resolve( value );
		};
		timer = window.setTimeout( () => finish( '' ), BUILD_REPLY_TIMEOUT_MS );
		navigator.serviceWorker.addEventListener( 'message', onMessage );
		try {
			worker.postMessage( { type: 'os-sw-get-build' } );
		} catch {
			finish( '' );
		}
	} );
}

export const SW_RESUME_CHECK_MIN_INTERVAL_MS = 5 * 60_000;

let _unbindResumeCheck: ( () => void ) | null = null;
let _lastResumeCheckAt = 0;

function bindResumeUpdateCheck( registration: ServiceWorkerRegistration ): void {
	if ( _unbindResumeCheck ) {
		return;
	}

	_lastResumeCheckAt = Date.now();

	const check = (): void => {
		if ( typeof document !== 'undefined' && document.visibilityState === 'hidden' ) {
			return;
		}
		const now = Date.now();
		if ( now - _lastResumeCheckAt < SW_RESUME_CHECK_MIN_INTERVAL_MS ) {
			return;
		}
		_lastResumeCheckAt = now;
		try {
			void registration.update().catch( () => {

			} );
		} catch {

		}
	};

	document.addEventListener( 'visibilitychange', check );
	window.addEventListener( 'pageshow', check );
	_unbindResumeCheck = () => {
		document.removeEventListener( 'visibilitychange', check );
		window.removeEventListener( 'pageshow', check );
	};
}

const OWN_LEGACY_SW_PATH_SUFFIXES = [ '/desktop-mode/sw.js' ] as const;

function isOwnSwScriptUrl(
	url: string,
	config: Pick< PwaConfig, 'swUrl' | 'swFallbackUrl' >,
): boolean {
	if ( url === config.swUrl || url === config.swFallbackUrl ) {
		return true;
	}
	try {
		const parsed = new URL( url );

		if (
			parsed.pathname.endsWith( '/openstation/sw.js' ) ||
			parsed.searchParams.has( 'openstation_sw' )
		) {
			return true;
		}
		return OWN_LEGACY_SW_PATH_SUFFIXES.some( ( suffix ) =>
			parsed.pathname.endsWith( suffix ),
		);
	} catch {
		return false;
	}
}

function sendCurrentConfigToWorker(): void {
	const swConfig = (
		window as unknown as {
			openStationConfig?: {
				pwa?: {
					swConfig?: {
						adminAssetCache?: boolean;
						windowPrewarm?: boolean;
					};
				};
			};
		}
	).openStationConfig?.pwa?.swConfig;
	notifyServiceWorkerConfig( {
		adminAssetCache: swConfig?.adminAssetCache === true,
		windowPrewarm: swConfig?.windowPrewarm === true,
	} );
}

export async function registerServiceWorker(
	config: PwaConfig | undefined,
	options: {
		forceReplace?: boolean;

		onShellUpdated?: ( info: ShellUpdateInfo ) => void;
	} = {},
): Promise< ServiceWorkerRegistration | null > {
	if ( typeof navigator === 'undefined' || ! ( 'serviceWorker' in navigator ) ) {
		_status = 'unsupported';
		return null;
	}
	if ( ! config?.swUrl ) {
		_status = 'unsupported';
		return null;
	}
	if ( ! window.isSecureContext ) {
		_status = 'unsupported';
		return null;
	}
	if ( _registration || _registrationFailed ) {
		return _registration;
	}

	if ( ! options.forceReplace ) {
		const existing = await navigator.serviceWorker
			.getRegistrations()
			.catch( () => [] as ServiceWorkerRegistration[] );
		const foreign = existing.find( ( reg ) => {
			const url = reg.active?.scriptURL ?? reg.installing?.scriptURL ?? '';
			return url !== '' && ! isOwnSwScriptUrl( url, config );
		} );
		if ( foreign ) {
			_status = 'foreign-sw';
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] another service worker is already registered (' +
						foreign.scope +
						'); skipping openstation SW. Set openstation_pwa_force_replace_sw=true to override.',
				);
			}
			return null;
		}
	}

	const attempt = async (
		url: string,
	): Promise< ServiceWorkerRegistration > =>
		navigator.serviceWorker.register( url, {

			scope: config.swScope || '/',
			updateViaCache: 'none',
		} );

	try {
		try {
			_registration = await attempt( config.swUrl );
		} catch ( err ) {
			if ( ! config.swFallbackUrl || config.swFallbackUrl === config.swUrl ) {
				throw err;
			}
			_registration = await attempt( config.swFallbackUrl );
		}
		_status = 'registered';

		watchForUpdates( _registration, config, options.onShellUpdated );

		bindResumeUpdateCheck( _registration );

		sendCurrentConfigToWorker();
		navigator.serviceWorker.addEventListener(
			'controllerchange',
			sendCurrentConfigToWorker,
		);
		return _registration;
	} catch ( err ) {
		_registrationFailed = true;
		_status = 'failed';
		if ( typeof console !== 'undefined' ) {
			console.warn( '[openstation] SW registration failed:', err );
		}
		return null;
	}
}

export function notifyServiceWorkerPrewarm( enabled: boolean ): void {
	try {
		navigator.serviceWorker?.controller?.postMessage( {
			type: 'os-sw-set-prewarm',
			enabled,
		} );
	} catch {

	}
}

export function notifyServiceWorkerConfig( config: {
	adminAssetCache: boolean;
	windowPrewarm: boolean;
} ): void {
	try {
		navigator.serviceWorker?.controller?.postMessage( {
			type: 'os-sw-config',
			...config,
		} );
	} catch {

	}
}

export function getSwRegistrationStatus(): SwRegistrationStatus {
	return _status;
}

export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
	return _registration;
}

export function _resetSwRegistration(): void {
	_registration = null;
	_registrationFailed = false;
	_updatesBound = false;
	_shellUpdateAnnounced = false;
	_waitingWorker = null;
	_swapExpected = false;
	_swapListeners = [];
	_unbindResumeCheck?.();
	_unbindResumeCheck = null;
	_lastResumeCheckAt = 0;
	_status = 'pending';
}
