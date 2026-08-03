/**
 * OpenStation — Wallpaper shortcut icons.
 *
 * Renders the list of `config.desktopIcons` entries (registered
 * server-side via `openstation_register_icon()`) as clickable
 * tiles on the desktop wallpaper. Clicking an icon opens the
 * referenced native window (via the injected `openWindow` callback)
 * or opens the URL as an iframe window / new tab.
 *
 * **Badge surface.** The icon rail mirrors the
 * dock + taskbar API exactly: `setBadge( id, count )` is
 * idempotent, `0` clears, `>99` renders `99+`. Every change emits
 * `desktop-mode/badge-changed` with `rail: 'icon'` on the activity
 * bus and {@link HOOKS.ICON_BADGE_CHANGED} on the hook bus, so a
 * plugin author writing one badge wrapper for all three rails
 * sees one consistent shape across every surface.
 *
 * **Badges survive a grid rebuild.** The badge map IS the source
 * of truth. `renderDesktopIcons` consults it at build time, so a
 * plugin that calls `setBadge( 'foo', 5 )` doesn't have to
 * re-decorate every time the live menu refresh fires
 * {@link HOOKS.DESKTOP_ICONS_RENDERED}. A badge set BEFORE its
 * icon enters the registry is honoured the moment the icon
 * appears — the framework holds the value, the renderer paints
 * it.
 *
 * Plugins that want richer icon behaviour (drag handles,
 * right-click menus, custom decorations the framework doesn't
 * own) can still subscribe to {@link HOOKS.DESKTOP_ICON_CLICKED}
 * and {@link HOOKS.DESKTOP_ICONS_RENDERED}; reach for the badge
 * API rather than DOM-scraping `[data-icon-id]` whenever the
 * decoration is "show a number on this icon."
 */

import { activity } from './activity';
import { findMenuEntryForUrl } from './desktop-files/menu-entry';
import { tryOpenExternalUrl } from './external-url';
import { __, _n, sprintf } from './i18n';
import { doAction, HOOKS } from './hooks';
import { renderIcon } from './icon';
import { getActiveDesktopThemeId } from './desktop-themes/registry';
import { slotForTileId } from './desktop-themes/slots';
import { openItemVisibilityMenu } from './item-visibility-menu-loader';
import type { DesktopIconServerEntry } from './types';
import type { WindowManager } from './window-manager';

/**
 * Click-dispatch dependencies. The icon module doesn't know how to
 * open a native window on its own — that logic lives in the shell
 * with access to the native-window registry. Passing the opener in
 * keeps this module free of global lookups.
 */
export interface DesktopIconRenderDeps {
	/**
	 * Open a native window by its registered id. Returns `true`
	 * when the window was found and opened; `false` when no window
	 * with that id is registered. `false` is the signal for the
	 * caller to fall back (e.g. the plugin has been deactivated
	 * since the icon was registered).
	 */
	openWindow: ( id: string ) => boolean;
	/** Open an URL as a same-origin admin iframe window. */
	manager: WindowManager;
	/**
	 * Convert an admin URL into the canonical window id used across
	 * EVERY shell surface — the dock, the in-shell link
	 * interceptor (admin-bar links, in-page anchors), and now the
	 * wallpaper icon rail. Sharing one id lets the window manager
	 * dedupe correctly: clicking the same app from the dock and
	 * the wallpaper icon focuses the SAME window, and lifecycle
	 * events (minimize, restore, focus) propagate to a single dock
	 * tile state. Previously the icon path generated a per-entry
	 * id (`desktop-icon-<id>`) that split the same app across two
	 * parallel windows with independent state — since fixed.
	 */
	deriveWindowId: ( url: string ) => string;
}

/* --------------------------------------------------------------- *
 *  Badge state — source of truth for the icon-rail badge surface.
 *
 *  Held at module scope so a `setBadge` call placed before the
 *  grid has rendered (or BEFORE the targeted icon enters the
 *  registry) is honoured the moment the renderer next runs.
 *  Survives every full grid rebuild driven by the live menu
 *  refresh path; the renderer consults this map at build time
 *  rather than relying on plugins to re-decorate after every
 *  `DESKTOP_ICONS_RENDERED`.
 * --------------------------------------------------------------- */

const BADGE_CLASS = 'os-icon__badge';
const _badges = new Map< string, number >();

/**
 * Coerce a raw badge input to a non-negative integer count.
 * Mirrors `Dock.setBadge`'s clamp so all three rails agree on
 * what `setBadge( id, -1 )` and `setBadge( id, 1.7 )` mean.
 */
function _safeBadge( count: number ): number {
	return Math.max( 0, Math.floor( Number( count ) || 0 ) );
}

/**
 * Set the badge count on a desktop icon. Idempotent: a no-op when
 * the count is unchanged. `0` clears. Silent no-op when the id
 * doesn't currently belong to a rendered icon — same semantics as
 * `Dock.setBadge`, so plugin authors can fan a count across every
 * rail and only the owning surface emits:
 *
 * ```ts
 * function setBadgeEverywhere( id: string, count: number ): void {
 *     wp.os.dock?.setBadge?.(    id, count );
 *     wp.os.taskbar?.setBadge?.( id, count );
 *     wp.os.icons?.setBadge?.(   id, count );
 * }
 * ```
 *
 * Three calls. One painted tile. One activity event. One hook
 * fire. The two rails that don't own the id bow out silently.
 *
 * On every applied change this fires:
 *
 *   - `desktop-mode/badge-changed` on the activity bus with
 *     `{ itemId, count, rail: 'icon' }`. Subscribe via
 *     `wp.os.activity.subscribe( 'desktop-mode/badge-changed', cb )`
 *     for global notification-center widgets that aggregate
 *     across rails.
 *   - {@link HOOKS.ICON_BADGE_CHANGED} on the hook bus with
 *     `{ iconId, count, previousCount }`. Subscribe via
 *     `wp.hooks.addAction(...)` when only the icon rail matters.
 *
 * Badges survive a grid rebuild. The renderer consults the same
 * map at build time, so a plugin that calls `setBadge( 'foo', 5 )`
 * doesn't need to re-decorate after every live menu refresh.
 *
 * @public
 *
 * @param iconId Id passed to `openstation_register_icon()`.
 * @param count  Non-negative integer. `>99` renders as `99+`.
 *               `0` removes the badge.
 */
export function setIconBadge( iconId: string, count: number ): void {
	if ( ! iconId ) {
		return;
	}
	const tile = _findIconTile( iconId );
	if ( ! tile ) {
		// Id not on this rail — silent no-op. See the docstring.
		return;
	}
	const safe = _safeBadge( count );
	const previous = _badges.get( iconId ) ?? 0;
	if ( safe === previous ) {
		return; // Idempotent — no DOM mutation, no signal storm.
	}
	if ( safe === 0 ) {
		_badges.delete( iconId );
	} else {
		_badges.set( iconId, safe );
	}
	_paintBadgeNode( tile, safe );
	activity.publish( 'desktop-mode/badge-changed', {
		itemId: iconId,
		count: safe,
		rail: 'icon',
	} );
	doAction( HOOKS.ICON_BADGE_CHANGED, {
		iconId,
		count: safe,
		previousCount: previous,
	} );
}

/**
 * Clear the badge on a desktop icon. Equivalent to
 * `setIconBadge( id, 0 )`.
 *
 * @public
 */
export function clearIconBadge( iconId: string ): void {
	setIconBadge( iconId, 0 );
}

/**
 * Read the current badge value for an icon. Synchronous — never
 * throws. Returns `0` for icons with no badge or unknown ids; a
 * boundary value plugin authors can compare against without a
 * separate "is set" check.
 *
 * Layer 1 (synchronous state) of the event-driven framework — use
 * this for "what's the current count?" reads; subscribe to the
 * activity channel for "tell me when it changes."
 *
 * @public
 */
export function getIconBadge( iconId: string ): number {
	return _badges.get( iconId ) ?? 0;
}

/**
 * Test-only reset — drops every tracked badge. Real code never
 * calls this.
 *
 * @internal
 */
export function _resetIconBadgesForTests(): void {
	_badges.clear();
	_lastFingerprint = '';
}

/**
 * Public icon-rail surface exposed on `wp.os.icons`. The
 * shape is deliberately minimal and mirrors `Dock` so plugin
 * authors can write a single badge wrapper that dispatches
 * across rails. New methods only get added here when they earn
 * a place across every rail — the cost of API drift between
 * dock / taskbar / icon is paid in plugin churn.
 *
 * @public
 */
export interface IconsApi {
	setBadge: ( iconId: string, count: number ) => void;
	clearBadge: ( iconId: string ) => void;
	getBadge: ( iconId: string ) => number;
}

/**
 * Singleton — every bundle that imports this module ends up
 * with the SAME badge map (the closure here is shared because
 * the module is only loaded by the always-on shell bundle).
 * Plugins reach this through `wp.os.icons` rather than
 * importing the symbol directly.
 *
 * @public
 */
export const iconsApi: IconsApi = {
	setBadge: setIconBadge,
	clearBadge: clearIconBadge,
	getBadge: getIconBadge,
};

/**
 * Stable serialisation of the icons-array shape we actually care
 * about. Used to skip rebuilds when the live menu-refresh path
 * fires with an identical payload — chromeless `admin_footer`
 * emits `os-plugins-changed` on every iframe paint, so
 * `applyPayload()` was previously rebuilding the icon grid
 * dozens of times during normal use, taking out anything we'd
 * appended (drag handles, custom decorations) each time. Cheap
 * fingerprint = string concat per icon; the array is small
 * (typically <10 entries).
 *
 * Badges are intentionally NOT in the fingerprint — they live
 * outside the server payload and are reconciled separately.
 */
function fingerprintIcons(
	icons: readonly DesktopIconServerEntry[] | undefined,
): string {
	if ( ! icons || icons.length === 0 ) {
		return '';
	}
	// The active desktop theme is part of the fingerprint because it
	// changes what `buildIcon` PAINTS without changing the icon list
	// at all. Leave it out and the bail-out below swallows every
	// theme switch: the entries are identical, so the grid keeps
	// showing the previous theme's artwork until something unrelated
	// perturbs the list.
	const themePrefix = `${ getActiveDesktopThemeId() ?? '' }::`;
	return themePrefix + icons
		.map(
			( i ) =>
				`${ i.id }|${ i.title }|${ i.icon }|${ i.window ?? '' }|${
					i.url ?? ''
				}|${ i.position ?? 0 }|${ i.pinned ? 1 : 0 }`,
		)
		.join( ';' );
}

let _lastFingerprint = '';

/**
 * Mount the icons grid on the desktop area. Safe to call repeatedly —
 * clears any prior container and re-renders from the current list so
 * a live menu refresh after plugin activation can rebuild the surface
 * without reloading the shell.
 *
 * Badges survive the rebuild for free: every freshly-built tile is
 * decorated from `_badges` before being inserted, so a plugin that
 * called `setIconBadge` once doesn't need to re-decorate after
 * each {@link HOOKS.DESKTOP_ICONS_RENDERED}.
 *
 * @param host  Desktop-area element (`#os-area`).
 * @param icons Ordered list from `config.desktopIcons`.
 * @param deps  See {@link DesktopIconRenderDeps}.
 */
export function renderDesktopIcons(
	host: HTMLElement,
	icons: readonly DesktopIconServerEntry[] | undefined,
	deps: DesktopIconRenderDeps,
): void {
	// Bail when the icon list hasn't changed since our last
	// render. This is the cheapest correct fix for "any plugin
	// that decorates an icon (drag handle, status dot) has its
	// node wiped on the next live menu refresh." Anything that
	// DOES change in the icons array (a plugin activated, a
	// position shifted) flips the fingerprint and triggers the
	// full rebuild.
	const fp = fingerprintIcons( icons );
	if ( fp === _lastFingerprint && host.querySelector( ':scope > .os-icons' ) ) {
		return;
	}
	_lastFingerprint = fp;

	const existing = host.querySelector( ':scope > .os-icons' );
	if ( existing ) {
		existing.remove();
	}
	if ( ! icons || icons.length === 0 ) {
		return;
	}

	const container = document.createElement( 'div' );
	container.className = 'os-icons';
	container.setAttribute( 'role', 'list' );
	container.setAttribute( 'aria-label', __( 'Desktop icons' ) );

	// Pinned (system) icons always render before unpinned ones,
	// regardless of `position`. Within each group order is preserved
	// (the server already sorts by position before this point).
	const ordered = [ ...icons ].sort( ( a, b ) => {
		const ap = a.pinned ? 0 : 1;
		const bp = b.pinned ? 0 : 1;
		return ap - bp;
	} );

	const tiles = new Map< string, HTMLElement >();
	for ( const entry of ordered ) {
		const tile = buildIcon( entry, deps );
		const stored = _badges.get( entry.id ) ?? 0;
		if ( stored > 0 ) {
			_paintBadgeNode( tile, stored );
		}
		container.appendChild( tile );
		tiles.set( entry.id, tile );
	}

	host.appendChild( container );

	// Tell decorators (drag handles, status dots, …) the grid was
	// just rebuilt so they can re-attach. Suppressed when the
	// fingerprint short-circuit above bailed — subscribers get
	// pinged exactly when the DOM actually changed. Notification
	// badges no longer need this signal: the framework persists
	// them in `_badges` and paints them as part of the build.
	//
	// `container` is the rail element; `tiles` is a frozen map of
	// id → tile element so decorators don't have to re-`querySelector`
	// each id. Mirrors the {@link HOOKS.DOCK_AFTER_RENDER}
	// `tileElements` contract.
	doAction( HOOKS.DESKTOP_ICONS_RENDERED, {
		ids: ( icons ?? [] ).map( ( i ) => i.id ),
		container,
		tiles: tiles as ReadonlyMap< string, HTMLElement >,
	} );
}

/**
 * Locate the rendered tile for an icon id. Returns null when the
 * icon isn't in the DOM right now — a normal state during the
 * window between `setIconBadge( 'foo', 5 )` and 'foo' first
 * entering the registry, or after the icon's owning plugin has
 * been deactivated.
 *
 * Uses a defensive `[data-icon-id]` lookup rather than a Map
 * because the icon DOM is rebuilt wholesale on every fingerprint
 * change; tracking element references would add a parallel
 * lifetime that the build path would have to keep in sync.
 *
 * @internal
 */
function _findIconTile( iconId: string ): HTMLElement | null {
	if ( ! iconId ) {
		return null;
	}
	const container = document.querySelector< HTMLElement >(
		'.os-icons',
	);
	if ( ! container ) {
		return null;
	}
	return container.querySelector< HTMLElement >(
		`[data-icon-id="${ _cssEscape( iconId ) }"]`,
	);
}

/**
 * Idempotently paint or remove the numeric badge on an icon tile.
 *
 * Twin of `Dock`'s `_applyBadgeNode` — different host, different
 * class, same contract. Mutates the badge node in place so an
 * existing CSS animation isn't restarted by a no-op repaint.
 *
 * @internal
 */
function _paintBadgeNode( host: HTMLElement, count: number ): void {
	const existing = host.querySelector< HTMLElement >(
		`:scope > .${ BADGE_CLASS }`,
	);
	if ( count <= 0 ) {
		existing?.remove();
		return;
	}
	const display = count > 99 ? '99+' : String( count );
	const ariaLabel = sprintf(
		// translators: %d is the number of pending items in a desktop-icon badge.
		_n( '%d notification', '%d notifications', count ),
		count,
	);
	if ( existing ) {
		if ( existing.textContent !== display ) {
			existing.textContent = display;
		}
		existing.setAttribute( 'aria-label', ariaLabel );
		return;
	}
	const badge = document.createElement( 'span' );
	badge.className = BADGE_CLASS;
	badge.textContent = display;
	badge.setAttribute( 'aria-label', ariaLabel );
	host.appendChild( badge );
}

/**
 * Polyfill-ish wrapper for `CSS.escape`. Older engines without
 * support fall through to a literal pass-through; the icon ids the
 * framework produces are already PHP-sanitised slugs so the
 * fallback is fine for the realistic id space.
 */
function _cssEscape( value: string ): string {
	const c = (
		window as unknown as {
			CSS?: { escape?: ( s: string ) => string };
		}
	).CSS;
	return c?.escape ? c.escape( value ) : value;
}

function buildIcon(
	entry: DesktopIconServerEntry,
	deps: DesktopIconRenderDeps,
): HTMLElement {
	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className = entry.pinned
		? 'os-icon os-icon--pinned'
		: 'os-icon';
	tile.dataset.iconId = entry.id;
	if ( entry.pinned ) {
		tile.dataset.pinned = '1';
	}
	tile.setAttribute( 'role', 'listitem' );
	tile.setAttribute( 'aria-label', entry.title );

	// Single canonical dispatch — `renderIcon` handles every shape
	// `entry.icon` can take: dashicons class, http(s) URL,
	// `data:image/svg+xml;base64,…` data URI, or letter-badge
	// fallback for malformed values. Keeps the wallpaper rail
	// rendering icons identically to the dock instead of falling
	// through to a broken Dashicons-class glue path for SVG data
	// URIs (an earlier bug).
	const icon = renderIcon( entry.icon, {
		title: entry.title,
		className: 'os-icon__image',
		slot: slotForTileId( entry.id ),
	} );
	tile.appendChild( icon );

	const label = document.createElement( 'span' );
	label.className = 'os-icon__label';
	label.textContent = entry.title;
	tile.appendChild( label );

	tile.addEventListener( 'click', ( e: MouseEvent ) => {
		e.stopPropagation();
		doAction( HOOKS.DESKTOP_ICON_CLICKED, {
			id: entry.id,
			target: entry.window ? 'window' : 'url',
		} );
		openTarget( entry, deps );
	} );

	// Right-click → visibility menu. Skips pinned system icons (e.g.
	// "My WordPress") which are framework-owned and shouldn't be
	// user-hideable from the wallpaper.
	tile.addEventListener( 'contextmenu', ( e: MouseEvent ) => {
		if ( entry.pinned ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		openItemVisibilityMenu( {
			x: e.clientX,
			y: e.clientY,
			id: entry.id,
			title: entry.title,
			surface: 'desktop',
		} );
	} );

	return tile;
}

function openTarget(
	entry: DesktopIconServerEntry,
	deps: DesktopIconRenderDeps,
): void {
	if ( entry.window ) {
		const opened = deps.openWindow( entry.window );
		if ( ! opened ) {
			// Referenced native window is no longer registered (the
			// owning plugin was probably deactivated). No graceful
			// fallback — the icon itself should disappear on the next
			// live menu refresh.
			return;
		}
		return;
	}
	if ( entry.url ) {
		if ( tryOpenExternalUrl( entry.url ) ) {
			return;
		}
		try {
			const parsed = new URL( entry.url, window.location.origin );
			// Use the canonical URL-derived window id so the dock
			// and the wallpaper icon converge on the SAME window
			// for the same app. Without this, clicking WooCommerce
			// from the dock opened `wp-window-admin-php-page-woocommerce`
			// while clicking the wallpaper icon opened
			// `desktop-icon-woocommerce` — two parallel windows,
			// independent minimize / focus state, no shared dock
			// indicator. See the docstring on
			// `DesktopIconRenderDeps.deriveWindowId`.
			const windowId = deps.deriveWindowId( parsed.toString() );
			// Enrich with the matching admin-menu entry so the window
			// gets the same submenu tab strip / parent-tab / multi
			// behavior as a dock open (mirrors `openItem` in
			// `desktop-layout.ts`).
			const menuEntry = findMenuEntryForUrl( parsed.toString() );
			void deps.manager.open( {
				id: windowId,
				baseId: windowId,
				url: parsed.toString(),
				parentUrl: menuEntry?.url ?? parsed.toString(),
				title: entry.title,
				icon: entry.icon,
				submenu: menuEntry?.submenu,
				multi: !! menuEntry?.multi,
			} );
		} catch {
			// Malformed URL — ignore rather than surface a broken
			// click experience. The sanitizer rejected invalid URLs
			// on the server side, so reaching this branch usually
			// means a filter mangled the value post-registration.
		}
	}
}
