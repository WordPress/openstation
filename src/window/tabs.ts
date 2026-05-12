/**
 * Desktop Mode — Window external-tab lifecycle.
 *
 * "External tabs" are plugin- and user-initiated sub-tabs that embed an
 * external URL in a secondary iframe inside an iframe-backed window.
 * They let the user stay in the desktop shell while quickly peeking at
 * documentation, an embedded editor, etc. Each tab carries its own
 * iframe, label, and readiness probe; the primary iframe stays wired
 * to the window's admin URL.
 *
 * Functions here take the `Window` instance as their first argument
 * (`win`) so the class keeps its public surface unchanged while the
 * heavy logic lives out of the orchestrator file.
 *
 * @since 0.8.1
 */

import { __, sprintf } from '../i18n';
import { showToast } from '../toast';
import { urlMatchKey } from '../utils';
import { EXTERNAL_IFRAME_READY_TIMEOUT_MS } from './constants';
import { withChromelessParam } from './dom';
import type { Window } from './index';
import '../ui/components/wpd-tab-chip/wpd-tab-chip';

/**
 * Update the active tab to whichever submenu URL matches the iframe's
 * current location. Called after every iframe navigation.
 *
 * Only submenu tabs participate in URL-based matching. External
 * sub-tabs and the injected "main" tab manage their own active state
 * through `switchToTab` since their notion of "active" isn't a URL
 * comparison — it's which iframe is foregrounded.
 */
export function syncActiveTab( win: Window, currentUrl: string ): void {
	const submenuTabs = win.element.querySelectorAll<HTMLElement>(
		'.desktop-mode-window__tab[data-kind="submenu"]',
	);
	if ( ! submenuTabs.length ) {
		return;
	}
	// If an external tab is currently foregrounded, submenu tabs are
	// all inactive — the primary iframe's URL isn't what the user is
	// looking at.
	if ( win._activeTabId !== 'primary' ) {
		for ( const tab of submenuTabs ) {
			tab.classList.remove( 'desktop-mode-window__tab--active' );
			tab.setAttribute( 'aria-selected', 'false' );
		}
		return;
	}
	const activeKey = urlMatchKey( currentUrl );
	for ( const tab of submenuTabs ) {
		const tabUrl = tab.dataset.url;
		const isActive = !! tabUrl && urlMatchKey( tabUrl ) === activeKey;
		tab.classList.toggle( 'desktop-mode-window__tab--active', isActive );
		tab.setAttribute( 'aria-selected', isActive ? 'true' : 'false' );
	}
}

/**
 * Add a closeable+detachable sub-tab hosting an external URL.
 *
 * Flow:
 *   1. Lazily create a "Main" tab if this is the first external tab
 *      on a window that has no submenu (otherwise the user would have
 *      no way to get back to the admin page).
 *   2. Create an iframe for the external URL, hidden by default.
 *   3. Append a tab to the strip with label + detach + close chips.
 *   4. Switch to the new tab.
 *   5. Start a readiness probe — if the iframe's `load` event doesn't
 *      fire in that window (network failure, hard block), auto-dismiss
 *      the tab and open the URL in a real browser tab with an
 *      explanatory toast. For subtler blocks (X-Frame-Options showing
 *      the browser's error page *inside* the iframe, which does fire
 *      `load`), the user sees the error and can hit the detach button
 *      themselves.
 */
export function addExternalTab(
	win: Window,
	url: string,
	label: string,
): void {
	if ( ! win.iframe ) {
		// Native windows don't host iframes — no tab strip exists.
		return;
	}
	const tabStrip = win.element.querySelector<HTMLElement>(
		'.desktop-mode-window__tabs',
	);
	const body = win.element.querySelector<HTMLElement>(
		'.desktop-mode-window__body',
	);
	if ( ! tabStrip || ! body ) {
		return;
	}

	ensureMainTab( win, tabStrip );

	const tabId = `ext-${ ++win._externalTabSeq }`;

	// Build the tab element with label + detach + close chips.
	const tabEl = document.createElement( 'button' );
	tabEl.className = 'desktop-mode-window__tab desktop-mode-window__tab--external';
	tabEl.dataset.kind = 'external';
	tabEl.dataset.tabId = tabId;
	tabEl.setAttribute( 'type', 'button' );
	tabEl.setAttribute( 'role', 'tab' );
	tabEl.setAttribute( 'aria-selected', 'false' );
	tabEl.title = url;

	const labelEl = document.createElement( 'span' );
	labelEl.className = 'desktop-mode-window__tab-label';
	labelEl.textContent = label;
	tabEl.appendChild( labelEl );

	const detachBtn = document.createElement( 'wpd-tab-chip' );
	detachBtn.setAttribute( 'variant', 'detach' );
	detachBtn.dataset.tabAction = 'detach';
	detachBtn.dataset.tabId = tabId;
	detachBtn.setAttribute( 'aria-label', __( 'Open in a new browser tab' ) );
	detachBtn.title = __( 'Open in a new browser tab' );
	tabEl.appendChild( detachBtn );

	const closeBtn = document.createElement( 'wpd-tab-chip' );
	closeBtn.setAttribute( 'variant', 'close' );
	closeBtn.dataset.tabAction = 'close';
	closeBtn.dataset.tabId = tabId;
	closeBtn.setAttribute( 'aria-label', __( 'Close tab' ) );
	closeBtn.title = __( 'Close tab' );
	tabEl.appendChild( closeBtn );

	tabStrip.appendChild( tabEl );

	// Build the iframe. Hidden until we switch to it. `sandbox`
	// intentionally omitted — external sites often need scripts,
	// forms, and same-origin cookies to function. The iframe is
	// cross-origin anyway so the site can't reach our shell DOM.
	const iframe = document.createElement( 'iframe' );
	iframe.className = 'desktop-mode-window__iframe desktop-mode-window__iframe--external';
	iframe.dataset.tabId = tabId;
	iframe.style.display = 'none';
	iframe.src = url;
	body.appendChild( iframe );

	// Readiness probe. If `load` never fires within the timeout, assume
	// the request failed at the network layer (DNS, offline, connection
	// refused) and fall back to a real browser tab. When `load` does
	// fire — even for X-Frame-Options-blocked requests that render the
	// browser's error page inside the iframe — keep the tab; the user
	// can see the failure and hit the detach button themselves.
	let loaded = false;
	const onLoad = (): void => {
		loaded = true;
	};
	iframe.addEventListener( 'load', onLoad, { once: true } );
	const probeTimer = window.setTimeout( () => {
		if ( loaded ) {
			return;
		}
		iframe.removeEventListener( 'load', onLoad );
		fallbackToBrowserTab( win, tabId );
	}, EXTERNAL_IFRAME_READY_TIMEOUT_MS ) as unknown as number;

	const cancelProbe = (): void => {
		iframe.removeEventListener( 'load', onLoad );
		window.clearTimeout( probeTimer );
	};

	win._externalTabs.set( tabId, {
		tabEl,
		iframe,
		url,
		label,
		cancelProbe,
	} );

	switchToTab( win, tabId );
	tabEl.scrollIntoView( { behavior: 'smooth', inline: 'end', block: 'nearest' } );
	// Trigger the session saver so this tab survives a reload. The
	// saver subscribes to `desktop-mode-window-changed`, which emitChange
	// already dispatches for the debounce layer; reuse the 'state'
	// reason — the tab list is part of window state as far as
	// persistence is concerned.
	win._emitChange( 'state' );
}

/**
 * Inject a "Main" tab at the start of the strip once external tabs
 * exist. For windows that already have a submenu, no main tab is
 * injected — submenu tabs already act as the return path to primary
 * content. Idempotent.
 */
function ensureMainTab( win: Window, tabStrip: HTMLElement ): void {
	if ( tabStrip.querySelector( '[data-kind="main"]' ) ) {
		return;
	}
	if ( tabStrip.querySelector( '[data-kind="submenu"]' ) ) {
		// Submenu tabs already serve as the primary-anchor.
		return;
	}
	const main = document.createElement( 'button' );
	main.className = 'desktop-mode-window__tab desktop-mode-window__tab--main desktop-mode-window__tab--active';
	main.dataset.kind = 'main';
	main.setAttribute( 'type', 'button' );
	main.setAttribute( 'role', 'tab' );
	main.setAttribute( 'aria-selected', 'true' );
	main.textContent = win.config.title || 'Main';
	tabStrip.prepend( main );
}

/**
 * Foreground a tab — either the primary iframe (tabId='primary') or
 * one of the external sub-tabs. Updates visibility across all iframes
 * and active state across all tabs.
 */
export function switchToTab( win: Window, tabId: 'primary' | string ): void {
	if ( win._activeTabId === tabId ) {
		return;
	}
	win._activeTabId = tabId;

	// Primary iframe visibility.
	if ( win.iframe ) {
		win.iframe.style.display = tabId === 'primary' ? '' : 'none';
	}

	// External iframes.
	for ( const [ id, entry ] of win._externalTabs ) {
		entry.iframe.style.display = tabId === id ? '' : 'none';
	}

	// Tab active-state.
	const tabEls = win.element.querySelectorAll<HTMLElement>(
		'.desktop-mode-window__tab',
	);
	tabEls.forEach( ( t ) => {
		let isActive: boolean;
		if ( t.dataset.kind === 'main' ) {
			isActive = tabId === 'primary';
		} else if ( t.dataset.kind === 'external' ) {
			isActive = t.dataset.tabId === tabId;
		} else {
			// Submenu tab — only "active" when primary is foregrounded
			// AND the tab's URL matches the iframe's current URL.
			// `syncActiveTab` handles the URL match after navigation;
			// here we just make sure switching AWAY to an external tab
			// deactivates all submenu tabs.
			isActive =
				tabId === 'primary' &&
				t.classList.contains( 'desktop-mode-window__tab--active' );
		}
		t.classList.toggle( 'desktop-mode-window__tab--active', isActive );
		t.setAttribute( 'aria-selected', isActive ? 'true' : 'false' );
	} );
}

/** Remove an external sub-tab + its iframe. */
export function closeExternalTab( win: Window, tabId: string ): void {
	const entry = win._externalTabs.get( tabId );
	if ( ! entry ) {
		return;
	}
	entry.cancelProbe();
	entry.tabEl.remove();
	entry.iframe.remove();
	win._externalTabs.delete( tabId );
	if ( win._activeTabId === tabId ) {
		switchToTab( win, 'primary' );
	}
	// If the last external tab closed AND we injected a main tab,
	// remove it — returning the window to its pre-external state.
	if ( win._externalTabs.size === 0 ) {
		const main = win.element.querySelector(
			'.desktop-mode-window__tab--main',
		);
		main?.remove();
	}
	// Poke the session saver so the closed tab doesn't resurrect on
	// reload.
	win._emitChange( 'state' );
}

/**
 * Open an external sub-tab's current URL in a real browser tab and
 * close the sub-tab. The iframe's `contentWindow.location` may have
 * navigated beyond the original URL; we prefer that live URL so a
 * user who drilled 3 pages deep into an external site gets taken to
 * the right spot.
 */
export function detachExternalTab( win: Window, tabId: string ): void {
	const entry = win._externalTabs.get( tabId );
	if ( ! entry ) {
		return;
	}
	let url = entry.url;
	try {
		const href = entry.iframe.contentWindow?.location.href;
		if ( href && href !== 'about:blank' ) {
			url = href;
		}
	} catch {
		/* Cross-origin — we can't read it; stick with the original URL. */
	}
	window.open( url, '_blank', 'noopener' );
	closeExternalTab( win, tabId );
}

/**
 * Fallback for sub-tabs that fail to load within the probe window.
 * Dismisses the sub-tab, opens the URL as a real browser tab, and
 * flashes a toast explaining why the shell gave up on embedding.
 */
function fallbackToBrowserTab( win: Window, tabId: string ): void {
	const entry = win._externalTabs.get( tabId );
	if ( ! entry ) {
		return;
	}
	const { url, label } = entry;
	closeExternalTab( win, tabId );
	showToast( {
		message: sprintf(
			// translators: %s is the external site's title or URL.
			__(
				'Opened "%s" in a new browser tab — this site doesn\'t allow embedding.',
			),
			label,
		),
		action: {
			label: __( 'Open' ),
			onClick: () => {
				window.open( url, '_blank', 'noopener' );
			},
		},
	} );
	window.open( url, '_blank', 'noopener' );
}

/**
 * Number of external sub-tabs currently open on this window. Exposed
 * for callers like the Overview label renderer that decorate thumbnails
 * without paying the cost of a full serialization pass.
 */
export function externalTabCount( win: Window ): number {
	return win._externalTabs.size;
}

/**
 * Serialisable snapshot of this window's external sub-tabs. Iteration
 * order follows the Map's insertion order, which matches the tab
 * strip's left-to-right order — so restoring preserves the visual
 * layout.
 */
export function externalTabsSnapshot(
	win: Window,
): { url: string; label: string }[] {
	const out: { url: string; label: string }[] = [];
	for ( const entry of win._externalTabs.values() ) {
		// Prefer the iframe's live URL (navigation within the sub-tab
		// may have moved beyond the original) but fall back to the
		// initial URL when cross-origin locks us out.
		let url = entry.url;
		try {
			const href = entry.iframe.contentWindow?.location.href;
			if ( href && href !== 'about:blank' ) {
				url = href;
			}
		} catch {
			/* Cross-origin — keep the original URL. */
		}
		out.push( { url, label: entry.label } );
	}
	return out;
}

/**
 * Handle the tab strip's delegated click listener. Extracted so the
 * constructor's bind-events path stays readable — the class just calls
 * this function with every click.
 */
export function handleTabStripClick( win: Window, e: Event ): void {
	const target = e.target as HTMLElement;
	// Closeable-tab chips. `data-tab-action` distinguishes them from
	// the tab body so the "switch tab" branch below doesn't fire for
	// chip clicks.
	const chip = target.closest<HTMLElement>( '[data-tab-action]' );
	if ( chip ) {
		e.stopPropagation();
		const action = chip.dataset.tabAction;
		const tabId = chip.dataset.tabId;
		if ( ! tabId ) {
			return;
		}
		if ( action === 'close' ) {
			closeExternalTab( win, tabId );
		} else if ( action === 'detach' ) {
			detachExternalTab( win, tabId );
		}
		return;
	}

	const tab = target.closest<HTMLElement>( '.desktop-mode-window__tab' );
	if ( ! tab ) {
		return;
	}
	e.stopPropagation();

	const kind = tab.dataset.kind;
	const tabId = tab.dataset.tabId;
	if ( kind === 'external' && tabId ) {
		switchToTab( win, tabId );
		return;
	}
	if ( kind === 'main' ) {
		switchToTab( win, 'primary' );
		return;
	}
	// Submenu tab — navigate primary iframe in place and bring it
	// forward. The load listener below syncs the active-tab highlight.
	if ( tab.dataset.url ) {
		const next = withChromelessParam( tab.dataset.url );
		if ( next && win.iframe ) {
			// Arm the loading overlay before re-pointing the iframe.
			// The chromeless bridge clears it via `desktop-mode-ready`
			// once the next page hydrates (and the iframe `load`
			// event is the floor signal). Without this, in-place
			// submenu navigation showed no spinner — visible only
			// after we added the synthetic main tab in 0.18.x, which
			// gave users a reason to navigate within tabs instead of
			// closing + reopening the window.
			win.markContentLoading();
			win.iframe.src = next;
		}
		switchToTab( win, 'primary' );
	}
}
