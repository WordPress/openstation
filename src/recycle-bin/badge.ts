/**
 * Recycle Bin — count badge.
 *
 * Paints a numeric badge on the bin's dock/taskbar tile + its
 * desktop icon. Stays accurate without a page refresh:
 *
 *   - Initial value comes from the shell config
 *     (`config.recycleBinCount`), so the badge is correct on the
 *     first paint, even before the user opens the bin.
 *   - Cross-window broadcasts (`os.<type>.changed`) drive
 *     delta updates: a `'trashed'` action with N ids increments
 *     by N, an `'untrashed'` / `'deleted'` action decrements.
 *   - Authoritative resets come from the bin window itself
 *     (every `refresh()` sets the badge to the server's exact
 *     `total`), and from the lightweight REST `/count` endpoint.
 *
 * The badge caps the rendered value at 99 — anything higher
 * shows as `99+` so the pill stays compact regardless of how
 * full the trash gets.
 */

import { addAction, HOOKS } from '../hooks';
import { subscribe } from '../broadcast';
import { createSharedStore } from '../shared-store';

/* eslint-disable no-console */
const LOG_PREFIX = '[os-bin badge]';
/**
 * Verbose debug trace — silent unless `localStorage.openStationBinDebug`
 * is set. Useful when this thing breaks again: type
 * `localStorage.openStationBinDebug = '1'` in DevTools, reload, and the
 * full `setRecycleBinBadge` / `paintBadge` / `watchForTargets`
 * trace prints. Cheap when off (one localStorage read per call).
 */
function log( ...args: unknown[] ): void {
	// Re-enable verbose tracing by typing
	// `localStorage.openStationBinDebug = '1'` in DevTools, then reload.
	try {
		if ( window.localStorage?.getItem( 'openStationBinDebug' ) ) {
			console.info( LOG_PREFIX, ...args );
		}
	} catch {
		// localStorage blocked — ignore.
	}
}
function warn( ...args: unknown[] ): void {
	console.warn( LOG_PREFIX, ...args );
}

const TARGET_ID = 'desktop-mode-recycle-bin';
// Heartbeat field. `wp.heartbeat`'s `data` object is delivered as
// `_POST['data'][ <key> ]` server-side; the key IS the field name
// our `heartbeat_received` filter reads.
const HEARTBEAT_FIELD = 'openstation_recycle_bin_seen_ts';

/**
 * Narrow shape of `wp.os` we depend on here. Pulled in via
 * the loose `window.wp.os` lookup rather than a direct
 * import: this module loads inside the always-on shell bundle, so
 * the public API is a guaranteed sibling — but typing the lookup
 * keeps us honest about which methods we actually call.
 */
interface BadgeRails {
	setBadge?: ( id: string, count: number ) => void;
}
interface OpenStationBadgeRails {
	dock?: BadgeRails | null;
	taskbar?: BadgeRails | null;
	icons?: BadgeRails;
	windowManager?: { isActive?: ( id: string ) => boolean; isActiveByBaseId?: ( baseId: string ) => boolean };
}
function getDesktopApi(): OpenStationBadgeRails | undefined {
	return ( window as unknown as { wp?: { os?: OpenStationBadgeRails } } )
		.wp?.os;
}

/**
 * State shared across every bundle that imports this module.
 *
 * Routed through `createSharedStore` because both the always-on
 * shell bundle (`desktop.js`) and the lazy bin window bundle
 * (`recycle-bin.js`) import this file. Plain module-level `let`s
 * would compile into each bundle separately, so the bin window
 * setting `current = 0` after Empty bin would never reach the
 * shell bundle's lifecycle handlers — they'd repaint the dock
 * tile from their own stale copy on close. See
 * `AGENTS.md` ➜ "Cross-bundle state".
 */
interface BadgeState {
	current: number;
	// High-water mark for "did anything change since I last asked".
	// Bumped from heartbeat responses + chromeless-iframe
	// postMessages. Initialised to `Date.now()` on `start()` so a
	// delete that happened before the page loaded doesn't replay
	// through the fast-path subscriber on first paint.
	seenTs: number;
	started: boolean;
	countUrl: string;
}
const store = createSharedStore< BadgeState >(
	'desktop-mode/recycle-bin/badge',
	() => ( {
		current: 0,
		seenTs: 0,
		started: false,
		countUrl: '',
	} ),
);

/**
 * Set the bin's badge to an absolute count. Idempotent: the same
 * value re-applied is a no-op (no DOM mutation).
 *
 * @public
 *
 * @param next Non-negative integer count.
 */
export function setRecycleBinBadge( next: number ): void {
	const safe = Math.max( 0, Math.floor( next ) );
	const prev = store.state.current;
	store.state.current = safe;
	log( 'setRecycleBinBadge', { prev, next: safe } );
	paintBadge( safe );
}

/**
 * Apply a delta to the current badge value. Used by broadcast
 * subscribers — `'trashed'` events bump up, `'untrashed'` /
 * `'deleted'` events bump down. Drift correction happens via the
 * authoritative `setRecycleBinBadge()` calls from `/list` (bin
 * window refresh) and `/count` (manual reconcile).
 *
 * @public
 *
 * @param delta Signed integer; clamped at zero.
 */
export function adjustRecycleBinBadge( delta: number ): void {
	setRecycleBinBadge( store.state.current + delta );
}

/**
 * Read the current value (mostly for tests / debug).
 *
 * @internal
 */
export function _currentRecycleBinBadge(): number {
	return store.state.current;
}

/**
 * Fan the badge count to every rail that might be hosting our
 * tile. The framework rails (`dock`, `taskbar`, `icons`) all
 * expose the same `setBadge( id, count )` shape and silently
 * no-op for ids they don't own — so calling all three is the
 * canonical pattern, not a hack.
 *
 * Honours the framework "show 0 when my window is active" UX
 * policy: when the user is currently looking at the bin window,
 * the badge renders as 0 so we don't double-signal. The internal
 * `store.state.current` count is preserved either way; closing or
 * minimising the window restores the visible badge on the next
 * lifecycle event (see {@link wireWindowLifecycleSignals}).
 *
 * No DOM scraping — the rails own paint state, including
 * survival across grid rebuilds. Plugin authors looking for the
 * canonical "how do I badge a tile" example should land here.
 */
function paintBadge( count: number ): void {
	const desktop = getDesktopApi();
	const active = isBinWindowActive();
	const visible = active ? 0 : count;
	log( 'paintBadge', { count, visible, active } );
	desktop?.dock?.setBadge?.( TARGET_ID, visible );
	desktop?.taskbar?.setBadge?.( TARGET_ID, visible );
	desktop?.icons?.setBadge?.( TARGET_ID, visible );
}

/**
 * Window-activeness check — relies on the framework's
 * `wp.os.windowManager.isActive()`. Falls back to false when
 * the manager isn't reachable yet (this module loads inside
 * `desktop.js` so that's rare, but cheap to handle).
 */
function isBinWindowActive(): boolean {
	const mgr = getDesktopApi()?.windowManager;
	if ( mgr?.isActiveByBaseId ) {
		return mgr.isActiveByBaseId( TARGET_ID );
	}
	return !! mgr?.isActive?.( TARGET_ID );
}

/**
 * Wire the badge to every signal source we have. Called once from
 * the main desktop bundle's init.
 *
 *   - Initial value: the shell config (`config.recycleBinCount`),
 *     so the badge is correct on the first paint, even before the
 *     user opens the bin.
 *   - Same-tab broadcast deltas (`os.<type>.changed`).
 *   - Cross-iframe `postMessage` fast path (`type:
 *     'os-recycle-bin-changed'`) — fires within ~ms of any
 *     chromeless admin request that mutated state.
 *   - Heartbeat catch-all — every tick the server reports the
 *     current count + the latest change-ts. This is the channel
 *     that catches AJAX list-table trash, REST DELETE, other tabs,
 *     WP-CLI, cron — anything that doesn't render an admin footer.
 *
 * The bin window's lazy-loaded `index.ts` also calls
 * `setRecycleBinBadge()` after every successful `refresh()`, so
 * authoritative resets happen any time the user is looking at the
 * bin directly. The heartbeat probe runs regardless — that's the
 * fix for "badge doesn't update unless I open the bin".
 *
 * @public
 *
 * @param initialRaw Initial count from `config.recycleBinCount`. Accepts a
 *                   number or a numeric string (`wp_localize_script` strings
 *                   every scalar).
 * @param countUrl   REST endpoint for `/recycle-bin/count`.
 */
export function startRecycleBinBadge(
	initialRaw: number | string,
	countUrl = '',
): void {
	// Defensive coerce — `wp_localize_script` strings every
	// scalar, and we'd rather a future caller pass either shape
	// than re-introduce the "badge stuck at 0" bug we just fixed.
	const initial = Number( initialRaw ) || 0;
	const cfg = ( window as unknown as {
		openStationConfig?: Record< string, unknown >;
	} ).openStationConfig;
	const cfgCount = cfg?.recycleBinCount;
	const cfgUrl = cfg?.recycleBinCountUrl;
	const cfgDebug = cfg?.openStationBinDebug;
	log( 'startRecycleBinBadge entry', {
		initial,
		countUrl,
		alreadyStarted: store.state.started,
		cfgCount,
		cfgUrl,
		cfgDebug,
		readyState: document.readyState,
	} );
	// Loud warning when the PHP filter didn't deliver. Important:
	// `wp_localize_script` stringifies every top-level scalar, so a
	// PHP `(int) 0` arrives here as the string `"0"` — using
	// `typeof !== 'number'` would yell on every healthy load and
	// drown out the real signal. The genuine "filter missing"
	// shapes are `undefined` (key absent) and `null`; numeric
	// strings (the WP-localize default) and actual numbers both
	// indicate a delivered value.
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
		setRecycleBinBadge( initial );
		return;
	}
	store.state.started = true;
	store.state.countUrl = countUrl;
	store.state.seenTs = Date.now();
	setRecycleBinBadge( initial );

	// Both targets render asynchronously after init: the dock
	// tile is registered by `native-window-sync` (`await`s the
	// lazy script load), and the desktop icon grid renders on
	// the main bundle's init path. Both fire a deterministic
	// signal when they finish — we subscribe to those instead
	// of polling the DOM.
	wireDockTileSignal();
	wireDesktopIconsSignal();

	wireBroadcastDeltas();
	wirePostMessageFastPath();
	wireHeartbeatProbe();
	wireWindowLifecycleSignals();
}

/**
 * Re-paint the badge when the bin window's lifecycle changes —
 * focus / blur / minimize / restore / open / close. The
 * `paintBadge` function consults
 * `wp.os.windowManager.isActive()` and renders 0 while the
 * user is looking at the window, so transitions need to trigger
 * a re-paint to apply or undo that suppression. Internal count
 * (`store.state.current`) doesn't change here — only the rendered DOM
 * value.
 */
function wireWindowLifecycleSignals(): void {
	const ns = 'desktop-mode/recycle-bin/badge-lifecycle';
	const repaint = ( payload: unknown ): void => {
		const detail = payload as { windowId?: string };
		const windowId = detail?.windowId;
		if ( ! windowId ) {
			return;
		}
		const isBin = windowId === TARGET_ID || windowId.startsWith( TARGET_ID + '-' );
		if ( ! isBin ) {
			return;
		}
		paintBadge( store.state.current );
	};
	addAction( HOOKS.WINDOW_OPENED, ns, repaint );
	addAction( HOOKS.WINDOW_FOCUSED, ns, repaint );
	addAction( HOOKS.WINDOW_BLURRED, ns, repaint );
	addAction( HOOKS.WINDOW_MINIMIZED, ns, repaint );
	addAction( HOOKS.WINDOW_RESTORED, ns, repaint );
	addAction( HOOKS.WINDOW_CLOSED, ns, repaint );
	addAction( HOOKS.WINDOW_REOPENED, ns, repaint );
}

/**
 * Re-paint when the dock fires `dock.item-appended` for our id.
 * Native-window sync is the canonical signal — fires once per
 * tile registration, never spuriously. No polling.
 */
function wireDockTileSignal(): void {
	addAction(
		HOOKS.DOCK_ITEM_APPENDED,
		'desktop-mode/recycle-bin/badge',
		( payload: { id?: string } ) => {
			if ( payload?.id === TARGET_ID ) {
				paintBadge( store.state.current );
			}
		},
	);
}

/**
 * Re-paint when the wallpaper icon grid is rendered.
 *
 * `renderDesktopIcons` short-circuits when the icons array is
 * unchanged, so this only fires on legitimate rebuilds (initial
 * render, plugin activation/deactivation) — the cases where our
 * decoration genuinely needs to be reattached.
 */
function wireDesktopIconsSignal(): void {
	addAction(
		HOOKS.DESKTOP_ICONS_RENDERED,
		'desktop-mode/recycle-bin/badge',
		( payload: { ids?: string[] } ) => {
			if ( payload?.ids?.includes( TARGET_ID ) ) {
				paintBadge( store.state.current );
			}
		},
	);
}

/**
 * Same-tab broadcast deltas. Fires when a mutation happens in
 * the same browsing context — the bin's own restore/purge, or
 * a chromeless admin request whose changelog included this
 * post type.
 */
function wireBroadcastDeltas(): void {
	// Direct module import instead of `window.wp.os.subscribe`
	// — the latter is assigned to `wp.os` AFTER our `start()`
	// runs in the init sequence, so calling it via the public API
	// silently no-ops at boot. The bus itself is already initialised
	// before `start()` (see `attachBroadcastBus` + `installBroadcastReceiver`
	// in `desktop.ts`), so the import-side call is safe.
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
				adjustRecycleBinBadge( +ids );
				break;
			case 'untrashed':
			case 'deleted':
				adjustRecycleBinBadge( -ids );
				break;
		}
	};
	// Dynamic post-type slugs from the PHP shell config + fixed non-post-type
	// extras the Recycle Bin always captures. The extras never vary so there
	// is no PHP filter for them; they live here where their meaning is clear.
	const cfg = ( window as unknown as {
		openStationConfig?: { recycleBinPostTypes?: string[] };
	} ).openStationConfig;
	const postTypes = cfg?.recycleBinPostTypes ?? [ 'post', 'page', 'attachment' ];
	const fixedExtras = [ 'comment', 'placement', 'shortcut', 'folder' ];
	for ( const slug of [ ...postTypes, ...fixedExtras ] ) {
		subscribe( `os.${ slug }.changed`, onDomain );
	}
}

/**
 * Chromeless-iframe `postMessage` fast path. Every chromeless
 * admin render emits `{ type: 'os-recycle-bin-changed',
 * ts }` to the parent shell. We bump our high-water mark and
 * (when we have the URL) refetch the authoritative count.
 *
 * Lives here in the badge module so it's always-on — the bin
 * window doesn't have to be open for the badge to learn.
 */
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

/**
 * Heartbeat probe. Sends `openstation_recycle_bin_seen_ts` on every
 * outgoing tick; reads `openstation_recycle_bin: { ts, count? }` off the
 * response. The server only attaches `count` when something changed
 * since our high-water mark (an unchanged tick would recompute the
 * same number); when the key is absent the badge keeps its current
 * value. This is the catch-all channel — within 15 s (active
 * tab) or 60 s (background tab) of a mutation anywhere on the
 * site, the badge resyncs to the authoritative count.
 *
 * Always-on: doesn't matter whether the bin window is open.
 */
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
			setRecycleBinBadge( block.count );
		}
	} );
}

/**
 * REST `/count` fetch — the authoritative reset used by the
 * postMessage fast path when it learns there's been a change.
 *
 * Silent-fail by design: if we can't fetch (network blip, missing
 * URL), the heartbeat path will resync within the next tick.
 */
async function refetchCount(): Promise< void > {
	if ( ! store.state.countUrl ) {
		log( 'refetchCount: no countUrl, skip' );
		return;
	}
	log( 'refetchCount: hitting', store.state.countUrl );
	try {
		// eslint-disable-next-line no-restricted-syntax -- background heartbeat-driven badge refresh; intentionally silent (no spinner) since the user didn't initiate it.
		const response = await fetch( store.state.countUrl, {
			credentials: 'same-origin',
			headers: { Accept: 'application/json' },
		} );
		if ( ! response.ok ) {
			warn( 'refetchCount: non-OK', response.status, response.statusText );
			return;
		}
		const json = ( await response.json() ) as { count?: number };
		log( 'refetchCount: response', json );
		if ( typeof json.count === 'number' ) {
			setRecycleBinBadge( json.count );
		}
	} catch ( err ) {
		warn( 'refetchCount: fetch failed', err );
	}
}
