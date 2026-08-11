/**
 * OpenStation — Window external-tab lifecycle.
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
 */

import { __, sprintf } from '../i18n';
import { showToast } from '../toast';
import { pageIdentityKey, urlMatchKey } from '../utils';
import { EXTERNAL_IFRAME_READY_TIMEOUT_MS } from './constants';
import { withChromelessParam } from './dom';
import type { Window } from './index';
// Pre-registered globally by the lazy shell-overlays bundle (Stage 10) — see src/shell-overlays/entry.ts.

/**
 * Find the submenu tab that owns the page `currentUrl` sits on, for
 * the case where no tab's URL matches it outright.
 *
 * A submenu tab points at one landing URL, but the screen behind it
 * usually has more states than that: `nav-menus.php` also renders as
 * `?action=locations` and `?action=edit&menu=2`, a list table paginates
 * into `?paged=2`, a settings screen redirects back with
 * `?settings-updated=true`. All of those are still that tab's page and
 * should keep it lit.
 *
 * A candidate must clear two bars:
 *
 *   1. Same {@link pageIdentityKey} — same admin file, and agreeing on
 *      the params that genuinely separate pages (`post_type`,
 *      `taxonomy`, `page`, …). This is what keeps Categories from
 *      claiming Tags.
 *   2. Every param the tab's own URL declares is present in the current
 *      URL with the same value. A tab is only a candidate for URLs that
 *      are *inside* it — `admin.php?page=x&tab=test` never claims
 *      `admin.php?page=x&tab=other`.
 *
 * Among survivors the most specific wins (most params declared), so a
 * plugin that registers both `?page=x` and `?page=x&tab=test` as
 * separate submenu entries lights the deeper one on the deeper URL and
 * falls back to the parent entry on any other `tab=` value.
 */
function findPageOwnerTab(
	submenuTabs: NodeListOf< HTMLElement >,
	currentUrl: string,
): HTMLElement | null {
	let current: URL;
	try {
		current = new URL( currentUrl, window.location.origin );
	} catch {
		return null;
	}
	const currentIdentity = pageIdentityKey( currentUrl );

	let best: HTMLElement | null = null;
	let bestScore = -1;
	for ( const tab of submenuTabs ) {
		const tabUrl = tab.dataset.url;
		if ( ! tabUrl || pageIdentityKey( tabUrl ) !== currentIdentity ) {
			continue;
		}
		let parsed: URL;
		try {
			parsed = new URL( tabUrl, window.location.origin );
		} catch {
			continue;
		}
		let score = 0;
		let contradicted = false;
		for ( const [ key, value ] of parsed.searchParams ) {
			if (
				key === 'openstation_chromeless' ||
				key === 'desktop_mode_portal'
			) {
				continue;
			}
			if ( current.searchParams.get( key ) !== value ) {
				contradicted = true;
				break;
			}
			score++;
		}
		if ( ! contradicted && score > bestScore ) {
			best = tab;
			bestScore = score;
		}
	}
	return best;
}

/**
 * Update the active tab to whichever submenu URL matches the iframe's
 * current location. Called after every iframe navigation.
 *
 * An exact URL match wins outright. Failing that, the tab whose page
 * the current URL belongs to is lit — see {@link findPageOwnerTab} —
 * so drilling into a screen's own sub-views (`nav-menus.php?action=
 * locations`, `edit.php?paged=2`) doesn't blank the strip.
 *
 * Only submenu tabs participate in URL-based matching. External
 * sub-tabs and the injected "main" tab manage their own active state
 * through `switchToTab` since their notion of "active" isn't a URL
 * comparison — it's which iframe is foregrounded.
 */
export function syncActiveTab( win: Window, currentUrl: string ): void {
	const submenuTabs = win.element.querySelectorAll<HTMLElement>(
		'.os-window__tab[data-kind="submenu"]',
	);
	if ( ! submenuTabs.length ) {
		return;
	}
	// If an external tab is currently foregrounded, submenu tabs are
	// all inactive — the primary iframe's URL isn't what the user is
	// looking at.
	if ( win._activeTabId !== 'primary' ) {
		for ( const tab of submenuTabs ) {
			tab.classList.remove( 'os-window__tab--active' );
			tab.setAttribute( 'aria-selected', 'false' );
		}
		return;
	}
	const activeKey = urlMatchKey( currentUrl );
	let active: HTMLElement | null = null;
	for ( const tab of submenuTabs ) {
		const tabUrl = tab.dataset.url;
		if ( tabUrl && urlMatchKey( tabUrl ) === activeKey ) {
			active = tab;
			break;
		}
	}
	if ( ! active ) {
		active = findPageOwnerTab( submenuTabs, currentUrl );
	}
	for ( const tab of submenuTabs ) {
		const isActive = tab === active;
		tab.classList.toggle( 'os-window__tab--active', isActive );
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
		'.os-window__tabs',
	);
	const body = win.element.querySelector<HTMLElement>(
		'.os-window__body',
	);
	if ( ! tabStrip || ! body ) {
		return;
	}

	ensureMainTab( win, tabStrip );

	const tabId = `ext-${ ++win._externalTabSeq }`;

	// Build the tab element with label + detach + close chips.
	const tabEl = document.createElement( 'button' );
	tabEl.className = 'os-window__tab os-window__tab--external';
	tabEl.dataset.kind = 'external';
	tabEl.dataset.tabId = tabId;
	tabEl.setAttribute( 'type', 'button' );
	tabEl.setAttribute( 'role', 'tab' );
	tabEl.setAttribute( 'aria-selected', 'false' );
	tabEl.title = url;

	const labelEl = document.createElement( 'span' );
	labelEl.className = 'os-window__tab-label';
	labelEl.textContent = label;
	tabEl.appendChild( labelEl );

	const detachBtn = document.createElement( 'os-tab-chip' );
	detachBtn.setAttribute( 'variant', 'detach' );
	detachBtn.dataset.tabAction = 'detach';
	detachBtn.dataset.tabId = tabId;
	detachBtn.setAttribute( 'aria-label', __( 'Open in a new browser tab' ) );
	detachBtn.title = __( 'Open in a new browser tab' );
	tabEl.appendChild( detachBtn );

	const closeBtn = document.createElement( 'os-tab-chip' );
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
	iframe.className = 'os-window__iframe os-window__iframe--external';
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
	// saver subscribes to `os-window-changed`, which emitChange
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
	main.className = 'os-window__tab os-window__tab--main os-window__tab--active';
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
		'.os-window__tab',
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
				t.classList.contains( 'os-window__tab--active' );
		}
		t.classList.toggle( 'os-window__tab--active', isActive );
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
			'.os-window__tab--main',
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

	const tab = target.closest<HTMLElement>( '.os-window__tab' );
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
			// The chromeless bridge clears it via `os-ready`
			// once the next page hydrates (and the iframe `load`
			// event is the floor signal). Without this, in-place
			// submenu navigation showed no spinner — visible only
			// after we added the synthetic main tab, which
			// gave users a reason to navigate within tabs instead of
			// closing + reopening the window.
			win.markContentLoading();
			win.iframe.src = next;
		}
		switchToTab( win, 'primary' );
	}
}

/* ---------------------------------------------------------------
 * Tab-strip overflow affordance
 * --------------------------------------------------------------- */

/**
 * Slack, in pixels, when comparing scroll offsets against their
 * bounds. Sub-pixel layout (fractional `clientWidth` under a zoomed
 * page or a fractional device pixel ratio) leaves `scrollLeft` a
 * hair short of its maximum at the true end of the strip, which
 * without a tolerance paints an "there is more this way" fade over
 * the last tab forever.
 */
const OVERFLOW_EPSILON = 1;

/**
 * Stamp `data-overflow` on a tab strip to describe which of its
 * physical edges is currently hiding content.
 *
 * Values: `left`, `right`, `both`, or the attribute removed when the
 * strip fits. The edge fades in `window-chrome.css` key off this, so
 * a fade only ever appears where scrolling would actually reveal
 * another tab — the whole point of the affordance. Previously the
 * mask was unconditional, which on the pre-brand light strip was
 * invisible (it faded empty area past the last tab) and on the
 * station's dark one reads as two grey smudges bracketing every
 * window's submenu.
 *
 * Direction-aware: `scrollLeft` runs `[0, max]` in LTR and `[-max, 0]`
 * in RTL, so the distance travelled from the inline start is the
 * absolute value in both, and which *physical* edge that leaves
 * covered is what flips.
 */
export function updateTabOverflow(
	strip: HTMLElement,
	knownRtl?: boolean,
): void {
	const max = Math.max( 0, strip.scrollWidth - strip.clientWidth );
	if ( max <= OVERFLOW_EPSILON ) {
		delete strip.dataset.overflow;
		return;
	}

	const travelled = Math.abs( strip.scrollLeft );
	const atStart = travelled <= OVERFLOW_EPSILON;
	const atEnd = travelled >= max - OVERFLOW_EPSILON;

	// `direction` decides which PHYSICAL edge a given scroll position
	// leaves covered, so it has to be read rather than assumed for an
	// RTL admin to get the fades on the correct sides. Callers that
	// measure repeatedly pass it in: a strip does not change direction
	// between two scroll frames, and `getComputedStyle` forces a style
	// recalc every time it is asked.
	const rtl =
		knownRtl ?? window.getComputedStyle( strip ).direction === 'rtl';
	const hiddenLeft = rtl ? ! atEnd : ! atStart;
	const hiddenRight = rtl ? ! atStart : ! atEnd;

	if ( hiddenLeft && hiddenRight ) {
		strip.dataset.overflow = 'both';
	} else if ( hiddenLeft ) {
		strip.dataset.overflow = 'left';
	} else if ( hiddenRight ) {
		strip.dataset.overflow = 'right';
	} else {
		delete strip.dataset.overflow;
	}
}

/**
 * Move the plate — the active tab's surface — onto the active tab.
 *
 * The plate is one element that travels rather than a fill that
 * switches off on one tab and on at the next, so this is the only
 * thing that has to know where the active tab IS. It publishes two
 * custom properties and lets CSS animate them.
 *
 * Two things are load-bearing:
 *
 * 1. **`offsetLeft`, not `getBoundingClientRect()`.** The plate is an
 *    absolutely-positioned child of the strip, which is itself the
 *    scroll container — so it scrolls WITH the tabs, and its geometry
 *    has to be in the strip's own scrolled coordinate space. A
 *    viewport-relative rect would drift by exactly `scrollLeft` the
 *    moment a long strip is scrolled.
 * 2. **`data-placed` gates the transition.** Without it the plate
 *    animates in from the strip's left edge every time a window
 *    opens, because the first measurement is a change from zero.
 *
 * With no active tab — `syncActiveTab` can land on a URL matching
 * nothing, and foregrounding an external sub-tab deactivates every
 * submenu tab — the plate keeps its last geometry and fades out, so
 * re-activating does not read as it flying in from nowhere.
 */
export function positionTabPlate( strip: HTMLElement ): void {
	const plate = strip.querySelector< HTMLElement >(
		'.os-window__tab-plate',
	);
	if ( ! plate ) {
		return;
	}
	const active = strip.querySelector< HTMLElement >(
		'.os-window__tab--active',
	);
	if ( ! active ) {
		plate.dataset.empty = '';
		return;
	}
	delete plate.dataset.empty;
	plate.style.setProperty( '--_tab-plate-x', `${ active.offsetLeft }px` );
	plate.style.setProperty( '--_tab-plate-w', `${ active.offsetWidth }px` );
	// Only now may it animate. A width of 0 means layout has not run
	// yet (the first frame of a window being assembled), and placing
	// the plate off that measurement would teach it a wrong origin to
	// travel from.
	if ( active.offsetWidth > 0 ) {
		plate.dataset.placed = '';
	}
}

/**
 * Keep {@link updateTabOverflow} and {@link positionTabPlate} in step
 * with everything that can change the answer, and hand back a
 * teardown.
 *
 * Three sources, because a strip can start overflowing without the
 * user touching it: scrolling (the obvious one), the strip being
 * resized (the window narrows, or the shell reflows), and tabs being
 * added or removed (`addExternalTab`, `removeExternalTab`). Missing
 * any of the three leaves a stale fade — the failure mode being
 * fixed here, so it is worth covering all of them.
 *
 * Measurement is deferred to an animation frame: the first call
 * lands while the window is still being assembled, before layout has
 * run, when every scroll dimension reads 0.
 */
export function observeTabOverflow( strip: HTMLElement ): () => void {
	// Cached across scroll frames and re-read only when the strip is
	// resized or its children change, which are the moments a direction
	// flip could plausibly ride along with. Scrolling cannot change it,
	// and `getComputedStyle` on every frame of a flick is a style
	// recalc for an answer that is already known.
	let rtl: boolean | null = null;

	let frame: number | null = null;
	const schedule = (): void => {
		if ( frame !== null ) {
			return;
		}
		frame = window.requestAnimationFrame( () => {
			frame = null;
			if ( rtl === null ) {
				rtl = window.getComputedStyle( strip ).direction === 'rtl';
			}
			updateTabOverflow( strip, rtl );
			positionTabPlate( strip );
		} );
	};

	/** Re-measure, and re-read the direction while we are at it. */
	const scheduleWithDirection = (): void => {
		rtl = null;
		schedule();
	};

	strip.addEventListener( 'scroll', schedule, { passive: true } );

	// jsdom without a shim has neither observer; the strip simply
	// keeps whatever the initial measure decided.
	const resizeObserver =
		typeof ResizeObserver === 'undefined'
			? null
			: new ResizeObserver( scheduleWithDirection );
	resizeObserver?.observe( strip );

	const mutationObserver =
		typeof MutationObserver === 'undefined'
			? null
			: new MutationObserver( scheduleWithDirection );
	/*
	 * `attributeFilter: [ 'class' ]` is doing two jobs.
	 *
	 * It is how the plate follows the active tab at all: four separate
	 * places toggle `os-window__tab--active` (`syncActiveTab`,
	 * `switchToTab`, the initial paint in `dom.ts`, and external-tab
	 * creation), and watching the class means none of them has to know
	 * the plate exists — it cannot fall out of step with them.
	 *
	 * It is ALSO what stops this from looping forever. The observer
	 * watches the whole subtree, `positionTabPlate` writes inline
	 * styles and `data-*` onto an element inside that subtree, and an
	 * unfiltered attribute observer would see its own writes and
	 * reschedule itself on every animation frame for the life of the
	 * window. Filtering to `class` puts those writes out of scope.
	 * Anything added here later must respect that.
	 */
	mutationObserver?.observe( strip, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: [ 'class' ],
	} );

	schedule();

	return () => {
		strip.removeEventListener( 'scroll', schedule );
		resizeObserver?.disconnect();
		mutationObserver?.disconnect();
		if ( frame !== null ) {
			window.cancelAnimationFrame( frame );
			frame = null;
		}
	};
}
