import { heartbeat } from './heartbeat';

const HEARTBEAT_FIELD = 'desktop_mode_nonces';

type NoncePayload = Record< string, string >;

type NonceTargetUpdater = ( freshNonce: string ) => void;

const targets = new Map< string, Set< NonceTargetUpdater > >();
let booted = false;

export function registerNonceTarget(
	action: string,
	updater: NonceTargetUpdater,
): () => void {
	if ( typeof action !== 'string' || action === '' ) {
		return () => {};
	}
	let set = targets.get( action );
	if ( ! set ) {
		set = new Set();
		targets.set( action, set );
	}
	set.add( updater );
	return () => {
		set!.delete( updater );
	};
}

export function bootNonceRefresh(): void {
	if ( booted ) {
		return;
	}
	booted = true;
	heartbeat.subscribe< NoncePayload >( HEARTBEAT_FIELD, ( payload ) => {
		if ( ! payload || typeof payload !== 'object' ) {
			return;
		}
		for ( const [ action, value ] of Object.entries( payload ) ) {
			if ( typeof value !== 'string' || value === '' ) {
				continue;
			}
			const set = targets.get( action );
			if ( ! set ) {
				continue;
			}
			for ( const updater of set ) {
				try {
					updater( value );
				} catch ( err ) {
					console.error(
						`[desktop-mode/nonce-refresh] updater for "${ action }" threw:`,
						err,
					);
				}
			}
		}
	} );

	registerShellAndPluginsWindowTargets();
}

function registerShellAndPluginsWindowTargets(): void {
	registerNonceTarget( 'wp_rest', updateAllRestNonces );
	registerNonceTarget( 'desktop-mode-plugins', ( fresh ) => {
		writeWindowConfigField( 'desktop-mode-plugins', 'ajaxNonce', fresh );
	} );
	registerNonceTarget( 'updates', ( fresh ) => {
		writeWindowConfigField( 'desktop-mode-plugins', 'updatesNonce', fresh );
	} );
}

function updateAllRestNonces( fresh: string ): void {
	const cfg = readShellConfig();
	if ( cfg && typeof cfg.restNonce === 'string' ) {
		cfg.restNonce = fresh;
	}
	const windowConfigs = readWindowConfigs();
	if ( ! windowConfigs ) {
		return;
	}
	for ( const blob of Object.values( windowConfigs ) ) {
		if (
			blob &&
			typeof blob === 'object' &&
			typeof ( blob as { restNonce?: unknown } ).restNonce === 'string'
		) {
			( blob as { restNonce: string } ).restNonce = fresh;
		}
	}
}

function writeWindowConfigField(
	windowId: string,
	field: string,
	value: string,
): void {
	const blobs = readWindowConfigs();
	const blob = blobs?.[ windowId ];
	if ( ! blob || typeof blob !== 'object' ) {
		return;
	}
	const record = blob as Record< string, unknown >;

	const extra = record.extra;
	let written = false;
	if ( extra && typeof extra === 'object' && field in ( extra as Record< string, unknown > ) ) {
		( extra as Record< string, unknown > )[ field ] = value;
		written = true;
	}
	if ( field in record || ! written ) {
		record[ field ] = value;
	}
}

function readShellConfig(): { restNonce?: unknown } | undefined {
	if ( typeof window === 'undefined' ) {
		return undefined;
	}
	return ( window as unknown as {
		openStationConfig?: { restNonce?: unknown };
	} ).openStationConfig;
}

function readWindowConfigs(): Record< string, unknown > | undefined {
	if ( typeof window === 'undefined' ) {
		return undefined;
	}
	return ( window as unknown as {
		openStationWindowConfig?: Record< string, unknown >;
	} ).openStationWindowConfig;
}

export function _resetNonceRefreshForTests(): void {
	targets.clear();
	booted = false;
}
