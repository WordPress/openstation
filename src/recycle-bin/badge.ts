/**
 * Recycle Bin — count badge.
 *
 * Paints a numeric badge on the bin's dock/taskbar tile + its
 * desktop icon. Stays accurate without a page refresh:
 *
 *   - Initial value comes from the shell config
 *     (`config.recycleBinCount`), so the badge is correct on the
 *     first paint, even before the user opens the bin.
 *   - Cross-window broadcasts (`wp-desktop.<type>.changed`) drive
 *     delta updates: a `'trashed'` action with N ids increments
 *     by N, an `'untrashed'` / `'deleted'` action decrements.
 *   - Authoritative resets come from the bin window itself
 *     (every `refresh()` sets the badge to the server's exact
 *     `total`), and from the lightweight REST `/count` endpoint.
 *
 * The badge caps the rendered value at 99 — anything higher
 * shows as `99+` so the pill stays compact regardless of how
 * full the trash gets.
 *
 * @since 0.21.0
 */

import { addAction, HOOKS } from '../hooks';
import { subscribe } from '../broadcast';

/* eslint-disable no-console */
const LOG_PREFIX = '[wpdm-bin badge]';
/**
 * Verbose debug trace — silent unless `localStorage.wpdmBinDebug`
 * is set. Useful when this thing breaks again: type
 * `localStorage.wpdmBinDebug = '1'` in DevTools, reload, and the
 * full `setRecycleBinBadge` / `paintBadge` / `watchForTargets`
 * trace prints. Cheap when off (one localStorage read per call).
 */
function log( ...args: unknown[] ): void {
	// Re-enable verbose tracing by typing
	// `localStorage.wpdmBinDebug = '1'` in DevTools, then reload.
	try {
		if ( window.localStorage?.getItem( 'wpdmBinDebug' ) ) {
			console.info( LOG_PREFIX, ...args );
		}
	} catch {
		// localStorage blocked — ignore.
	}
}
function warn( ...args: unknown[] ): void {
	console.warn( LOG_PREFIX, ...args );
}

const TARGET_ID = 'wpdm-recycle-bin';
const BADGE_CLASS = 'wp-desktop-dock__badge';
const ICON_BADGE_CLASS = 'wp-desktop-icon__badge';
// Heartbeat field. `wp.heartbeat`'s `data` object is delivered as
// `_POST['data'][ <key> ]` server-side; the key IS the field name
// our `heartbeat_received` filter reads.
const HEARTBEAT_FIELD = 'wpdm_recycle_bin_seen_ts';

let _current = 0;
// High-water mark for "did anything change since I last asked".
// Bumped from heartbeat responses + chromeless-iframe postMessages.
// Initialised to `Date.now()` on `start()` so a delete that
// happened before the page loaded doesn't replay through the
// fast-path subscriber on first paint.
let _seenTs = 0;
let _started = false;
let _countUrl = '';

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
	const prev = _current;
	_current = safe;
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
	setRecycleBinBadge( _current + delta );
}

/**
 * Read the current value (mostly for tests / debug).
 *
 * @internal
 */
export function _currentRecycleBinBadge(): number {
	return _current;
}

/**
 * Idempotently paint the badge to every host that should carry
 * one — currently the system tile in the dock/taskbar
 * (`data-system-id`) and the desktop icon (`data-icon-id`).
 *
 * Pulling this out lets `start()` retry once after a microtask
 * to cover the case where we're called before the dock has
 * finished its initial render.
 */
function paintBadge( count: number ): void {
	const tile = document.querySelector(
		`[data-system-id="${ cssEscape( TARGET_ID ) }"]`,
	);
	const icon = document.querySelector< HTMLElement >(
		`[data-icon-id="${ cssEscape( TARGET_ID ) }"]`,
	);
	log( 'paintBadge', {
		count,
		tile: !! tile,
		icon: !! icon,
	} );
	if ( tile ) {
		const primary = tile.querySelector< HTMLElement >(
			'.wp-desktop-dock__item-primary',
		);
		applyBadge( primary ?? ( tile as HTMLElement ), BADGE_CLASS, count );
	}
	if ( icon ) {
		applyBadge( icon, ICON_BADGE_CLASS, count );
	}
}

function applyBadge(
	host: HTMLElement,
	className: string,
	count: number,
): void {
	const existing = host.querySelector< HTMLElement >(
		`:scope > .${ className }`,
	);
	if ( count <= 0 ) {
		existing?.remove();
		return;
	}
	const display = count > 99 ? '99+' : String( count );
	if ( existing ) {
		if ( existing.textContent !== display ) {
			existing.textContent = display;
		}
		return;
	}
	const badge = document.createElement( 'span' );
	badge.className = className;
	badge.textContent = display;
	badge.setAttribute( 'aria-label', `${ count } in trash` );
	host.appendChild( badge );
}

/**
 * Polyfill-ish wrapper for `CSS.escape` — older browsers may not
 * have it (no-op fallback returns the input unchanged, which is
 * fine for our well-known id).
 */
function cssEscape( value: string ): string {
	const c = (
		window as unknown as {
			CSS?: { escape?: ( s: string ) => string };
		}
	).CSS;
	return c?.escape ? c.escape( value ) : value;
}

/**
 * Wire the badge to every signal source we have. Called once from
 * the main desktop bundle's init.
 *
 *   - Initial value: the shell config (`config.recycleBinCount`),
 *     so the badge is correct on the first paint, even before the
 *     user opens the bin.
 *   - Same-tab broadcast deltas (`wp-desktop.<type>.changed`).
 *   - Cross-iframe `postMessage` fast path (`type:
 *     'wp-desktop-recycle-bin-changed'`) — fires within ~ms of any
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
		wpDesktopConfig?: Record< string, unknown >;
	} ).wpDesktopConfig;
	const cfgCount = cfg?.recycleBinCount;
	const cfgUrl = cfg?.recycleBinCountUrl;
	const cfgDebug = cfg?.wpdmBinDebug;
	log( 'startRecycleBinBadge entry', {
		initial,
		countUrl,
		alreadyStarted: _started,
		cfgCount,
		cfgUrl,
		cfgDebug,
		readyState: document.readyState,
	} );
	// Loud warning when the PHP filter didn't deliver — the badge
	// will still update on the first heartbeat tick (~15 s), but
	// the cold-load value is wrong and that's the bug we keep
	// chasing. Sending this through `console.warn` so it shows
	// up even with `info` filtered out in DevTools.
	if ( typeof cfgCount !== 'number' ) {
		warn(
			'wpDesktopConfig.recycleBinCount is missing — PHP filter `desktop_mode_shell_config` did not deliver. Check your PHP error log for `[wpdm-bin debug]` lines.',
			{ cfg },
		);
	}
	if ( _started ) {
		setRecycleBinBadge( initial );
		return;
	}
	_started = true;
	_countUrl = countUrl;
	_seenTs = Date.now();
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
}

/**
 * Re-paint when the dock fires `dock.item-appended` for our id.
 * Native-window sync is the canonical signal — fires once per
 * tile registration, never spuriously. No polling.
 */
function wireDockTileSignal(): void {
	addAction(
		HOOKS.DOCK_ITEM_APPENDED,
		'wp-desktop-mode/recycle-bin/badge',
		( payload: { id?: string } ) => {
			if ( payload?.id === TARGET_ID ) {
				paintBadge( _current );
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
		'wp-desktop-mode/recycle-bin/badge',
		( payload: { ids?: string[] } ) => {
			if ( payload?.ids?.includes( TARGET_ID ) ) {
				paintBadge( _current );
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
	// Direct module import instead of `window.wp.desktop.subscribe`
	// — the latter is assigned to `wp.desktop` AFTER our `start()`
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
	subscribe( 'wp-desktop.post.changed', onDomain );
	subscribe( 'wp-desktop.page.changed', onDomain );
	subscribe( 'wp-desktop.attachment.changed', onDomain );
	subscribe( 'wp-desktop.comment.changed', onDomain );
}

/**
 * Chromeless-iframe `postMessage` fast path. Every chromeless
 * admin render emits `{ type: 'wp-desktop-recycle-bin-changed',
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
		if ( ! data || data.type !== 'wp-desktop-recycle-bin-changed' ) {
			return;
		}
		const ts = typeof data.ts === 'number' ? data.ts : Date.now();
		if ( ts <= _seenTs ) {
			log( 'postMessage skipped (ts <= seenTs)', { ts, seenTs: _seenTs } );
			return;
		}
		log( 'postMessage triggers refetch', { ts, prevSeenTs: _seenTs } );
		_seenTs = ts;
		void refetchCount();
	} );
}

/**
 * Heartbeat probe. Sends `wpdm_recycle_bin_seen_ts` on every
 * outgoing tick; reads `wpdm_recycle_bin: { ts, count }` off the
 * response. This is the catch-all channel — within 15 s (active
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
			data[ HEARTBEAT_FIELD ] = _seenTs;
		}
	} );
	$( document ).on( 'heartbeat-tick', ( ...args: unknown[] ) => {
		const response = args[ 1 ] as
			| {
				wpdm_recycle_bin?: {
					ts?: number;
					count?: number;
				};
			}
			| undefined;
		const block = response?.wpdm_recycle_bin;
		log( 'heartbeat-tick', { hasBlock: !! block, block } );
		if ( ! block ) {
			return;
		}
		if ( typeof block.ts === 'number' && block.ts > _seenTs ) {
			_seenTs = block.ts;
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
	if ( ! _countUrl ) {
		log( 'refetchCount: no countUrl, skip' );
		return;
	}
	log( 'refetchCount: hitting', _countUrl );
	try {
		const response = await fetch( _countUrl, {
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
