/**
 * Right-click context menu for hiding / moving a dock tile or
 * desktop icon. Mutates the user's `itemVisibility` map via the
 * public `wp.os.updateOsSettings` writer; the layout dispatcher's
 * settings subscription handles the live re-paint.
 *
 * Two callers:
 *
 * - `Dock` — attaches a `contextmenu` listener per tile, passes
 *   `surface: 'dock'`. Menu options: "Hide from dock", "Show on
 *   desktop instead", "Hide everywhere".
 * - `renderDesktopIcons` — attaches per icon, passes
 *   `surface: 'desktop'`. Menu options: "Hide from desktop", "Move
 *   to dock", "Hide everywhere".
 *
 * The `id` passed in is the **rail-prefixed** id as it appears in
 * the DOM (`'dock:<x>'` / `'desktop:<x>'` for synthesized tiles).
 * The handler reduces it to the canonical id via
 * {@link canonicalItemId} before writing the override, so the
 * visibility map is always keyed by the registered item id.
 */

import { __, sprintf } from './i18n';
import { openWithShellOverlays } from './shell-overlays/loader';
import {
	canonicalItemId,
	resolvePlacement,
	type NativeRail,
} from './settings/item-placement';
import { osConfirm } from './ui/components/os-confirm-dialog/os-confirm-dialog';
import { placeAfterRender } from './ui/util/menu-position';
import { trackedFetch } from './tracked-fetch';
import { showToast } from './toast';
import { joinRestUrl } from './rest-url';
import type { ItemVisibility } from './settings/types';
import type { OsSettingsSnapshot } from './settings/registry';

interface OpenStationShim {
	getOsSettings?: () => OsSettingsSnapshot;
	updateOsSettings?: (
		patch: Partial< OsSettingsSnapshot >,
		opts?: { windowId?: string },
	) => void;
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

function writeVisibility(
	canonicalId: string,
	placement: ItemVisibility,
): void {
	const api = getApi();
	if ( ! api?.getOsSettings || ! api?.updateOsSettings ) {
		return;
	}
	const snap = api.getOsSettings();
	const next = { ...snap.itemVisibility };
	// Store every placement explicitly — including 'both'. We used
	// to `delete next[ canonicalId ]` here on 'both', but the absence
	// of an override falls back to the item's NATIVE rail
	// (`resolvePlacement`), so deleting collapsed "Also show on
	// desktop" / "Also show on dock" back into single-rail behavior.
	next[ canonicalId ] = placement;
	api.updateOsSettings( { itemVisibility: next } );
}

/**
 * The item's native rail, derived from the rail-synthesis prefix on
 * the DOM id. A bare id means the tile is rendered on its native rail
 * (so the native rail equals the surface it was right-clicked on); a
 * `dock:` / `desktop:` prefix names the originating rail explicitly.
 *
 * Exported for unit testing — it is otherwise an internal helper.
 */
export function railFromId(
	id: string,
	surface: 'dock' | 'desktop',
): NativeRail {
	if ( id.startsWith( 'dock:' ) ) {
		return 'dock';
	}
	if ( id.startsWith( 'desktop:' ) ) {
		return 'desktop';
	}
	return surface;
}

/**
 * Compute the placement a "Hide from <surface>" pick should write,
 * branching on the item's CURRENT placement rather than blindly
 * setting the opposite rail.
 *
 * - A 'both' item is demoted to the rail it is NOT being hidden from
 *   (it stays visible where it still belongs).
 * - A single-rail item is genuinely hidden ('hidden'). Writing the
 *   opposite rail here was the bug: "Hide from dock" on a dock-only
 *   tile wrote 'desktop' and the tile reappeared on the wallpaper
 *   instead of disappearing.
 *
 * Pure in `visibility` (the caller passes the live map) so it can be
 * unit-tested without stubbing the shell API.
 */
export function computeHideTarget(
	canonicalId: string,
	nativeRail: NativeRail,
	hideSurface: 'dock' | 'desktop',
	visibility: Record< string, ItemVisibility >,
): ItemVisibility {
	const current = resolvePlacement( canonicalId, nativeRail, visibility );
	if ( current === 'both' ) {
		return hideSurface === 'dock' ? 'desktop' : 'dock';
	}
	return 'hidden';
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

	const canonical = canonicalItemId( opts.id );
	const nativeRail = railFromId( opts.id, opts.surface );
	// Current resolved placement drives which options are offered: the
	// "Also show on <rail>" entry is hidden when the item is already on
	// that rail (it would be a no-op), and "Hide from <surface>" reads
	// the live state at pick time via computeHideTarget.
	const currentPlacement = resolvePlacement(
		canonical,
		nativeRail,
		getApi()?.getOsSettings?.().itemVisibility ?? {},
	);

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
		options.push( {
			id: 'hide-from-dock',
			label: __( 'Hide from dock' ),
			icon: 'dashicons-hidden',
			onPick: () =>
				writeVisibility(
					canonical,
					computeHideTarget(
						canonical,
						nativeRail,
						'dock',
						getApi()?.getOsSettings?.().itemVisibility ?? {},
					),
				),
		} );
		if ( currentPlacement !== 'both' ) {
			options.push( {
				id: 'show-on-desktop-too',
				label: __( 'Also show on desktop' ),
				icon: 'dashicons-desktop',
				onPick: () => writeVisibility( canonical, 'both' ),
			} );
		}
	} else {
		options.push( {
			id: 'hide-from-desktop',
			label: __( 'Hide from desktop' ),
			icon: 'dashicons-hidden',
			onPick: () =>
				writeVisibility(
					canonical,
					computeHideTarget(
						canonical,
						nativeRail,
						'desktop',
						getApi()?.getOsSettings?.().itemVisibility ?? {},
					),
				),
		} );
		if ( currentPlacement !== 'both' ) {
			options.push( {
				id: 'show-on-dock-too',
				label: __( 'Also show on dock' ),
				icon: 'dashicons-menu',
				onPick: () => writeVisibility( canonical, 'both' ),
			} );
		}
	}
	options.push( {
		id: 'hide-everywhere',
		label: __( 'Hide everywhere' ),
		icon: 'dashicons-no',
		danger: true,
		onPick: () => writeVisibility( canonical, 'hidden' ),
	} );

	options.push( {
		id: 'open-settings',
		label: __( 'Apps & Icons settings…' ),
		icon: 'dashicons-admin-generic',
		onPick: () => {
			const api = getApi();
			api?.openOsSettings?.( { tabId: 'apps-icons' } );
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
	menu.style.left = '-9999px';
	menu.style.top = '-9999px';
	menu.style.visibility = 'hidden';
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
