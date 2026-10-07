import { addAction, HOOKS } from '../hooks';
import { subscribe } from '../broadcast';
import { trashChanges, watchTrashChanges } from './trash-optimistic';
import { createSharedStore } from '../shared-store';
import { trackedFetch } from '../tracked-fetch';

const LOG_PREFIX = '[os-bin badge]';

function log( ...args: unknown[] ): void {
	try {
		if ( window.localStorage?.getItem( 'openStationBinDebug' ) ) {
			console.info( LOG_PREFIX, ...args );
		}
	} catch {

	}
}
function warn( ...args: unknown[] ): void {
	console.warn( LOG_PREFIX, ...args );
}

const TARGET_ID = 'desktop-mode-recycle-bin';

const HEARTBEAT_FIELD = 'openstation_recycle_bin_seen_ts';

interface ArtRail {
	setArt?: ( id: string, svg: string ) => void;
}
interface OpenStationArtRails {
	dock?: ArtRail | null;
	taskbar?: ArtRail | null;
	icons?: ArtRail;
}
function getDesktopApi(): OpenStationArtRails | undefined {
	return ( window as unknown as { wp?: { os?: OpenStationArtRails } } )
		.wp?.os;
}

interface BadgeState {
	current: number;

	emptyArt: string;
	fullArt: string;

	seenTs: number;
	started: boolean;
	countUrl: string;
}
const store = createSharedStore< BadgeState >(
	'desktop-mode/recycle-bin/icon-state',
	() => ( {
		current: 0,
		emptyArt: '',
		fullArt: '',
		seenTs: 0,
		started: false,
		countUrl: '',
	} ),
);

export function setRecycleBinCount( next: number ): void {
	const safe = Math.max( 0, Math.floor( next ) );
	const prev = store.state.current;
	store.state.current = safe;
	log( 'setRecycleBinCount', { prev, next: safe } );
	paintIconState( safe );
}

export function adjustRecycleBinCount( delta: number ): void {
	setRecycleBinCount( store.state.current + delta );
}

export function _currentRecycleBinCount(): number {
	return store.state.current;
}

function paintIconState( count: number ): void {
	const pending = trashChanges().filter( ( change ) => change.pending );
	const effective = count + pending.reduce( ( delta, change ) => delta + ( change.direction === 'in' ? 1 : -1 ), 0 );
	const art = effective > 0 ? store.state.fullArt : store.state.emptyArt;
	log( 'paintIconState', { count, full: count > 0, hasArt: !! art } );
	if ( ! art ) {
		return;
	}
	const desktop = getDesktopApi();
	desktop?.dock?.setArt?.( TARGET_ID, art );
	desktop?.taskbar?.setArt?.( TARGET_ID, art );
	desktop?.icons?.setArt?.( TARGET_ID, art );
}

export function startRecycleBinIconState(
	initialRaw: number | string,
	countUrl = '',
): void {
	const initial = Number( initialRaw ) || 0;
	const cfg = ( window as unknown as {
		openStationConfig?: Record< string, unknown >;
	} ).openStationConfig;
	const cfgCount = cfg?.recycleBinCount;
	const cfgUrl = cfg?.recycleBinCountUrl;

	store.state.emptyArt = String( cfg?.recycleBinIconEmpty ?? '' );
	store.state.fullArt = String( cfg?.recycleBinIconFull ?? '' );
	const cfgDebug = cfg?.openStationBinDebug;
	log( 'startRecycleBinIconState entry', {
		initial,
		countUrl,
		alreadyStarted: store.state.started,
		cfgCount,
		cfgUrl,
		cfgDebug,
		readyState: document.readyState,
	} );

	const cfgCountNum = Number( cfgCount );
	const cfgCountIsHealthy =
		( typeof cfgCount === 'number' || typeof cfgCount === 'string' ) &&
		Number.isFinite( cfgCountNum );
	if ( ! cfgCountIsHealthy ) {
		warn(
			'openStationConfig.recycleBinCount is missing — PHP filter `openstation_shell_config` did not deliver. Check your PHP error log for `[os-bin debug]` lines.',
			{ cfg },
		);
	}
	if ( store.state.started ) {
		setRecycleBinCount( initial );
		return;
	}
	store.state.started = true;
	store.state.countUrl = countUrl;
	store.state.seenTs = Date.now();
	setRecycleBinCount( initial );

	wireDockTileSignal();
	wireDesktopIconsSignal();

	watchTrashChanges( () => paintIconState( store.state.current ) );
	wireBroadcastDeltas();
	wirePostMessageFastPath();
	wireHeartbeatProbe();
}

function wireDockTileSignal(): void {
	addAction(
		HOOKS.DOCK_ITEM_APPENDED,
		'desktop-mode/recycle-bin/icon-state',
		( payload: { id?: string } ) => {
			if ( payload?.id === TARGET_ID ) {
				paintIconState( store.state.current );
			}
		},
	);
}

function wireDesktopIconsSignal(): void {
	addAction(
		HOOKS.DESKTOP_ICONS_RENDERED,
		'desktop-mode/recycle-bin/icon-state',
		( payload: { ids?: string[] } ) => {
			if ( payload?.ids?.includes( TARGET_ID ) ) {
				paintIconState( store.state.current );
			}
		},
	);
}

function wireBroadcastDeltas(): void {
	const onDomain = ( payload: unknown ): void => {
		const detail = payload as
			| { action?: string; ids?: unknown }
			| null
			| undefined;
		if ( ! detail ) {
			return;
		}
		const ids = Array.isArray( detail.ids ) ? detail.ids.length : 0;
		switch ( detail.action ) {
			case 'trashed':
				adjustRecycleBinCount( +ids );
				break;
			case 'untrashed':
			case 'deleted':
				adjustRecycleBinCount( -ids );
				break;
		}
	};

	const cfg = ( window as unknown as {
		openStationConfig?: { recycleBinPostTypes?: string[] };
	} ).openStationConfig;
	const postTypes = cfg?.recycleBinPostTypes ?? [ 'post', 'page', 'attachment' ];
	const fixedExtras = [ 'comment', 'placement', 'shortcut', 'folder' ];
	for ( const slug of [ ...postTypes, ...fixedExtras ] ) {
		subscribe( `os.${ slug }.changed`, onDomain );
	}
}

function wirePostMessageFastPath(): void {
	const expectedOrigin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== expectedOrigin ) {
			return;
		}
		const data = e.data as
			| { type?: string; ts?: number }
			| null
			| undefined;
		if ( ! data || data.type !== 'os-recycle-bin-changed' ) {
			return;
		}
		const ts = typeof data.ts === 'number' ? data.ts : Date.now();
		if ( ts <= store.state.seenTs ) {
			log( 'postMessage skipped (ts <= seenTs)', { ts, seenTs: store.state.seenTs } );
			return;
		}
		log( 'postMessage triggers refetch', { ts, prevSeenTs: store.state.seenTs } );
		store.state.seenTs = ts;
		void refetchCount();
	} );
}

function wireHeartbeatProbe(): void {
	const $ = (
		window as unknown as {
			jQuery?: ( selector: Document ) => {
				on: ( event: string, handler: ( ...args: unknown[] ) => void ) => void;
			};
		}
	).jQuery;
	if ( ! $ ) {
		warn( 'wireHeartbeatProbe: window.jQuery not available — heartbeat path disabled' );
		return;
	}
	log( 'wireHeartbeatProbe: jQuery + heartbeat hooks attached' );
	$( document ).on( 'heartbeat-send', ( ...args: unknown[] ) => {
		const data = args[ 1 ] as Record< string, unknown > | undefined;
		if ( data ) {
			data[ HEARTBEAT_FIELD ] = store.state.seenTs;
		}
	} );
	$( document ).on( 'heartbeat-tick', ( ...args: unknown[] ) => {
		const response = args[ 1 ] as
			| {
				openstation_recycle_bin?: {
					ts?: number;
					count?: number;
				};
			}
			| undefined;
		const block = response?.openstation_recycle_bin;
		log( 'heartbeat-tick', { hasBlock: !! block, block } );
		if ( ! block ) {
			return;
		}
		if ( typeof block.ts === 'number' && block.ts > store.state.seenTs ) {
			store.state.seenTs = block.ts;
		}
		if ( typeof block.count === 'number' ) {
			setRecycleBinCount( block.count );
		}
	} );
}

async function refetchCount(): Promise< void > {
	if ( ! store.state.countUrl ) {
		log( 'refetchCount: no countUrl, skip' );
		return;
	}
	log( 'refetchCount: hitting', store.state.countUrl );
	try {
		const response = await trackedFetch(
			store.state.countUrl,
			{
				credentials: 'same-origin',
				headers: { Accept: 'application/json' },
			},
			{ silent: true, source: 'desktop-mode/recycle-bin' },
		);
		if ( ! response.ok ) {
			warn( 'refetchCount: non-OK', response.status, response.statusText );
			return;
		}
		const json = ( await response.json() ) as { count?: number };
		log( 'refetchCount: response', json );
		if ( typeof json.count === 'number' ) {
			setRecycleBinCount( json.count );
		}
	} catch ( err ) {
		warn( 'refetchCount: fetch failed', err );
	}
}
