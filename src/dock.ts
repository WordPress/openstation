/**
 * Desktop Mode — Dock.
 *
 * Renders the icon-only dock on the left edge of the desktop.
 * Icons come from the admin menu data passed via wpDesktopConfig.dockItems.
 * The dock always starts with a WordPress logo "Show Desktop" button
 * that minimizes all open windows.
 *
 * @since 6.9.0
 */

import { activity } from './activity';
import type { WindowManager } from './window-manager';
import { deriveWindowId } from './utils';
import { __, _n, sprintf } from './i18n';
import { hashTitleToHue as _hashTitleToHue } from './ui/util/hash-hue';

/**
 * A JS-registered dock tile appended below the admin-menu items.
 *
 * System items don't come from the PHP `$menu` globals — they're shell-
 * level affordances (OS Settings, future: Jorvy, desktop widgets) that
 * know how to open themselves. The dock doesn't call into WindowManager
 * for these; it just invokes the supplied `onOpen` handler, which is
 * free to open a native window, route to a URL, or anything else.
 *
 * Kept visually separated from menu items by a dividing line so users
 * distinguish "admin pages" from "shell affordances".
 */
export interface SystemDockItem {
	/** Unique dock-internal id (for active-state tracking). */
	id: string;
	/** Display label (tooltip). */
	title: string;
	/** Icon — dashicons class, data URI, or URL. */
	icon: string;
	/** Handler invoked on click. */
	onOpen: () => void;
	/**
	 * Optional predicate: returns true when the system item currently
	 * has an open window. Drives the active-dot indicator on the tile.
	 */
	isOpen?: () => boolean;
}

/**
 * A single dock item from the PHP menu data.
 */
export interface DockItem {
	/** Unique identifier (menu slug). */
	id: string;
	/** Display label (for tooltip). */
	title: string;
	/** Icon: dashicons class, data:image/svg+xml, URL, or 'none'. */
	icon: string;
	/** Admin page URL to open. */
	url: string;
	/** Number badge (update count, comment count, etc.). 0 = no badge. */
	badge: number;
	/** Submenu items. */
	submenu: { title: string; url: string }[];
	/** Whether this admin page supports multiple open windows. */
	multi?: boolean;
	/**
	 * Which rail the item was routed to by the PHP-side heuristic
	 * (`desktop_mode_dock_placement`). `'dock'` = core WP menus on the
	 * left-edge dock; `'taskbar'` = plugin-contributed top-level
	 * menus on the bottom taskbar. Currently informational — the
	 * shell splits items by this field in `desktop.ts` before
	 * constructing the two Dock instances.
	 */
	placement?: 'dock' | 'taskbar';
}

/** Which edge of the screen the rail hugs. Drives tooltip anchoring + modifier CSS. */
export type DockOrientation = 'left' | 'bottom';

/**
 * Stable string-to-hue helper. Re-exported here for backwards-compat
 * — the canonical home is `src/ui/util/hash-hue.ts` so `<wpd-avatar>`
 * can share it without depending on the dock module.
 */
export const hashTitleToHue = _hashTitleToHue;

/** Attention modes accepted by `Dock.setAttention()` and `Window.requestAttention()`. */
export type DockAttentionMode = 'pulse' | 'shake' | 'bounce' | null;

/** Visual intensity for an attention animation. */
export type DockAttentionIntensity = 'subtle' | 'normal' | 'strong';

/** Options for `Dock.setAttention()` / `Window.requestAttention()`. */
export interface DockAttentionOptions {
	/** Auto-clear after this many ms. `0` = until cleared by another call. Default 4000. */
	durationMs?: number;
	/** Animation intensity. Default `'normal'`. */
	intensity?: DockAttentionIntensity;
}

/**
 * Dock class.
 *
 * Manages the dock element, its icons, tooltips, and interaction with
 * the window manager. Rendered either on the left edge (core WP
 * menus — the classic dock) or along the bottom (installed-plugin
 * menus — the macOS-style taskbar), controlled by `orientation`. The
 * two instances share all of this class's logic; only CSS classes +
 * tooltip positioning differ.
 */
export class Dock {
	/**
	 * Monotonic instance counter used to build unique hook-registration
	 * namespaces for each `Dock`. Without this, the left dock and the
	 * bottom taskbar would share a namespace and WP's `addAction`
	 * de-dup would silently drop whichever registered first.
	 */
	private static _instanceSeq = 0;

	private container: HTMLElement;
	private windowManager: WindowManager;
	private items: DockItem[];
	private tooltip: HTMLElement;
	private itemElements: Map<string, HTMLElement> = new Map();
	private adminUrl: string;
	private orientation: DockOrientation;
	private systemItems: SystemDockItem[] = [];
	private systemItemElements: Map<string, HTMLElement> = new Map();
	private systemSeparator: HTMLElement | null = null;

	/**
	 * Active attention timers, keyed by item id. Used to cancel a
	 * pending auto-clear when a fresh `setAttention()` call comes in
	 * before the previous duration has elapsed.
	 */
	private attentionTimers: Map<string, number> = new Map();

	constructor(
		container: HTMLElement,
		windowManager: WindowManager,
		items: DockItem[],
		adminUrl: string,
		orientation: DockOrientation = 'left',
	) {
		this.container = container;
		this.windowManager = windowManager;
		this.items = items;
		this.adminUrl = adminUrl;
		this.orientation = orientation;

		// Mark the container with the orientation modifier so CSS can
		// flip flex-direction, indicator-dot position, etc. The base
		// `.wp-desktop-dock` class still applies — shared styling
		// stays shared, only the deltas live behind the modifier.
		this.container.classList.add(
			orientation === 'bottom'
				? 'wp-desktop-dock--horizontal'
				: 'wp-desktop-dock--vertical',
		);

		// Create tooltip element (shared across all items).
		this.tooltip = document.createElement( 'div' );
		this.tooltip.className = 'wp-desktop-dock__tooltip';
		this.tooltip.setAttribute( 'role', 'tooltip' );
		if ( orientation === 'bottom' ) {
			this.tooltip.classList.add( 'wp-desktop-dock__tooltip--above' );
		}
		document.body.appendChild( this.tooltip );

		this.render();
		this.bindWindowEvents();
	}

	/**
	 * Replace the menu-derived tile list with a fresh one, preserving
	 * any JS-registered system tiles (OS Settings today, Jorvy /
	 * widgets later). Used by the live menu-refresh path: after a
	 * plugin is activated or deactivated, the shell refetches the
	 * split payload from `/wp-desktop/v1/menu` and calls this on
	 * both rails so the dock + taskbar repaint without a tab reload.
	 *
	 * Old menu tiles are removed from both the DOM and the lookup
	 * map; new tiles are inserted before the system separator (or
	 * appended at the end if none exists yet), so the menu-items →
	 * hairline → system-items ordering stays intact. Active-state
	 * classes are re-computed once the new tiles are in place so
	 * window indicators survive the swap.
	 *
	 * @param items New DockItem list. Pass `[]` to clear everything
	 *              menu-derived — common when the last plugin on the
	 *              taskbar is deactivated.
	 */
	public replaceItems( items: DockItem[] ): void {
		for ( const el of this.itemElements.values() ) {
			el.remove();
		}
		this.itemElements.clear();

		this.items = items;

		for ( const item of items ) {
			const btn = this.createItemButton( item );
			this.itemElements.set( item.id, btn );
			if ( this.systemSeparator ) {
				this.container.insertBefore( btn, this.systemSeparator );
			} else {
				this.container.appendChild( btn );
			}
		}

		this.updateActiveStates();
	}

	/**
	 * True when the rail currently has ANY renderable tile —
	 * either a menu-derived item or a JS-registered system item.
	 * Lets callers (the shell's live-refresh path) decide whether
	 * to hide the whole rail without having to peek into two
	 * internal maps. "System tiles keep the rail alive even when
	 * menu items are empty" is the user-visible contract we enforce.
	 */
	public hasItems(): boolean {
		return this.itemElements.size > 0 || this.systemItemElements.size > 0;
	}

	/**
	 * Remove a previously-registered system item. Used by the
	 * server-driven native-window sync path — when a plugin is
	 * deactivated, its native-window entry disappears from the
	 * server's payload and the shell calls this to pull the tile
	 * back off the rail without a reload.
	 *
	 * Idempotent: an unknown id is a silent no-op. The system
	 * separator is kept in place as long as at least one system
	 * item remains; removing the last system item also strips the
	 * separator so the rail doesn't dangle a divider under nothing.
	 */
	public removeSystemItem( id: string ): void {
		const tile = this.systemItemElements.get( id );
		if ( ! tile ) {
			return;
		}
		tile.remove();
		this.systemItemElements.delete( id );
		this.systemItems = this.systemItems.filter( ( s ) => s.id !== id );

		if ( this.systemItemElements.size === 0 && this.systemSeparator ) {
			this.systemSeparator.remove();
			this.systemSeparator = null;
		}
	}

	/**
	 * Set the badge count on a tile. Live-updates without a full
	 * dock re-render — the existing tile's badge node is mutated in
	 * place (or created if missing). Pass `0` to remove the badge.
	 *
	 * Resolves the tile in id order: menu items (`data-menu-slug`)
	 * first, then system items (`data-system-id`), so callers can
	 * use the same id surface regardless of which rail the tile
	 * happens to live on.
	 *
	 * Idempotent: applying the same count is a no-op (no DOM mutation).
	 *
	 * @since 0.22.0
	 *
	 * @param itemId Tile id (menu slug for admin pages, system id
	 *               for `appendSystemItem` / `registerSystemTile`).
	 * @param count  Non-negative integer. `>99` renders as `99+`.
	 */
	public setBadge( itemId: string, count: number ): void {
		const tile = this._resolveTileElement( itemId );
		if ( ! tile ) {
			return;
		}
		const safe = Math.max( 0, Math.floor( count ) );
		const primary = tile.querySelector< HTMLElement >(
			'.wp-desktop-dock__item-primary',
		);
		const host = primary ?? tile;
		_applyBadgeNode( host, safe );
		document.dispatchEvent(
			new CustomEvent( 'wpd-dock-item-badge-changed', {
				detail: { itemId, count: safe },
			} ),
		);
		// Mirror the change on the activity bus so a global
		// notification-center widget can aggregate badges across
		// every plugin without having to bind low-level DOM events
		// or know which rail (dock vs taskbar) emitted them.
		activity.publish( 'wp-desktop/badge-changed', {
			itemId,
			count: safe,
		} );
	}

	/**
	 * Clear the badge on a tile. Equivalent to `setBadge( id, 0 )`.
	 *
	 * @since 0.22.0
	 */
	public clearBadge( itemId: string ): void {
		this.setBadge( itemId, 0 );
	}

	/**
	 * Apply or clear an attention animation on a tile.
	 *
	 *   - `'pulse'`  — soft halo + scale, ~1.4 s loop. Default.
	 *   - `'shake'`  — short horizontal jiggle.
	 *   - `'bounce'` — vertical bob, attention-grabbing.
	 *   - `null`     — clear any active attention.
	 *
	 * Animations are gated on `prefers-reduced-motion: no-preference`;
	 * the reduced-motion fallback shows a static accent ring for the
	 * same duration so the affordance still works. `durationMs` of
	 * `0` keeps the attention until the next call clears it.
	 *
	 * @since 0.22.0
	 *
	 * @param itemId Tile id.
	 * @param mode   Animation mode or `null` to clear.
	 * @param opts   Optional duration / intensity overrides.
	 */
	public setAttention(
		itemId: string,
		mode: DockAttentionMode,
		opts: DockAttentionOptions = {},
	): void {
		const tile = this._resolveTileElement( itemId );
		if ( ! tile ) {
			return;
		}

		// Cancel any pending auto-clear from a previous call.
		const pending = this.attentionTimers.get( itemId );
		if ( pending !== undefined ) {
			window.clearTimeout( pending );
			this.attentionTimers.delete( itemId );
		}

		// Strip every prior attention class before applying the new one.
		tile.classList.remove(
			'wp-desktop-dock__item--attention-pulse',
			'wp-desktop-dock__item--attention-shake',
			'wp-desktop-dock__item--attention-bounce',
			'wp-desktop-dock__item--intensity-subtle',
			'wp-desktop-dock__item--intensity-normal',
			'wp-desktop-dock__item--intensity-strong',
		);

		if ( mode === null ) {
			return;
		}

		tile.classList.add( `wp-desktop-dock__item--attention-${ mode }` );
		const intensity = opts.intensity ?? 'normal';
		tile.classList.add( `wp-desktop-dock__item--intensity-${ intensity }` );

		const duration = opts.durationMs ?? 4000;
		if ( duration > 0 ) {
			const handle = window.setTimeout( () => {
				this.attentionTimers.delete( itemId );
				this.setAttention( itemId, null );
			}, duration );
			this.attentionTimers.set( itemId, handle );
		}
	}

	/**
	 * Resolve a tile element by id — checks menu items first
	 * (`data-menu-slug`), then system items (`data-system-id`). Used
	 * by `setBadge` / `setAttention` so callers can reach either rail
	 * with one id surface.
	 */
	private _resolveTileElement( itemId: string ): HTMLElement | null {
		return (
			this.itemElements.get( itemId ) ??
			this.systemItemElements.get( itemId ) ??
			null
		);
	}

	/**
	 * Append a JS-registered system item to the dock.
	 *
	 * System items render after the menu-derived items, separated by a
	 * hairline divider. Use for shell affordances that don't live in
	 * the admin menu: OS Settings today, Jorvy and desktop widgets
	 * later. Callers supply their own `onOpen` — the dock doesn't
	 * assume the item opens a window at all.
	 */
	public appendSystemItem( item: SystemDockItem ): void {
		this.systemItems.push( item );

		if ( ! this.systemSeparator ) {
			this.systemSeparator = document.createElement( 'div' );
			this.systemSeparator.className = 'wp-desktop-dock__separator';
			this.systemSeparator.setAttribute( 'aria-hidden', 'true' );
			this.container.appendChild( this.systemSeparator );
		}

		const tile = this.createSystemItemButton( item );
		this.systemItemElements.set( item.id, tile );
		this.container.appendChild( tile );
		this.updateActiveStates();
	}

	/**
	 * Render the dock contents.
	 */
	private render(): void {
		this.container.innerHTML = '';

		// Dock items from the admin menu.
		for ( const item of this.items ) {
			const btn = this.createItemButton( item );
			this.itemElements.set( item.id, btn );
			this.container.appendChild( btn );
		}
	}

	/**
	 * Create a tile for a JS-registered system item. Structurally simpler
	 * than a menu tile — no submenu, no multi-instance rail, no badge —
	 * but uses the same base classes so the hover / focus / active
	 * styling is shared.
	 */
	private createSystemItemButton( item: SystemDockItem ): HTMLElement {
		const tile = document.createElement( 'div' );
		tile.className = 'wp-desktop-dock__item wp-desktop-dock__item--system';
		tile.dataset.systemId = item.id;

		const primary = document.createElement( 'button' );
		primary.className = 'wp-desktop-dock__item-primary';
		primary.setAttribute( 'type', 'button' );
		primary.setAttribute( 'aria-label', item.title );

		primary.appendChild( this.resolveIcon( item.icon, item.title ) );
		// System items don't have a native admin-menu counterpart; the
		// third arg is intentionally omitted.
		primary.addEventListener( 'click', () => item.onOpen() );

		tile.appendChild( primary );
		this.bindTooltip( tile, item.title );

		return tile;
	}

	/**
	 * Create a single dock icon tile.
	 *
	 * A tile is a vertical stack: the primary icon button, plus — for
	 * multi-capable pages — an instance rail rendered below it showing one
	 * dot per open window and a trailing "+" to open another. The rail is
	 * hydrated by {@link updateActiveStates}; here we only place the empty
	 * container so the DOM is stable.
	 */
	private createItemButton( item: DockItem ): HTMLElement {
		const tile = document.createElement( 'div' );
		tile.className = 'wp-desktop-dock__item';
		tile.dataset.menuSlug = item.id;
		if ( item.multi ) {
			tile.classList.add( 'wp-desktop-dock__item--multi' );
		}

		// Primary button — the icon body. Focuses existing or opens first.
		const primary = document.createElement( 'button' );
		primary.className = 'wp-desktop-dock__item-primary';
		primary.setAttribute( 'type', 'button' );
		primary.setAttribute( 'aria-label', item.title );

		const iconEl = this.resolveIcon( item.icon, item.title, item.url );
		primary.appendChild( iconEl );

		if ( item.badge > 0 ) {
			// Cap the rendered count at 99 — anything higher reads as
			// "99+" so the badge stays a clean pill instead of
			// stretching to three or four digits.
			const displayCount = item.badge > 99 ? '99+' : String( item.badge );
			const badge = document.createElement( 'span' );
			badge.className = 'wp-desktop-dock__badge';
			badge.textContent = displayCount;
			badge.setAttribute(
				'aria-label',
				sprintf(
					// translators: %d is the number of pending updates / items.
					_n( '%d update', '%d updates', item.badge ),
					item.badge,
				),
			);
			primary.appendChild( badge );
		}

		primary.addEventListener( 'click', () => {
			this.openPage( item );
		} );

		tile.appendChild( primary );

		if ( item.multi ) {
			// "Open another" chip floats off the right edge of the tile.
			// Hidden until ≥1 instance is open — nothing to add
			// alongside otherwise. Instance switching happens via the
			// per-window controls, not the dock.
			const addBtn = document.createElement( 'button' );
			addBtn.type = 'button';
			addBtn.className = 'wp-desktop-dock__item-new';
			addBtn.hidden = true;
			addBtn.setAttribute(
				'aria-label',
				// translators: %s is the admin-page title (e.g., "Posts")
				sprintf( __( 'Open another %s' ), item.title ),
			);
			addBtn.innerHTML =
				'<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">' +
				'<path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>' +
				'</svg>';
			addBtn.addEventListener( 'click', ( e: Event ) => {
				e.stopPropagation();
				this.openNewInstance( item );
			} );

			// Override the tile's shared tooltip while hovering the chip:
			// the default says the page name, but on the chip we want the
			// action verb. On pointerleave back into the tile we restore
			// the default text; leaving the tile entirely hides the
			// tooltip as usual. Touch devices never fire pointerenter
			// without an immediate click, so this is effectively
			// desktop-only by nature.
			addBtn.addEventListener( 'pointerenter', () => {
				this.positionTooltip(
					addBtn,
					// translators: %s is the admin-page title (e.g., "Posts")
					sprintf( __( 'Open new %s' ), item.title ),
				);
				this.tooltip.classList.add( 'wp-desktop-dock__tooltip--visible' );
			} );
			addBtn.addEventListener( 'pointerleave', ( e: PointerEvent ) => {
				const next = e.relatedTarget as Node | null;
				if ( next && tile.contains( next ) ) {
					this.positionTooltip( tile, item.title );
					return;
				}
				this.tooltip.classList.remove( 'wp-desktop-dock__tooltip--visible' );
			} );

			tile.appendChild( addBtn );
		}

		this.bindTooltip( tile, item.title );

		return tile;
	}

	/**
	 * Resolve a registered icon value into a DOM element.
	 *
	 * Priority: dashicons class → inline SVG data URI → image URL →
	 * letter badge derived from the item's title. The letter fallback is
	 * important for the taskbar: plugin authors routinely register
	 * top-level menus with `add_menu_page()` and omit the icon argument
	 * (defaulting to `'div'` or empty), which would otherwise render as
	 * an indistinguishable wall of generic wrenches. A colored letter
	 * tile gives each plugin a stable, unique-ish visual identity with
	 * zero plugin-side effort — the hue derives deterministically from
	 * the title so the same plugin always gets the same color.
	 *
	 * @param icon  The icon value from the menu entry.
	 * @param title Human-readable title, used when falling back to a
	 *              letter badge.
	 */
	private resolveIcon( icon: string, title: string, url?: string ): HTMLElement {
		// 1. Specific dashicon — trust what the server gave us, UNLESS
		//    it's the generic gear fallback. When the server hands us
		//    dashicons-admin-generic it usually means the plugin uses
		//    'none'/'div' for its icon and styles it from CSS — in that
		//    case we try harder via the native-menu extractor below.
		if ( icon.startsWith( 'dashicons-' ) && icon !== 'dashicons-admin-generic' ) {
			const el = document.createElement( 'span' );
			el.className = `dashicons ${ icon }`;
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		// 2. Inline SVG data URI — render as a CSS background-image.
		//    PHP already validated the base64 payload shape; we re-verify
		//    here because icons registered from JS never cross the sanitizer.
		if ( icon.startsWith( 'data:image/svg+xml;base64,' ) ) {
			const base64Part = icon.slice( 'data:image/svg+xml;base64,'.length );
			if ( /^[A-Za-z0-9+/=]+$/.test( base64Part ) ) {
				return this._makeSvgIcon( icon );
			}
			// Malformed — skip this case and try native-menu extraction.
		}

		// 3. http(s) URL — direct image.
		if ( icon.startsWith( 'http://' ) || icon.startsWith( 'https://' ) ) {
			const img = document.createElement( 'img' );
			img.className = 'wp-desktop-dock__item-img';
			img.src = icon;
			img.alt = '';
			img.setAttribute( 'aria-hidden', 'true' );
			return img;
		}

		// 4. NATIVE-MENU FALLBACK — the server couldn't produce a usable
		//    icon, but WP's hidden #adminmenu in the parent page IS
		//    rendering this plugin's icon perfectly. Copy from there.
		if ( url ) {
			const native = this._extractNativeMenuIcon( url );
			if ( native ) {
				return native;
			}
		}

		// 5. If the server said "dashicons-admin-generic" explicitly and
		//    native extraction failed, honour the gear — matches the
		//    historical behaviour so core menu items without icons still
		//    render as gears rather than letter badges.
		if ( icon === 'dashicons-admin-generic' ) {
			const el = document.createElement( 'span' );
			el.className = 'dashicons dashicons-admin-generic';
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		// 6. Nothing matched — first-letter tile on a deterministic hue.
		return this.createLetterBadge( title );
	}

	/**
	 * Build an SVG-background icon tile. Shared between the data-URI
	 * branch of {@link resolveIcon} and the native-menu extractor.
	 */
	private _makeSvgIcon( bgValue: string ): HTMLElement {
		const el = document.createElement( 'span' );
		el.className = 'wp-desktop-dock__item-svg';
		el.style.backgroundImage = bgValue.startsWith( 'url(' )
			? bgValue
			: `url("${ bgValue }")`;
		el.style.backgroundSize = 'contain';
		el.style.backgroundRepeat = 'no-repeat';
		el.style.backgroundPosition = 'center';
		el.setAttribute( 'aria-hidden', 'true' );
		return el;
	}

	/**
	 * Extract a plugin's icon from the hidden `#adminmenu` that still
	 * exists in the parent shell DOM (display:none'd by desktop.css).
	 * Handles the three shapes plugins commonly use when the menu-page
	 * icon_url is 'none' or 'div':
	 *
	 *   (a) `<img src="...">` nested inside `.wp-menu-image`
	 *   (b) a dashicon class on `.wp-menu-image` itself
	 *   (c) a CSS background-image on `.wp-menu-image::before` (the
	 *       `menu-icon-XYZ` pattern Yoast, WooCommerce, Jetpack, etc. use)
	 *
	 * Returns null when the URL doesn't match any admin-menu entry or
	 * none of the three shapes are detectable.
	 */
	private _extractNativeMenuIcon( url: string ): HTMLElement | null {
		const adminMenu = document.getElementById( 'adminmenu' );
		if ( ! adminMenu ) {
			return null;
		}

		// Match the admin-menu link by the "filename?query" suffix of
		// its href. Works for both core slugs (edit.php, upload.php,
		// options-general.php) and plugin slugs (admin.php?page=wpseo).
		let target: string;
		try {
			const u = new URL( url, window.location.href );
			const filename = u.pathname.split( '/' ).pop() || '';
			target = filename + u.search;
		} catch {
			return null;
		}
		if ( ! target ) {
			return null;
		}

		const links = adminMenu.querySelectorAll< HTMLAnchorElement >( 'li.menu-top > a' );
		let matchLi: HTMLElement | null = null;
		for ( const link of Array.from( links ) ) {
			if ( link.href.endsWith( target ) ) {
				matchLi = link.closest( 'li.menu-top' );
				break;
			}
		}
		if ( ! matchLi ) {
			return null;
		}

		const imgWrap = matchLi.querySelector< HTMLElement >( '.wp-menu-image' );
		if ( ! imgWrap ) {
			return null;
		}

		// Shape (a): nested <img>
		const img = imgWrap.querySelector( 'img' );
		if ( img && img.src ) {
			const el = document.createElement( 'img' );
			el.className = 'wp-desktop-dock__item-img';
			el.src = img.src;
			el.alt = '';
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		// Shape (b): dashicon class on the wrap div itself.
		const dashMatch = imgWrap.className.match( /\bdashicons-[\w-]+\b/ );
		if ( dashMatch && dashMatch[ 0 ] !== 'dashicons-before' ) {
			const el = document.createElement( 'span' );
			el.className = `dashicons ${ dashMatch[ 0 ] }`;
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		// Shape (c): CSS background-image on ::before pseudo.
		const before = window.getComputedStyle( imgWrap, '::before' );
		const bg = before.backgroundImage;
		if ( bg && bg !== 'none' && ! bg.includes( 'url("")' ) ) {
			return this._makeSvgIcon( bg );
		}

		// Fallback within the native-menu branch: background-image on
		// the wrap div itself (less common but some plugins do it).
		const bgWrap = window.getComputedStyle( imgWrap ).backgroundImage;
		if ( bgWrap && bgWrap !== 'none' && ! bgWrap.includes( 'url("")' ) ) {
			return this._makeSvgIcon( bgWrap );
		}

		return null;
	}

	/**
	 * Create a letter-badge icon — a rounded square tinted with a
	 * deterministic hue derived from the title, displaying the first
	 * letter of the title. Mirrors the "app icon placeholder" look
	 * macOS uses when an app ships without artwork.
	 *
	 * The title always drives both the letter and the hue — same plugin,
	 * same color across reloads. An empty title falls through to a `?`
	 * on a neutral gray tile, but the menu builder upstream guards
	 * against empty titles, so this is a defensive branch.
	 */
	private createLetterBadge( title: string ): HTMLElement {
		const el = document.createElement( 'span' );
		el.className = 'wp-desktop-dock__item-letter';
		el.setAttribute( 'aria-hidden', 'true' );

		const trimmed = title.trim();
		// Use the first "letter" — handle accented chars, emoji, etc.
		// by grabbing the first code point rather than the first char.
		// Array.from iterates by code point, so [0] is always valid
		// for non-empty strings.
		const firstCodePoint = trimmed ? Array.from( trimmed )[ 0 ] : '?';
		el.textContent = firstCodePoint.toUpperCase();

		const hue = hashTitleToHue( trimmed );
		// Two-tone gradient for a tiny bit of depth — same hue, two
		// lightnesses. Keeps the palette harmonious while varying hue
		// across plugins.
		el.style.background = `linear-gradient(135deg, hsl(${ hue } 62% 55%), hsl(${ ( hue + 24 ) % 360 } 58% 42%))`;

		return el;
	}

	/**
	 * Bind tooltip show/hide on hover. Tooltip anchor differs per
	 * orientation: left dock → vertically centered on the tile, placed
	 * to its right via CSS; bottom taskbar → horizontally centered,
	 * placed above the tile via CSS. We set the relevant coordinate
	 * inline each enter; the CSS takes care of the rest.
	 */
	private bindTooltip( el: HTMLElement, text: string ): void {
		el.addEventListener( 'pointerenter', () => {
			this.positionTooltip( el, text );
			this.tooltip.classList.add( 'wp-desktop-dock__tooltip--visible' );
		} );

		el.addEventListener( 'pointerleave', () => {
			this.tooltip.classList.remove( 'wp-desktop-dock__tooltip--visible' );
		} );
	}

	/**
	 * Write the tooltip text + anchor coordinate for `el`. Split out
	 * because the multi-instance chip's pointerenter handler also
	 * needs to anchor to a specific element (the chip, not the tile).
	 */
	private positionTooltip( el: HTMLElement, text: string ): void {
		const rect = el.getBoundingClientRect();
		this.tooltip.textContent = text;
		if ( this.orientation === 'bottom' ) {
			// Horizontal centering; CSS handles the vertical offset.
			this.tooltip.style.left = `${ rect.left + rect.width / 2 }px`;
			this.tooltip.style.top = `${ rect.top - 14 }px`;
		} else {
			// Vertical centering; CSS handles the horizontal offset.
			this.tooltip.style.top = `${ rect.top + rect.height / 2 - 14 }px`;
			this.tooltip.style.left = '';
		}
	}

	/**
	 * Open an admin page in a window (or focus if already open).
	 */
	private openPage( item: DockItem ): void {
		const baseId = this.deriveWindowId( item.url );

		this.windowManager.open( {
			id: baseId,
			baseId,
			url: item.url,
			title: item.title,
			icon: item.icon.startsWith( 'dashicons-' ) ? item.icon : 'dashicons-admin-generic',
			submenu: item.submenu,
			multi: !! item.multi,
		} );
	}

	/**
	 * Open a brand-new instance of a multi-capable page, even if one is
	 * already open. Invoked by the "+" chip on the dock icon.
	 */
	private openNewInstance( item: DockItem ): void {
		const baseId = this.deriveWindowId( item.url );

		this.windowManager.openNew( {
			id: baseId,
			baseId,
			url: item.url,
			title: item.title,
			icon: item.icon.startsWith( 'dashicons-' ) ? item.icon : 'dashicons-admin-generic',
			submenu: item.submenu,
			multi: true,
		} );
	}

	/**
	 * Derive a window ID from an admin page URL.
	 */
	private deriveWindowId( url: string ): string {
		return deriveWindowId( url, this.adminUrl );
	}

	/**
	 * Listen to window events to update active/focused indicators on dock items.
	 *
	 * The event detail isn't used — we just need to re-query the
	 * window manager on every change — so the handlers take no
	 * argument and the type cast is gone with it.
	 */
	private bindWindowEvents(): void {
		const refresh = (): void => this.updateActiveStates();
		document.addEventListener( 'wp-desktop-window-opened', refresh );
		document.addEventListener( 'wp-desktop-window-closed', refresh );
		document.addEventListener( 'wp-desktop-window-focused', refresh );
		// Desktop switches change which windows count as "open on
		// the active desktop" even though the stack is unchanged.
		// Listen via the hook bus so a plugin that manually calls
		// switchDesktop() also triggers a repaint.
		//
		// Namespace is unique per Dock instance because we have TWO
		// (left dock + bottom taskbar); a shared static namespace was
		// causing wp.hooks.addAction's de-dup to drop whichever
		// registered first, leaving one of the two docks stale on
		// desktop switch. The orientation plus a monotonic counter
		// guarantees uniqueness without losing the "where did this
		// come from?" debuggability of a readable namespace.
		const ns = `wp-desktop-mode/dock-${ this.orientation }-${ ++Dock._instanceSeq }`;
		window.wp?.hooks?.addAction?.(
			'wp-desktop.desktop.switched',
			ns,
			refresh,
		);
		window.wp?.hooks?.addAction?.(
			'wp-desktop.desktop.closed',
			ns,
			refresh,
		);
	}

	/**
	 * Update the active/focused classes and multi-instance rail on every
	 * dock item in response to a window lifecycle event.
	 *
	 * For singletons the rail is absent; "active" means "the one window
	 * is open". For multi-capable items, active means "≥1 instance is
	 * open" and focused means "the focused window belongs to this item".
	 */
	private updateActiveStates(): void {
		const focused = this.windowManager.getFocused();
		const focusedBaseId = focused ? ( focused.config.baseId || focused.id ) : null;
		// The dock reflects the ACTIVE desktop only. Windows on
		// other desktops are invisible to the user right now —
		// showing "active" dots for them conflates "something's
		// open somewhere" with "something's open here," which is
		// what tripped up the first user on an empty desktop.
		const activeDesktopId = this.windowManager.getActiveDesktopId();
		const onActiveDesktop = ( w: { config: { desktopId?: string } } ): boolean =>
			( w.config.desktopId || activeDesktopId ) === activeDesktopId;

		for ( const item of this.items ) {
			const tile = this.itemElements.get( item.id );
			if ( ! tile ) {
				continue;
			}

			const baseId = this.deriveWindowId( item.url );
			const instances = item.multi
				? this.windowManager
					.getAllByBaseId( baseId )
					.filter( onActiveDesktop )
				: [];
			const single = this.windowManager.getById( baseId );
			const singleOpen =
				! item.multi && !! single && onActiveDesktop( single );
			const isOpen = item.multi ? instances.length > 0 : singleOpen;
			const isFocused = focusedBaseId === baseId && !! focused && onActiveDesktop( focused );

			tile.classList.toggle( 'wp-desktop-dock__item--active', isOpen );
			tile.classList.toggle( 'wp-desktop-dock__item--focused', isFocused );

			if ( item.multi ) {
				const addBtn = tile.querySelector<HTMLElement>(
					'.wp-desktop-dock__item-new',
				);
				if ( addBtn ) {
					addBtn.hidden = instances.length === 0;
				}
			}
		}

		// System items — active dot driven by the caller's predicate. No
		// focus indicator: the OS Settings window can be focused like any
		// other, and the regular tile styling picks that up naturally.
		for ( const sys of this.systemItems ) {
			const tile = this.systemItemElements.get( sys.id );
			if ( ! tile ) {
				continue;
			}
			const isOpen = sys.isOpen ? sys.isOpen() : false;
			const isFocused = !! focused && focused.id === sys.id;
			tile.classList.toggle( 'wp-desktop-dock__item--active', isOpen );
			tile.classList.toggle( 'wp-desktop-dock__item--focused', isFocused );
		}
	}
}

/**
 * Idempotently paint or remove the numeric badge on a tile host.
 *
 * Shared between `Dock.setBadge()` and any external surface that
 * decorates the same tiles (e.g. the recycle-bin badge module had
 * its own copy of this logic). Mutates the badge node in place so
 * an existing animation isn't restarted by a no-op repaint.
 *
 * @internal
 */
function _applyBadgeNode( host: HTMLElement, count: number ): void {
	const existing = host.querySelector< HTMLElement >(
		':scope > .wp-desktop-dock__badge',
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
		existing.setAttribute(
			'aria-label',
			sprintf(
				// translators: %d is the number of pending items in a dock badge.
				_n( '%d notification', '%d notifications', count ),
				count,
			),
		);
		return;
	}
	const badge = document.createElement( 'span' );
	badge.className = 'wp-desktop-dock__badge';
	badge.textContent = display;
	badge.setAttribute(
		'aria-label',
		sprintf(
			// translators: %d is the number of pending items in a dock badge.
			_n( '%d notification', '%d notifications', count ),
			count,
		),
	);
	host.appendChild( badge );
}
