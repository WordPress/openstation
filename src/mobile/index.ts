/**
 * Desktop Mode — Mobile / responsive layer.
 *
 * Detects the responsive mode (`'desktop' | 'tablet' | 'mobile'`),
 * stamps it on `<html data-wp-desktop-mode="…">`, dispatches a
 * `RESPONSIVE_MODE_CHANGED` action + `wp-desktop-mode-changed`
 * CustomEvent on every flip, and — when the mode is `'mobile'` —
 * mounts the bottom thumbnail switcher and applies the mobile
 * window-shape policy (force-maximize, suppress drag/resize,
 * suppress min/max controls).
 *
 * The CSS in `assets/css/mobile.css` does the heavy visual lifting.
 * This module owns the thin TS layer that has to react to runtime
 * state — viewport changes, window open/close/focus, mode flips.
 *
 * @since 0.7.0
 */

import {
	HOOKS,
	addAction,
	addFilter,
	applyFilters,
	doAction,
} from '../hooks';
import type { DesktopConfig, DesktopMode } from '../types';
import type { WindowManager } from '../window-manager';
import { RadialLauncher } from './radial';
import { repaintDesktopIcons } from '../desktop-icons';

const MODE_ATTR = 'data-wp-desktop-mode';

const DEFAULT_BREAKPOINTS = { mobile: 640, tablet: 1024 } as const;

let _override: DesktopMode | null = null;
let _currentMode: DesktopMode = 'desktop';
let _breakpoints: { mobile: number; tablet: number } = { ...DEFAULT_BREAKPOINTS };
const _subscribers = new Set<( mode: DesktopMode ) => void>();

/**
 * Resolve a mode for a given viewport width. Plugins can override
 * the result via the `desktop_mode_responsive_resolve` filter.
 */
export function resolveMode( width: number ): DesktopMode {
	let base: DesktopMode;
	if ( _override ) {
		base = _override;
	} else if ( width <= _breakpoints.mobile ) {
		base = 'mobile';
	} else if ( width <= _breakpoints.tablet ) {
		base = 'tablet';
	} else {
		base = 'desktop';
	}
	return applyFilters< DesktopMode, [ { width: number } ] >(
		'desktop_mode_responsive_resolve',
		base,
		{ width },
	);
}

/** Read the current resolved mode. Cheap synchronous accessor. */
export function getMode(): DesktopMode {
	return _currentMode;
}

/** Subscribe to mode flips. Returns an unsubscribe function. */
export function subscribe( fn: ( mode: DesktopMode ) => void ): () => void {
	_subscribers.add( fn );
	return () => {
		_subscribers.delete( fn );
	};
}

/**
 * Force a mode regardless of viewport (in-memory only — does not
 * persist). Pass `null` to clear the override and resume
 * viewport-driven detection. Useful for testing and for the rare
 * power-user "always desktop on this phone" preference.
 */
export function setOverride( mode: DesktopMode | null ): void {
	_override = mode;
	tick();
}

/**
 * Mobile mode pins every window to the maximized rect. This
 * supersedes the saved geometry while mobile is active; on flip back
 * to desktop the windows return to their saved geometry through
 * `toggleMaximize` because we set `state = 'maximized'` and capture
 * `_savedGeometry` first.
 */
function maximizeAll( manager: WindowManager ): void {
	for ( const win of manager.getAll() ) {
		if ( win.state !== 'maximized' && win.state !== 'minimized' ) {
			try {
				win.maximize();
			} catch {
				/* swallow — one bad window mustn't strand the rest */
			}
		}
	}
}

/**
 * Tick the probe — recompute mode from the viewport, apply the
 * attribute, fire events when it changes.
 */
let _scheduled = false;
function tick(): void {
	if ( _scheduled ) {
		return;
	}
	_scheduled = true;
	requestAnimationFrame( () => {
		_scheduled = false;
		const width = window.innerWidth;
		const next = resolveMode( width );
		if ( next === _currentMode ) {
			return;
		}
		const prev = _currentMode;
		_currentMode = next;
		document.documentElement.setAttribute( MODE_ATTR, next );
		const detail = {
			from: prev,
			to: next,
			viewport: { width, height: window.innerHeight },
		};
		doAction( HOOKS.RESPONSIVE_MODE_CHANGED, detail );
		document.dispatchEvent(
			new CustomEvent( 'wp-desktop-mode-changed', { detail } ),
		);
		_subscribers.forEach( ( fn ) => {
			try {
				fn( next );
			} catch {
				/* swallow */
			}
		} );
	} );
}

/**
 * Bootstrap the responsive layer. Called from `desktop.ts` after the
 * window manager exists. Idempotent.
 */
export function bootMobile(
	manager: WindowManager,
	options: {
		breakpoints?: { mobile: number; tablet: number };
		initialMode?: DesktopMode;
		config?: DesktopConfig;
	} = {},
): void {
	if ( options.breakpoints ) {
		_breakpoints = { ...options.breakpoints };
	}

	// Use the server's initial guess to stamp the attribute before the
	// first probe tick — eliminates a one-frame flash of desktop chrome
	// on phones. Leave `_currentMode` at the default `'desktop'` so the
	// first real tick fires `RESPONSIVE_MODE_CHANGED` and the
	// subscribers below mount the launcher / force-maximize windows.
	if ( options.initialMode ) {
		document.documentElement.setAttribute( MODE_ATTR, options.initialMode );
	}

	// Mode-driven radial launcher mount/unmount. Replaces the old
	// bottom thumbnail strip — see `./radial.ts`.
	let launcher: RadialLauncher | null = null;
	subscribe( ( mode ) => {
		if ( mode === 'mobile' ) {
			if ( ! launcher && options.config ) {
				launcher = new RadialLauncher( manager, options.config );
				launcher.mount();
			}
			maximizeAll( manager );
		} else if ( launcher ) {
			launcher.unmount();
			launcher = null;
		}
	} );

	// Mobile mode vetoes drag and resize. The pointer handlers read
	// the mode attribute directly to avoid an import cycle, so the
	// filter only needs to fire — no module-level state to maintain
	// here. Plugins can layer additional vetoes on top.
	addFilter<
		boolean,
		[ { windowId: string; mode: DesktopMode; event: PointerEvent } ]
	>(
		HOOKS.WINDOW_DRAG_ALLOWED,
		'wp-desktop-mode/mobile',
		( allowed, { mode } ) => ( mode === 'mobile' ? false : allowed ),
	);
	addFilter<
		boolean,
		[ { windowId: string; mode: DesktopMode; event: PointerEvent } ]
	>(
		HOOKS.WINDOW_RESIZE_ALLOWED,
		'wp-desktop-mode/mobile',
		( allowed, { mode } ) => ( mode === 'mobile' ? false : allowed ),
	);

	// Force-maximize on every new window while in mobile mode.
	addAction< [ { windowId: string } ] >(
		HOOKS.WINDOW_OPENED,
		'wp-desktop-mode/mobile-maximize',
		( { windowId } ) => {
			if ( _currentMode !== 'mobile' ) {
				return;
			}
			const win = manager.getById( windowId );
			if ( win && win.state !== 'maximized' ) {
				try {
					win.maximize();
				} catch {
					/* swallow */
				}
			}
		},
	);

	// Scroll new iframes to the top once their bridge announces
	// readiness. WordPress admin pages on narrow viewports often
	// land scrolled to a focused field, an admin notice, or the
	// last save's status banner — fine on desktop where a 1080-px
	// page rarely scrolls, jarring on mobile where the user
	// instinctively expects "open page = top of page". Same-origin
	// iframes let us call `contentWindow.scrollTo` directly.
	addAction< [ { windowId: string } ] >(
		HOOKS.IFRAME_READY,
		'wp-desktop-mode/mobile-scroll-top',
		( { windowId } ) => {
			if ( _currentMode !== 'mobile' ) {
				return;
			}
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			const iframe = ( win as unknown as { iframe?: HTMLIFrameElement } )
				.iframe;
			if ( ! iframe ) {
				return;
			}
			try {
				iframe.contentWindow?.scrollTo( 0, 0 );
				iframe.contentDocument?.documentElement?.scrollTo( 0, 0 );
				if ( iframe.contentDocument?.body ) {
					iframe.contentDocument.body.scrollTop = 0;
				}
			} catch {
				/* cross-origin or torn-down — give up silently */
			}
		},
	);

	// In mobile mode, every admin-menu item the dock would render
	// (Dashboard, Posts, Pages, Plugins, Users, Settings, every
	// CPT, every plugin-contributed top-level page…) becomes a
	// home-screen icon on the wallpaper alongside the
	// server-registered desktop icons. Outside mobile mode we
	// don't touch the list — the dock is visible and rendering
	// dock items twice would be noise.
	type IconEntry = import( '../types' ).DesktopIconServerEntry;
	addFilter<
		readonly IconEntry[] | undefined,
		[]
	>(
		'desktop_mode_desktop_icons',
		'wp-desktop-mode/mobile-home-grid',
		( icons ) => {
			// Read live from the attribute the probe stamps on
			// `<html>` rather than the module-local `_currentMode`
			// — the attribute is set as soon as `bootMobile` runs
			// (using the server's `initialMode` guess), whereas
			// `_currentMode` lags by one rAF until the first probe
			// tick. On a phone the very first `renderDesktopIcons`
			// call would otherwise see `_currentMode === 'desktop'`
			// even though the layout is already mobile, and skip
			// the merge.
			const liveMode = document.documentElement.getAttribute(
				'data-wp-desktop-mode',
			);
			if ( liveMode !== 'mobile' ) {
				return icons;
			}
			const dockItems = options.config?.dockItems ?? [];
			if ( dockItems.length === 0 ) {
				return icons;
			}
			const existingIds = new Set( ( icons ?? [] ).map( ( i ) => i.id ) );
			const synthetic: IconEntry[] = [];
			dockItems.forEach( ( item, idx ) => {
				const id = `wpdm-mobile-dock:${ item.id }`;
				if ( existingIds.has( id ) ) {
					return;
				}
				synthetic.push( {
					id,
					title: item.title,
					icon: item.icon || 'dashicons-admin-generic',
					window: '',
					url: item.url,
					// Render dock-derived icons after the
					// server-registered ones; large offset keeps
					// custom plugin icon ordering predictable.
					position: 1000 + idx,
				} );
			} );
			return [ ...( icons ?? [] ), ...synthetic ];
		},
	);

	// Re-render the icon grid whenever we flip in or out of mobile
	// mode so the merged list takes effect immediately. We replay
	// the last `renderDesktopIcons` call with the fingerprint
	// cache busted; the filter chain re-applies under the new
	// mode and the wallpaper grid repaints in-place — no REST
	// round-trip required.
	subscribe( () => {
		try {
			repaintDesktopIcons();
		} catch {
			/* swallow — best-effort live refresh */
		}
	} );

	// Probe — single ResizeObserver on the documentElement gives us
	// width changes coalesced cheaply.
	const probe = new ResizeObserver( () => tick() );
	probe.observe( document.documentElement );

	// Also tick on orientationchange (some browsers fire that without
	// a resize) and on pageshow (BFCache restore).
	window.addEventListener( 'orientationchange', tick );
	window.addEventListener( 'pageshow', tick );

	// Initial tick — runs on next rAF so the desktop bootstrap has a
	// chance to settle first.
	tick();
}

/**
 * Public mobile API — exposed via `wp.desktop.mode` /
 * `wp.desktop.responsive`.
 */
export interface ResponsiveApi {
	subscribe: ( fn: ( mode: DesktopMode ) => void ) => () => void;
	override: ( mode: DesktopMode | null ) => void;
}

export function getResponsiveApi(): ResponsiveApi {
	return { subscribe, override: setOverride };
}
