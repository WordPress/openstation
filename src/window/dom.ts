/**
 * Desktop Mode — Window DOM builders.
 *
 * Pure functions that produce the initial window element tree. Called
 * once per window at construction; never touched again after the
 * `Window` constructor wires up event listeners.
 *
 * @since 0.8.1
 */

import type { WindowConfig } from '../types';
import { sanitizeClassName, urlMatchKey } from '../utils';
import { __, sprintf } from '../i18n';
// Side-effect import — registers `<wpd-spinner>` so the loading
// overlay rendered below upgrades synchronously when the body is
// connected to the document. Custom-element registrations are
// idempotent, so importing here is safe even if a downstream entry
// imported the spinner first.
// Pre-registered globally by the lazy shell-overlays bundle (Stage 10) — see src/shell-overlays/entry.ts.
import {
	markWindowContentLoading,
	markWindowContentReady,
} from '../window-channels';
import { HOOKS, applyFilters } from '../hooks';

/**
 * Carrier symbol used to stash a window's config on its outer
 * element so `ensureLoadingOverlay` can re-apply the same custom
 * render path when a plugin calls `markContentLoading()` mid-life.
 * `Symbol` keys are invisible to JSON-serializing devtools snapshots
 * and never collide with userland code that walks `el` properties.
 *
 * @internal
 */
const WINDOW_CONFIG_KEY = Symbol.for( 'desktop-mode/window-config' );

type ConfigCarrier = HTMLElement & { [ WINDOW_CONFIG_KEY ]?: WindowConfig };

/**
 * Stash the WindowConfig on the outer element. `createWindowElement`
 * calls this so post-construction helpers (`ensureLoadingOverlay`)
 * can recover the config without taking a manager dependency.
 *
 * @internal
 */
function setWindowConfigOnElement( el: HTMLElement, config: WindowConfig ): void {
	( el as ConfigCarrier )[ WINDOW_CONFIG_KEY ] = config;
}

/**
 * Read the stashed WindowConfig off an outer element. Returns
 * `undefined` for elements that didn't go through
 * `createWindowElement` (only happens in test fixtures that hand-
 * roll mocked windows; the production code always sets it).
 *
 * @internal
 */
function getWindowConfigFromElement( el: HTMLElement ): WindowConfig | undefined {
	return ( el as ConfigCarrier )[ WINDOW_CONFIG_KEY ];
}

/**
 * Origin snapshot taken at module load. The same-origin gate in
 * `withChromelessParam` compares against this value so a mutation of
 * `window.location` after boot can't relax the cross-origin guard.
 *
 * @since 0.5.0
 */
const INITIAL_ORIGIN = window.location.origin;

/**
 * Returns the URL with the chromeless query parameter set, so the iframe
 * keeps rendering without the admin shell. Returns null for cross-origin
 * URLs so the caller can refuse the navigation.
 */
export function withChromelessParam( url: string ): string | null {
	const parsed = new URL( url, INITIAL_ORIGIN );
	if ( parsed.origin !== INITIAL_ORIGIN ) {
		return null;
	}
	parsed.searchParams.set( 'desktop_mode_chromeless', '1' );
	return parsed.toString();
}

/**
 * Toggle `desktop-mode-has-fullscreen-window` on `<body>` based on whether
 * any window is currently in fullscreen state.
 *
 * Why a body class: a fullscreen window lives inside the shell, and the
 * shell creates a stacking context (positioned + z-index), so the
 * window's z-index can never rise above sibling root-level chrome like
 * `#wpadminbar`. Instead of moving the window element out of the shell
 * (fragile — event handlers, focus trap, and size-from-parent logic all
 * assume the parent is the desktop area), we hide the admin bar via CSS
 * while any fullscreen window is open. This matches macOS convention
 * (menu bar auto-hides in fullscreen) and keeps the stacking context
 * intact.
 *
 * Called from `toggleFullscreen` and after `close()` removes a window —
 * so a user closing a fullscreen window without exiting fullscreen first
 * doesn't leave the body class stranded.
 */
export function updateFullscreenBodyClass(): void {
	const hasFullscreen =
		document.querySelectorAll( '.desktop-mode-window--fullscreen' ).length > 0;
	document.body.classList.toggle( 'desktop-mode-has-fullscreen-window', hasFullscreen );
}

/**
 * Build the default loading-overlay shell (positioned div +
 * `<wpd-spinner>`). Always returns a fresh element so the
 * customization pipeline can mutate it freely. The spinner uses
 * a responsive `clamp(96px, 14vw, 192px)` size so the affordance
 * scales with the window's width.
 *
 * @internal
 */
function buildDefaultLoadingOverlay(): HTMLElement {
	const overlay = document.createElement( 'div' );
	overlay.className = 'desktop-mode-window__loading';
	// `aria-hidden` so screen readers don't announce the spinner —
	// the window's title bar already has a `role="dialog"` + label,
	// and the spinner's own `<svg role="img" aria-label="Loading">`
	// is the per-spinner SR signal. Keeping the overlay aria-hidden
	// avoids double-announcement when the window opens.
	overlay.setAttribute( 'aria-hidden', 'true' );

	const spinner = document.createElement( 'wpd-spinner' );
	// `classic` — canonical WordPress mark, three concentric arcs,
	// no dots, no pulse. The `orbit` preset's outermost trailing
	// dots reads as a frantic skinny orbit at large sizes; classic
	// reads as a calm "the system is working" affordance, which is
	// the right tone for a window that's still loading. Plugins
	// that prefer a more lively look can swap the preset via the
	// `WINDOW_LOADING_OVERLAY` filter.
	spinner.setAttribute( 'preset', 'classic' );
	spinner.setAttribute( 'size', 'clamp(96px, 14vw, 192px)' );
	spinner.setAttribute( 'label', __( 'Loading window content' ) );
	overlay.appendChild( spinner );
	return overlay;
}

/**
 * Build the loading-overlay element painted into a window's body
 * at construction (and re-painted on every `markContentLoading`
 * re-arm). Resolution order:
 *
 *   1. The default `<wpd-spinner>` shell is painted.
 *   2. `config.loading.render( host, ctx )` runs if defined —
 *      lets a single-window plugin mutate the overlay (replace
 *      contents, retune the spinner, append a status line).
 *   3. `WINDOW_LOADING_OVERLAY` filter runs — lets a global
 *      theme/skin plugin override every window's overlay.
 *
 * Both customization paths can either mutate the existing host
 * (in-place) or return a different element. The shell takes the
 * filter's return value if it's an `HTMLElement`, otherwise
 * keeps the input.
 *
 * Plugin failures are caught + logged so a buggy customizer
 * doesn't strand the user with a broken window — the shell
 * falls back to whatever overlay was last good.
 *
 * @since 0.6.0
 * @internal
 */
function createLoadingOverlay( config: WindowConfig ): HTMLElement {
	let overlay = buildDefaultLoadingOverlay();
	const ctx = { windowId: config.id, config };

	if ( typeof config.loading?.render === 'function' ) {
		try {
			config.loading.render( overlay, ctx );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[desktop-mode] loading.render threw for "${ config.id }":`,
					err,
				);
			}
		}
	}

	try {
		const filtered = applyFilters< HTMLElement, [ typeof ctx ] >(
			HOOKS.WINDOW_LOADING_OVERLAY,
			overlay,
			ctx,
		);
		if ( filtered instanceof HTMLElement ) {
			overlay = filtered;
		}
	} catch ( err ) {
		if ( typeof console !== 'undefined' ) {
			console.error(
				`[desktop-mode] WINDOW_LOADING_OVERLAY filter threw for "${ config.id }":`,
				err,
			);
		}
	}

	// Defensive: a customizer might have stripped the class while
	// replacing children. Re-add it so the CSS rules that drive
	// the fade transition + positioning still apply. The class is
	// what `desktop-mode-window__body--loading` selectors depend on.
	if ( overlay && ! overlay.classList.contains( 'desktop-mode-window__loading' ) ) {
		overlay.classList.add( 'desktop-mode-window__loading' );
	}
	return overlay;
}

/**
 * Remove the loading overlay element from a window's body. Call
 * AFTER the fade-out transition has settled so the spinner doesn't
 * pop. The matching CSS rule sets `transition: opacity` on the
 * overlay; the Window class waits the same duration before
 * invoking this helper.
 *
 * Idempotent — a window whose overlay was already removed (e.g.
 * because `markContentLoaded` was called twice in a row) silently
 * no-ops.
 *
 * @since 0.6.0
 * @internal
 */
export function removeLoadingOverlay( windowEl: HTMLElement ): void {
	const overlay = windowEl.querySelector( ':scope .desktop-mode-window__loading' );
	overlay?.remove();
}

/**
 * Re-attach the loading overlay to a window's body. Used when a
 * plugin calls `Window.markContentLoading()` after the overlay was
 * already removed — the framework needs to repaint the spinner so
 * the next `markContentLoaded` has something to fade out.
 *
 * Re-runs the same customization pipeline as the initial paint
 * (per-window `config.loading.render` + `WINDOW_LOADING_OVERLAY`
 * filter), so a plugin's branded loader keeps applying across
 * refetch cycles. Falls back to the default overlay if the
 * window element wasn't created via `createWindowElement` (test
 * fixtures, hand-rolled DOM).
 *
 * @since 0.6.0
 * @internal
 */
export function ensureLoadingOverlay( windowEl: HTMLElement ): void {
	const body = windowEl.querySelector< HTMLElement >(
		':scope .desktop-mode-window__body',
	);
	if ( ! body ) {
		return;
	}
	const existing = body.querySelector( ':scope .desktop-mode-window__loading' );
	if ( existing ) {
		return;
	}
	const config = getWindowConfigFromElement( windowEl );
	body.appendChild( config ? createLoadingOverlay( config ) : buildDefaultLoadingOverlay() );
}

/**
 * Build a slot host element. The `data-slot` attribute lets
 * `paintWindowSlots()` target the host by name; the class
 * `desktop-mode-window__slot--<name>` lets CSS hook into specific
 * slots without parsing data attributes. Empty by default — the
 * shell or plugins fill it via the slot pipeline.
 *
 * @since 0.6.0
 * @internal
 */
function createSlotHost( name: string ): HTMLElement {
	const host = document.createElement( 'span' );
	host.className =
		`desktop-mode-window__slot desktop-mode-window__slot--${ name }`;
	host.dataset.slot = name;
	return host;
}

/**
 * Build a title-bar control button via the `<wpd-window-button>` web
 * component. The component ships the SVG icon, variant styling,
 * focused-/unfocused-aware coloring (via custom properties set on the
 * outer window element), and pressed-down state. Legacy class names are
 * kept for CSS that still targets specific buttons (e.g. the title-bar
 * layout selector that reshapes around the menu button).
 */
export function createControlButton(
	variant: string,
	label: string,
	icon: string,
): HTMLElement {
	const btn = document.createElement( 'wpd-window-button' );
	btn.setAttribute( 'icon', icon );
	btn.setAttribute( 'aria-label', label );
	btn.classList.add( 'desktop-mode-window__btn' );
	btn.classList.add( `desktop-mode-window__btn--${ variant }` );
	if ( variant === 'close' ) {
		btn.setAttribute( 'danger', '' );
	}
	return btn;
}

/**
 * Create the DOM structure for a desktop window.
 */
export function createWindowElement( config: WindowConfig ): HTMLElement {
	const el = document.createElement( 'div' );
	el.className = 'desktop-mode-window';
	if ( config.native ) {
		el.classList.add( 'desktop-mode-window--native' );
	}
	el.id = `wp-window-${ config.id }`;
	el.setAttribute( 'role', 'dialog' );
	el.setAttribute( 'aria-labelledby', `wp-window-title-${ config.id }` );
	el.style.left = `${ config.x }px`;
	el.style.top = `${ config.y }px`;
	el.style.width = `${ config.width }px`;
	el.style.height = `${ config.height }px`;

	const titleBar = document.createElement( 'div' );
	titleBar.className = 'desktop-mode-window__titlebar';

	// Leading menu button — sits before the icon + title. Rendered for
	// every window, native or iframe; per-item gating below decides
	// which actions actually apply. Native windows skip "Open in
	// browser tab" since they have no admin URL to hand off.
	//
	// Items in order:
	//   - Open on startup        — checkable, marks this window as
	//                              the default-window preference.
	//   - Open another <Page>    — only when `config.multi`.
	//   - Open in new window     — opens the current iframe URL as a
	//                              fresh sibling.
	//   - Reload                 — reloads the iframe (no-op for
	//                              native windows; harmless to show).
	//   - Open in browser tab    — detach to a classic admin tab.
	//                              Iframe-only — skipped for native.
	const menuBtn = document.createElement( 'wpd-window-button' );
	menuBtn.setAttribute( 'icon', 'menu' );
	menuBtn.setAttribute( 'aria-label', __( 'Window actions' ) );
	menuBtn.setAttribute( 'aria-haspopup', 'menu' );
	menuBtn.setAttribute( 'aria-expanded', 'false' );
	// Keep the legacy classes so the title-bar layout selector that
	// reshapes around the menu button (see windows.css
	// `:has(.desktop-mode-window__menu-btn)`) still matches.
	menuBtn.classList.add( 'desktop-mode-window__btn' );
	menuBtn.classList.add( 'desktop-mode-window__menu-btn' );

	const menuPanel = document.createElement( 'wpd-menu' );
	menuPanel.classList.add( 'desktop-mode-window__menu-panel' );
	menuPanel.hidden = true;

	// "Open on startup" — checkable. Checked state is hydrated in
	// `bindEvents()` once `window.wp.desktop.config` is populated;
	// the item just needs to exist here.
	const startup = document.createElement( 'wpd-menu-item' );
	startup.setAttribute( 'role', 'menuitemcheckbox' );
	startup.setAttribute( 'value', 'startup' );
	// Legacy classes preserved so settings-refresh code can still
	// find the item by class during the `default-window-changed`
	// repaint.
	startup.classList.add( 'desktop-mode-window__menu-item' );
	startup.classList.add( 'desktop-mode-window__menu-item--startup' );
	startup.textContent = __( 'Open on startup' );
	menuPanel.appendChild( startup );

	if ( config.multi ) {
		const openAnother = document.createElement( 'wpd-menu-item' );
		openAnother.setAttribute( 'role', 'menuitem' );
		openAnother.setAttribute( 'value', 'open-another' );
		openAnother.setAttribute( 'icon', 'dashicons-plus-alt2' );
		openAnother.classList.add( 'desktop-mode-window__menu-item' );
		openAnother.classList.add(
			'desktop-mode-window__menu-item--open-another',
		);
		openAnother.textContent = sprintf(
			// translators: %s is the window's admin-page name (e.g., "Posts")
			__( 'Open another %s' ),
			config.title,
		);
		menuPanel.appendChild( openAnother );
	}

	if ( ! config.native ) {
		// "Open in new window" — opens the *current* iframe URL (where
		// the user has navigated to) as a fresh sibling window.
		// Iframe-only because there's no addressable URL on native.
		const openInNew = document.createElement( 'wpd-menu-item' );
		openInNew.setAttribute( 'role', 'menuitem' );
		openInNew.setAttribute( 'value', 'open-in-new-window' );
		openInNew.setAttribute( 'icon', 'dashicons-plus-alt' );
		openInNew.classList.add( 'desktop-mode-window__menu-item' );
		openInNew.classList.add( 'desktop-mode-window__menu-item--open-in-new-window' );
		openInNew.textContent = __( 'Open in new window' );
		menuPanel.appendChild( openInNew );
	}

	// "Reload" — was a built-in title-bar control until 0.6.2. Moved
	// here because it's an infrequent action that didn't earn the
	// permanent real estate. No-op for native windows; safe to show.
	if ( ! config.native ) {
		const reload = document.createElement( 'wpd-menu-item' );
		reload.setAttribute( 'role', 'menuitem' );
		reload.setAttribute( 'value', 'reload' );
		reload.setAttribute( 'icon', 'dashicons-update' );
		reload.classList.add( 'desktop-mode-window__menu-item' );
		reload.classList.add( 'desktop-mode-window__menu-item--reload' );
		reload.textContent = __( 'Reload' );
		menuPanel.appendChild( reload );

		// "Open in browser tab" — was the title bar's detach button.
		// Strips chromeless params and opens the page in a classic
		// admin tab. Iframe-only — native windows have no URL to
		// hand off to the browser.
		const openExternal = document.createElement( 'wpd-menu-item' );
		openExternal.setAttribute( 'role', 'menuitem' );
		openExternal.setAttribute( 'value', 'open-external' );
		openExternal.setAttribute( 'icon', 'dashicons-external' );
		openExternal.classList.add( 'desktop-mode-window__menu-item' );
		openExternal.classList.add( 'desktop-mode-window__menu-item--open-external' );
		openExternal.textContent = __( 'Open in browser tab' );
		menuPanel.appendChild( openExternal );
	}

	// Slot host helpers — Layer 3 of the chrome framework. Each
	// named slot lives inside a `<span>` carrying a `data-slot`
	// attribute, so `paintWindowSlots()` can target them by selector
	// and plugins can replace / augment a slot's content via the
	// `WindowSlotConfig` per-window appearance or via
	// `wp.desktop.registerWindowSlot()`.
	//
	// Default content for `icon` and `title` reproduces the legacy
	// title-bar visual; the other slots are empty by default.
	const slotIcon = createSlotHost( 'icon' );
	const iconEl = document.createElement( 'span' );
	iconEl.className = `desktop-mode-window__icon dashicons ${ sanitizeClassName( config.icon ) }`;
	iconEl.setAttribute( 'aria-hidden', 'true' );
	slotIcon.appendChild( iconEl );

	const slotTitle = createSlotHost( 'title' );
	const titleEl = document.createElement( 'span' );
	titleEl.className = 'desktop-mode-window__title';
	titleEl.id = `wp-window-title-${ config.id }`;
	titleEl.textContent = config.title;
	slotTitle.appendChild( titleEl );

	const slotBeforeTitlebar = createSlotHost( 'before-titlebar' );
	const slotBeforeIcon = createSlotHost( 'before-icon' );
	const slotAfterTitle = createSlotHost( 'after-title' );
	const slotBeforeControls = createSlotHost( 'before-controls' );
	const slotAfterControls = createSlotHost( 'after-controls' );
	const slotAfterTitlebar = createSlotHost( 'after-titlebar' );

	const controls = document.createElement( 'div' );
	controls.className = 'desktop-mode-window__controls';
	// Cluster is populated by `paintWindowControls()` after the Window
	// constructor wires up the registry subscription. Built-in
	// controls (minimize / maximize / focus / detach / close) live in
	// the same Layer-2 control registry plugins use; the per-window
	// `appearance.controls` block reorders / hides / augments them.

	// Screen meta buttons container (populated when iframe reports
	// available panels).
	const screenMeta = document.createElement( 'div' );
	screenMeta.className = 'desktop-mode-window__screen-meta';

	// Slot containers for plugin-registered title-bar buttons. Filled
	// by the Window class on construct + on registry change. Empty
	// by default — `display: contents` on the wrappers means they're
	// invisible to layout when no plugin has registered for this
	// window.
	const customLeft = document.createElement( 'span' );
	customLeft.className = 'desktop-mode-window__custom-buttons desktop-mode-window__custom-buttons--left';

	const customRight = document.createElement( 'span' );
	customRight.className = 'desktop-mode-window__custom-buttons desktop-mode-window__custom-buttons--right';

	// Per-window activity indicator — sits between the icon and the
	// title so it reads as "this window is doing something" without
	// stealing the icon's role as window identity. Reserves a fixed
	// width even when idle so its appearance/disappearance never
	// causes layout shift on the title row. Wired up in
	// `Window.markActivity()` / `Window.trackActivity()`; populated
	// automatically by `wp.desktop.fetch()`.
	const activityHost = document.createElement( 'span' );
	activityHost.className = 'desktop-mode-window__activity';
	const activityStatus = document.createElement( 'wpd-save-status' );
	activityStatus.setAttribute( 'mode', 'dot' );
	activityStatus.setAttribute( 'animation', 'modem' );
	activityStatus.setAttribute( 'phase', 'idle' );
	activityStatus.setAttribute( 'data-desktop-mode-activity-indicator', '' );
	activityHost.appendChild( activityStatus );

	titleBar.appendChild( slotBeforeIcon );
	titleBar.appendChild( slotIcon );
	titleBar.appendChild( activityHost );
	titleBar.appendChild( slotTitle );
	titleBar.appendChild( slotAfterTitle );
	titleBar.appendChild( customLeft );
	titleBar.appendChild( screenMeta );
	// ⋯ menu sits as the last item before the controls divider so it
	// groups with the page-level chrome (screen options, help) rather
	// than the window chrome (minimize, close, …). Only appended when
	// the menu actually has items to offer — otherwise the button
	// would open an empty dropdown.
	if ( menuBtn && menuPanel && menuPanel.children.length > 0 ) {
		titleBar.appendChild( menuBtn );
		titleBar.appendChild( menuPanel );
	}
	titleBar.appendChild( customRight );
	titleBar.appendChild( slotBeforeControls );
	titleBar.appendChild( controls );
	titleBar.appendChild( slotAfterControls );

	// Stamp every framework-shipped titlebar child with a marker
	// attribute so the chrome framework can hide them as a group
	// when a custom chrome mounts. This is the load-bearing
	// guarantee that the default chrome NEVER peeks through a
	// custom one — even mid-fade during a window close, even if
	// the plugin's render() forgot to clear `innerHTML`. The CSS
	// rule lives in `assets/css/window-chrome.css`; no JS reads
	// the attribute back, it's purely a hide-target.
	for ( const child of Array.from( titleBar.children ) ) {
		( child as HTMLElement ).setAttribute(
			'data-desktop-mode-default-chrome',
			'',
		);
	}

	const body = document.createElement( 'div' );
	body.className = 'desktop-mode-window__body desktop-mode-window__body--loading';

	// Native windows own the body contents via {@link WindowConfig.render}
	// — called from the Window constructor after mount. Skip the iframe
	// plumbing entirely.
	if ( ! config.native ) {
		const iframe = document.createElement( 'iframe' );
		iframe.className = 'desktop-mode-window__iframe';
		iframe.setAttribute( 'name', `desktop-mode-frame-${ config.id }` );

		// `config.url` is required for iframe windows — enforced at
		// the type level (it's only marked optional to cover the
		// native-window case, which never reaches this branch).
		const chromelessSrc = config.url
			? withChromelessParam( config.url )
			: null;
		iframe.src = chromelessSrc ?? 'about:blank';

		body.appendChild( iframe );

		// Native `load` event is the floor signal: even if the
		// chromeless inline bridge isn't installed (cross-origin /
		// sandboxed / a future code path that strips the script),
		// the browser's `load` event fires once the document parses
		// and we still want the spinner to clear. The
		// `desktop-mode-ready` postMessage from the chromeless bridge
		// (handled in `iframe-bridge.ts`) ALSO calls
		// `markWindowContentReady` — both paths converge on the
		// idempotent loading → ready transition.
		const onIframeLoad = (): void => {
			markWindowContentReady( config.id );
		};
		iframe.addEventListener( 'load', onIframeLoad );
	} else {
		body.classList.add( 'desktop-mode-window__body--native' );
	}

	// Loading overlay — sits above the body content (iframe or native
	// render output) until the window's content reports ready. The
	// shell drives the visibility via the `--loading` body modifier;
	// the overlay element itself is removed once the fade-out
	// transition lands so it doesn't intercept pointer events on a
	// "ready" window. Painted unconditionally for every window type so
	// production lag (slow iframe boot, async native data fetch)
	// always has the same affordance. Customization is plumbed via
	// `config.loading.render` (per-window) and the
	// `WINDOW_LOADING_OVERLAY` filter (global) — see
	// `createLoadingOverlay` above.
	body.appendChild( createLoadingOverlay( config ) );

	// Mark this window as being in the loading state from the moment
	// the body element exists. Plugins or shell code that subscribe to
	// `WINDOW_CONTENT_LOADING` see the entry edge here; the matching
	// `WINDOW_CONTENT_LOADED` fires when the iframe-bridge or native
	// render reports done.
	markWindowContentLoading( config.id );

	// Resize handles — 4 corners, each independently hit-testable.
	// The SE corner keeps the legacy class so existing CSS selectors
	// (and any third-party rule that styles it) continue to match.
	// Each handle carries `data-dir` so the pointer layer knows which
	// axes to move.
	const resizeHandles: HTMLElement[] = [];
	for ( const dir of [ 'ne', 'nw', 'se', 'sw' ] as const ) {
		const h = document.createElement( 'div' );
		h.className = `desktop-mode-window__resize-handle desktop-mode-window__resize-handle--${ dir }`;
		h.dataset.dir = dir;
		h.setAttribute( 'aria-hidden', 'true' );
		resizeHandles.push( h );
	}

	el.appendChild( slotBeforeTitlebar );
	el.appendChild( titleBar );
	el.appendChild( slotAfterTitlebar );

	// Tab strip — initialized whenever the window has a submenu OR
	// supports external-link sub-tabs (which iframe windows grow at
	// runtime via `addExternalTab`). For windows with no submenu, we
	// still create the strip but hide it via CSS `:empty` when empty.
	// Each submenu tab is marked `data-kind="submenu"` so the runtime
	// tab-switching code can tell submenu tabs apart from closeable
	// external tabs.
	if ( ! config.native ) {
		const tabs = document.createElement( 'nav' );
		tabs.className = 'desktop-mode-window__tabs';
		tabs.setAttribute( 'role', 'tablist' );
		// translators: %s is the window's admin-page title (e.g., "Posts")
		tabs.setAttribute( 'aria-label', sprintf( __( '%s sub-pages' ), config.title ) );

		if ( config.submenu && config.submenu.length > 0 && config.url ) {
			const initialKey = urlMatchKey( config.url );

			// Synthetic "back to parent" tab — `helpers.php` strips WP's
			// auto-prepended self-link from `submenu`, so without this
			// tab the only way back to the parent listing (e.g. All
			// Posts from inside Categories) would be to close the window
			// and reopen it.
			//
			// The synthetic uses `parentUrl` (the dock landing page),
			// falling back to `url` when the caller didn't pass one.
			// They diverge when the iframe has been navigated to a
			// sub-page (or restored from a session that captured one),
			// e.g. Appearance window currently on `theme-install.php`:
			// `url = theme-install.php`, `parentUrl = themes.php`.
			//
			// Dedup: skip the synthetic if a submenu entry already
			// points at the *parent* URL. That covers the WooCommerce
			// shape (parent URL gets rewritten to the first submenu
			// URL like `wc-admin`, so the first submenu entry already
			// is the back-to-parent affordance) without false-positively
			// suppressing it on a session-restored Appearance window
			// (where the iframe URL `theme-install.php` matches the
			// "Add Theme" entry but `parentUrl = themes.php` doesn't).
			const synthUrl = config.parentUrl ?? config.url;
			const synthKey = urlMatchKey( synthUrl );
			const parentAlreadyInSubmenu = config.submenu.some(
				( s ) => urlMatchKey( s.url ) === synthKey,
			);
			const seedSubmenu: { title: string; url: string }[] = parentAlreadyInSubmenu
				? [ ...config.submenu ]
				: [ { title: config.title, url: synthUrl }, ...config.submenu ];

			for ( const sub of seedSubmenu ) {
				const tab = document.createElement( 'button' );
				tab.className = 'desktop-mode-window__tab';
				tab.dataset.kind = 'submenu';
				tab.setAttribute( 'type', 'button' );
				tab.setAttribute( 'role', 'tab' );
				tab.dataset.url = sub.url;
				tab.textContent = sub.title;
				if ( urlMatchKey( sub.url ) === initialKey ) {
					tab.classList.add( 'desktop-mode-window__tab--active' );
					tab.setAttribute( 'aria-selected', 'true' );
				} else {
					tab.setAttribute( 'aria-selected', 'false' );
				}
				tabs.appendChild( tab );
			}
		}
		el.appendChild( tabs );
	}

	el.appendChild( body );
	for ( const h of resizeHandles ) {
		el.appendChild( h );
	}

	// Stash the config so post-construction helpers
	// (`ensureLoadingOverlay`) can recover the customization
	// callbacks without taking a manager dependency. Symbol-keyed
	// to keep it invisible to userland code that walks `el`
	// properties.
	setWindowConfigOnElement( el, config );

	return el;
}
