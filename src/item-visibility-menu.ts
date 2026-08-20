/**
 * Right-click menu for a dock tile, a sidebar tile, or a desktop icon.
 *
 * Every entry is one call: add or remove one region from the item's
 * placement. The labels come from the computed navigation rather than
 * from the surface the user clicked, so a Core admin menu in the split
 * layout offers "Hide from sidebar" instead of naming a rail it is not
 * on, and an app on the dock only because its window is open offers
 * "Keep in dock" instead of "Hide from dock" — hiding something that
 * was never pinned would do nothing the user could see.
 *
 * Writes go through `wp.os.updateOsSettings`; the layout dispatcher's
 * settings subscription repaints.
 */

import { __, sprintf } from './i18n';
import { openWithShellOverlays } from './shell-overlays/loader';
import { ITEM_MENU_OPENING_EVENT } from './item-visibility-menu-events';
import {
	findNavItem,
	onDesktop,
	onRail,
	railFor,
	readNavConfig,
	resolvePlacement,
	setPlacement,
	setRegion,
	type NavItem,
	type NavLayout,
	type NavRail,
} from './nav';
import { osConfirm } from './ui/components/os-confirm-dialog/os-confirm-dialog';
import { placeAfterRender } from './ui/util/menu-position';
import { trackedFetch } from './tracked-fetch';
import { showToast } from './toast';
import { joinRestUrl } from './rest-url';

interface OpenStationShim {
	getOsSettings?: () => { desktopLayout?: NavLayout };
	openOsSettings?: ( opts?: { tabId?: string } ) => void;
}

function getApi(): OpenStationShim | null {
	const w = window as unknown as { wp?: { os?: OpenStationShim } };
	return w.wp?.os ?? null;
}

let activeMenu: HTMLElement | null = null;

function closeMenu(): void {
	if ( activeMenu ) {
		activeMenu.remove();
		activeMenu = null;
	}
}

/** The rail this item's `'rail'` placement resolves to right now. */
function railForItem( item: NavItem ): NavRail {
	const layout = getApi()?.getOsSettings?.().desktopLayout ?? 'unified';
	return railFor( item.kind, layout );
}

/** "dock" / "sidebar", for the menu labels. */
function railName( rail: NavRail ): string {
	return 'sidebar' === rail ? __( 'sidebar' ) : __( 'dock' );
}

export interface OpenItemVisibilityMenuOpts {
	/** Viewport coordinates the user right-clicked at. */
	x: number;
	y: number;
	/** Item id as it appears in the DOM (may be rail-prefixed). */
	id: string;
	/** Display title — used in the OS Settings shortcut option. */
	title: string;
	/** Which surface the user right-clicked on. */
	surface: 'dock' | 'desktop';
	/**
	 * Plugin file (e.g. `woocommerce/woocommerce.php`) when the item is
	 * owned by an active, deactivatable plugin. When non-null the menu
	 * surfaces a "Deactivate <title>" action that calls
	 * `PUT /wp/v2/plugins/<file>` with `{ status: 'inactive' }`.
	 */
	pluginFile?: string | null;
	/**
	 * Owning plugin's display name (e.g. `"WooCommerce"`). When the
	 * dock tile is a sub-page (Analytics, Marketing, …) this is the
	 * label we show in the destructive action — the user is
	 * deactivating the plugin, not the tile.
	 */
	pluginName?: string | null;
}

/**
 * Generation counter to drop superseded menu-open calls. Bumped on
 * every public `openItemVisibilityMenu` call; the lazy `.then`
 * handler checks the captured generation against the current one
 * and bails if a newer open has come in while the shell-overlays
 * bundle was loading. (In steady state the bundle is preloaded
 * after first paint, so the `.then` is synchronous-ish and this
 * predicate always passes.)
 */
let openGeneration = 0;

/**
 * Re-exported so this module stays the one obvious import site for
 * the event. Its declaration lives in a leaf module because the
 * hover surfaces that listen for it ship in `desktop.min.js` and
 * must not drag this bundle along with the string — see
 * `./item-visibility-menu-events`.
 */
export { ITEM_MENU_OPENING_EVENT } from './item-visibility-menu-events';

/**
 * Open the visibility menu next to the user's cursor. Idempotent —
 * a second call closes the previous menu before opening a fresh one.
 *
 * Construction is deferred behind `openWithShellOverlays` so the
 * `<os-context-menu>` / `<os-context-menu-option>` classes ship
 * in the lazy `shell-overlays[.min].js` bundle rather than in
 * `desktop.min.js`.
 */
export function openItemVisibilityMenu(
	opts: OpenItemVisibilityMenuOpts,
): void {
	// Announced BEFORE the menu is built, and before the await inside
	// `openWithShellOverlays`: a hover panel that is still on screen
	// when the menu paints has already lost the race, and the cut needs
	// to happen in the same frame as the click that caused it.
	document.dispatchEvent(
		new CustomEvent( ITEM_MENU_OPENING_EVENT, {
			detail: { id: opts.id, surface: opts.surface },
		} ),
	);
	closeMenu();
	const myGen = ++openGeneration;
	openWithShellOverlays(
		() => myGen === openGeneration,
		() => openItemVisibilityMenuImmediate( opts ),
	);
}

function openItemVisibilityMenuImmediate(
	opts: OpenItemVisibilityMenuOpts,
): void {
	closeMenu();

	const item = findNavItem( opts.id );
	// Nothing to offer: an id nothing registers (a tile painted by a
	// custom renderer, a stale DOM node), the one item that cannot
	// move, or a tile that exists only while its window is open and
	// has no launcher to place.
	if ( ! item || item.locked || item.transient ) {
		return;
	}

	const placement = resolvePlacement( item, readNavConfig().placement );
	const rail = railForItem( item );
	const railWord = railName( rail );

	type MenuOption =
		| {
				kind?: 'option';
				id: string;
				label: string;
				icon?: string;
				danger?: boolean;
				onPick: () => void;
			}
		| { kind: 'separator' };

	const options: MenuOption[] = [];

	if ( opts.surface === 'dock' ) {
		if ( onRail( placement ) ) {
			options.push( {
				id: 'hide-from-rail',
				/* translators: %s: "dock" or "sidebar". */
				label: sprintf( __( 'Hide from %s' ), railWord ),
				icon: 'dashicons-hidden',
				onPick: () => setRegion( item, 'rail', false ),
			} );
		} else {
			// The tile is here only because its window is open. It has
			// nothing to be hidden from yet, so the useful offer is the
			// opposite one.
			options.push( {
				id: 'keep-in-rail',
				/* translators: %s: "dock" or "sidebar". */
				label: sprintf( __( 'Keep in %s' ), railWord ),
				icon: 'dashicons-admin-post',
				onPick: () => setRegion( item, 'rail', true ),
			} );
		}
		if ( ! onDesktop( placement ) ) {
			options.push( {
				id: 'show-on-desktop',
				label: __( 'Also show on desktop' ),
				icon: 'dashicons-desktop',
				onPick: () => setRegion( item, 'desktop', true ),
			} );
		}
	} else {
		options.push( {
			id: 'hide-from-desktop',
			label: __( 'Hide from desktop' ),
			icon: 'dashicons-hidden',
			onPick: () => setRegion( item, 'desktop', false ),
		} );
		if ( ! onRail( placement ) ) {
			options.push( {
				id: 'show-on-rail',
				/* translators: %s: "dock" or "sidebar". */
				label: sprintf( __( 'Also show on %s' ), railWord ),
				icon: 'dashicons-menu',
				onPick: () => setRegion( item, 'rail', true ),
			} );
		}
	}
	// Only offered once the item is actually somewhere: on a tile that
	// is merely running, "hide everywhere" would be a no-op the moment
	// the window closes.
	if ( onRail( placement ) || onDesktop( placement ) ) {
		options.push( {
			id: 'hide-everywhere',
			label: __( 'Hide everywhere' ),
			icon: 'dashicons-no',
			danger: true,
			onPick: () => setPlacement( item, 'hidden' ),
		} );
	}

	options.push( {
		id: 'open-settings',
		label: __( 'Navigation settings…' ),
		icon: 'dashicons-admin-generic',
		onPick: () => {
			const api = getApi();
			api?.openOsSettings?.( { tabId: 'navigation' } );
		},
	} );

	// When the tile is owned by an active, deactivatable plugin, surface
	// a danger action at the bottom. `pluginFile` is `null` for core
	// menus, mu-plugins, drop-ins, and OpenStation itself — see
	// `openstation_resolve_menu_plugin_file()`.
	if ( opts.pluginFile ) {
		const pluginFile = opts.pluginFile;
		// Prefer the owning plugin's display name so a sub-page tile
		// (e.g. WC's "Analytics") reads as "Deactivate WooCommerce…".
		// Falls back to the tile title for plugins whose `Name:` header
		// is missing — extremely rare, but cheaper than throwing.
		const pluginLabel = opts.pluginName || opts.title;
		options.push( { kind: 'separator' } );
		options.push( {
			id: 'deactivate-plugin',
			// translators: %s is the owning plugin's display name.
			label: sprintf( __( 'Deactivate %s…' ), pluginLabel ),
			icon: 'dashicons-trash',
			danger: true,
			onPick: () => {
				void confirmAndDeactivatePlugin( pluginFile, pluginLabel );
			},
		} );
	}

	const menu = document.createElement( 'os-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( 'os-item-visibility-menu' );
	( menu as HTMLElement ).dataset.itemId = opts.id;
	menu.style.position = 'fixed';
	// Off-screen first so we can measure size before placement.
	// `placeAfterRender` owns the hiding, so no `visibility` here:
	// one invariant, one owner.
	menu.style.left = '-9999px';
	menu.style.top = '-9999px';
	// Must sit above the dock-peek popover (z-index: 999999 in
	// assets/css/dock-peek.css). The peek is still visible when the
	// user right-clicks a tile, so without this the menu opens
	// underneath the thumbnail strip.
	menu.style.zIndex = '1000000';

	type PickableOption = Exclude< MenuOption, { kind: 'separator' } >;
	const byKey = new Map< string, PickableOption >();
	for ( const opt of options ) {
		if ( opt.kind === 'separator' ) {
			const hr = document.createElement( 'hr' );
			// Pull the separator color from a CSS variable so light-mode
			// docks and theme overrides can re-color it without touching
			// JS. Fallback matches the dark dock chrome the rest of
			// `<os-context-menu>` is built against.
			hr.style.cssText =
				'border: 0; border-top: 1px solid var( --os-ui-context-menu-separator-color, rgba(255,255,255,0.12) ); margin: 4px 6px;';
			menu.appendChild( hr );
			continue;
		}
		byKey.set( opt.id, opt );
		const node = document.createElement( 'os-context-menu-option' );
		// `<os-context-menu-option>` emits `detail.id` from
		// `dataset.menuItemId` (falling back to the element's `id`
		// attribute). Set it so the pick listener can route by our
		// opt.id; the `value` attr stays for compatibility with code
		// that switches on `detail.value`.
		( node as HTMLElement ).dataset.menuItemId = opt.id;
		node.setAttribute( 'value', opt.id );
		if ( opt.icon ) {
			node.setAttribute( 'icon', opt.icon );
		}
		if ( opt.danger ) {
			node.setAttribute( 'danger', '' );
		}
		node.textContent = opt.label;
		menu.appendChild( node );
	}

	menu.addEventListener( 'os-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string; value: string } > ).detail;
		// Prefer `detail.id` (the option's `dataset.menuItemId`) but
		// fall back to `detail.value` for robustness — both carry our
		// opt.id, set above. Reading only `detail.id` was the bug: when
		// it was unset on the option, the lookup silently returned
		// undefined and every pick no-op'd.
		const key = detail?.id || detail?.value || '';
		const opt = byKey.get( key );
		closeMenu();
		try {
			opt?.onPick();
		} catch {
			/* swallow — bad opener shouldn't crash the shell */
		}
	} );

	document.body.appendChild( menu );
	activeMenu = menu;

	// `placeAfterRender` measures on the next animation frame, AFTER
	// the component has completed its microtask render. Measuring
	// synchronously here returns a near-zero height (shadow DOM not
	// populated yet) — which made dock right-clicks land the
	// "anchor-above-cursor" math at `opts.y - 0 - 8 ≈ opts.y`,
	// pushing the bottom dock's menu off-screen below the viewport.
	// This menu does its own placement rather than calling
	// `clampToViewport` because the dock case anchors the menu's
	// bottom edge at the cursor unconditionally.
	placeAfterRender( menu, ( rect ) => {
		const margin = 8;
		let left = opts.x;
		let top: number;
		// Dock right-clicks ALWAYS anchor the menu's bottom edge at the
		// cursor (i.e., the menu opens upward). The dock hugs a
		// viewport edge — bottom for the taskbar, left/right for side
		// docks — so anchoring below the cursor reliably pushes the
		// menu off-screen. Desktop-icon right-clicks default to opening
		// below the cursor (natural OS-style menu) and only flip up
		// when they would overflow the viewport.
		if ( opts.surface === 'dock' ) {
			top = Math.max( margin, opts.y - rect.height - margin );
		} else {
			top = opts.y;
			if ( top + rect.height + margin > window.innerHeight ) {
				top = Math.max( margin, opts.y - rect.height );
			}
		}
		if ( left + rect.width + margin > window.innerWidth ) {
			left = Math.max( margin, opts.x - rect.width );
		}
		menu.style.left = `${ left }px`;
		menu.style.top = `${ top }px`;
	} );

	// Outside-click + Escape dismisser.
	const onOutside = ( ev: MouseEvent ): void => {
		if ( ! activeMenu ) {
			return;
		}
		if ( ! activeMenu.contains( ev.target as Node ) ) {
			closeMenu();
			document.removeEventListener( 'mousedown', onOutside, true );
			document.removeEventListener( 'keydown', onKey, true );
		}
	};
	const onKey = ( ev: KeyboardEvent ): void => {
		if ( ev.key === 'Escape' ) {
			closeMenu();
			document.removeEventListener( 'mousedown', onOutside, true );
			document.removeEventListener( 'keydown', onKey, true );
		}
	};
	document.addEventListener( 'mousedown', onOutside, true );
	document.addEventListener( 'keydown', onKey, true );
}

/**
 * Confirm + deactivate a plugin by file path. On success the dock
 * auto-refreshes via the existing `os-plugins-changed`
 * postMessage path that the chromeless bridge fires when WP repaints
 * the admin menu — but the user right-clicked from the shell, not
 * from `plugins.php`, so we additionally call `wp.os.refreshMenu()`
 * (when available) to trigger the hidden-iframe probe.
 */
async function confirmAndDeactivatePlugin(
	pluginFile: string,
	title: string,
): Promise< void > {
	const confirmed = await osConfirm( {
		/* translators: %s: plugin title. */
		title: sprintf( __( 'Deactivate %s?' ), title ),
		message: __(
			'This plugin will stop running on the site. You can re-activate it later from the Plugins screen.',
		),
		confirmLabel: __( 'Deactivate' ),
		cancelLabel: __( 'Cancel' ),
		danger: true,
	} );
	if ( ! confirmed ) {
		return;
	}

	type ConfigShape = { restRoot?: string; restNonce?: string };
	const cfg =
		( window as unknown as { openStationConfig?: ConfigShape } )
			.openStationConfig ?? {};
	const restRoot =
		typeof cfg.restRoot === 'string' && cfg.restRoot
			? cfg.restRoot
			: `${ window.location.origin }/wp-json/`;
	const restNonce =
		typeof cfg.restNonce === 'string' && cfg.restNonce ? cfg.restNonce : '';

	// Core's REST route is registered with regex
	// `(?P<plugin>[^.\/]+(?:\/[^.\/]+)?)` — segments may not contain
	// dots, which means the `.php` extension on the plugin file MUST
	// be stripped before it goes into the URL (Core's REST controller
	// already returns the stripped form on read). And literal slashes
	// must be preserved (Apache's `AllowEncodedSlashes Off` default
	// rejects `%2F`), so we encode each segment individually and
	// rejoin with `/`. Same pattern as the plugins-window's
	// `encodePluginPath()`.
	const stripped = pluginFile.endsWith( '.php' )
		? pluginFile.slice( 0, -4 )
		: pluginFile;
	const encoded = stripped
		.split( '/' )
		.map( encodeURIComponent )
		.join( '/' );
	const url = joinRestUrl( restRoot, `wp/v2/plugins/${ encoded }` );

	try {
		const res = await trackedFetch(
			url,
			{
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': restNonce,
				},
				body: JSON.stringify( { status: 'inactive' } ),
				credentials: 'same-origin',
			},
			{ source: 'desktop-mode/dock-deactivate-plugin' },
		);
		if ( ! res.ok ) {
			throw new Error( `HTTP ${ res.status }` );
		}
	} catch ( err ) {
		showToast( {
			message: sprintf(
				/* translators: %s: plugin title. */
				__( 'Could not deactivate %s.' ),
				title,
			),
			duration: 4000,
		} );
		// Surface for debugging — the activity-bus already logged the
		// failed fetch through trackedFetch.
		// eslint-disable-next-line no-console
		console.error( '[openstation] deactivate plugin failed', err );
		return;
	}

	// Close every open window that belongs to the deactivated plugin —
	// otherwise the user is left with an iframe pointing at a now-403
	// admin route (or a native window whose render bundle just stopped
	// loading). Walk the current menu, find dock items whose
	// `pluginFile` matches the target, then close every instance
	// keyed by that item's derived window id.
	const closedTitles = closeWindowsForPlugin( pluginFile );

	const deactivatedMsg =
		closedTitles.length > 0
			? sprintf(
				/* translators: 1: plugin title. 2: number of windows that were closed. */
				__( '%1$s deactivated. Closed %2$d window(s).' ),
				title,
				closedTitles.length,
			)
			: sprintf(
				/* translators: %s: plugin title. */
				__( '%s deactivated.' ),
				title,
			);
	showToast( { message: deactivatedMsg, duration: 3000 } );

	// Ask the shell to repaint the dock from a fresh menu probe. The
	// dock's own `os-plugins-changed` listener will pick up
	// the new $menu shape and remove the now-inactive plugin's tile.
	const w = window as unknown as {
		wp?: { os?: { refreshMenu?: () => void } };
	};
	w.wp?.os?.refreshMenu?.();
}

/**
 * Close every open window owned by `pluginFile`. Returns the titles
 * of windows that were closed (used by the deactivation toast).
 *
 * Lookup pathway:
 *
 *   1. Read the current dock items via `wp.os.getMenuItems()`.
 *      Each item carries the `pluginFile` resolved server-side.
 *   2. For each matching item, derive the window `baseId` from its
 *      url and close every instance under that base (`getAllByBaseId`)
 *      plus any singleton keyed under the dock item id itself
 *      (`getById( item.id )`).
 *   3. Also walk every open window once more by url substring — covers
 *      `admin.php?page=<plugin-slug>…` instances that diverged from the
 *      registered dock url (deep links, custom navigations).
 */
function closeWindowsForPlugin( pluginFile: string ): string[] {
	interface DockItemLike {
		id: string;
		title: string;
		url: string;
		pluginFile?: string | null;
	}
	interface WindowLike {
		id: string;
		iframe?: HTMLIFrameElement | null;
		config?: { title?: string; baseId?: string; url?: string };
		close: () => void;
	}
	interface ShellShim {
		getMenuItems?: () => DockItemLike[];
		deriveWindowId?: ( url: string ) => string;
		windowManager?: {
			getAll?: () => WindowLike[];
		};
	}
	const api = ( window as unknown as { wp?: { os?: ShellShim } } )
		.wp?.os;
	if ( ! api?.windowManager?.getAll ) {
		return [];
	}

	const items = api.getMenuItems?.() ?? [];
	const owned = items.filter( ( i ) => i.pluginFile === pluginFile );
	if ( owned.length === 0 ) {
		return [];
	}

	// Build the set of identity keys that any owned tile could
	// produce: the slug-derived dock id AND the URL-derived window
	// baseId (they typically agree, but session-restored or
	// cross-rail tiles can diverge).
	const ownedKeys = new Set< string >();
	for ( const item of owned ) {
		ownedKeys.add( item.id );
		if ( api.deriveWindowId ) {
			ownedKeys.add( api.deriveWindowId( item.url ) );
		}
	}

	// Walk every open window once and check ownership four ways. Each
	// path independently catches a real-world case the others miss:
	// matching by `id` covers freshly opened singletons; matching by
	// `config.baseId` covers multi-instance windows whose `id` is
	// suffixed (`<baseId>-2`); deriving from `config.url` covers
	// windows opened with a URL that differs from the dock item's
	// landing URL (deep links); deriving from the live iframe URL
	// covers windows that navigated away from where they started.
	const toClose = new Map< string, WindowLike >();
	const windows = api.windowManager.getAll() ?? [];
	const derive = api.deriveWindowId;
	for ( const w of windows ) {
		if ( ownedKeys.has( w.id ) ) {
			toClose.set( w.id, w );
			continue;
		}
		if ( w.config?.baseId && ownedKeys.has( w.config.baseId ) ) {
			toClose.set( w.id, w );
			continue;
		}
		if ( derive && w.config?.url ) {
			const derivedFromConfig = derive( w.config.url );
			if ( ownedKeys.has( derivedFromConfig ) ) {
				toClose.set( w.id, w );
				continue;
			}
		}
		if ( derive && w.iframe ) {
			// `iframe.src` reflects the iframe's CURRENT location, not
			// just its initial URL — covers the case where the user
			// navigated a single window through several WC subpages.
			let liveUrl = '';
			try {
				liveUrl = w.iframe.src || '';
			} catch {
				/* cross-origin iframe — leave liveUrl empty */
			}
			if ( liveUrl ) {
				const derivedFromLive = derive( liveUrl );
				if ( ownedKeys.has( derivedFromLive ) ) {
					toClose.set( w.id, w );
				}
			}
		}
	}

	const titles: string[] = [];
	for ( const w of toClose.values() ) {
		titles.push( w.config?.title ?? w.id );
		try {
			w.close();
		} catch {
			/* swallow — one bad close shouldn't block the rest */
		}
	}
	return titles;
}
