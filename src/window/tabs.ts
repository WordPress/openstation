import { __, sprintf } from '../i18n';
import { showToast } from '../toast';
import {
	pageIdentityKey,
	PAGE_IDENTITY_PARAMS,
	urlMatchKey,
} from '../utils';
import { EXTERNAL_IFRAME_READY_TIMEOUT_MS } from './constants';
import {
	buildSubmenuTabs,
	syncTabStripSemantics,
	withChromelessParam,
} from './dom';
import {
	activatePanelTab,
	positionTabPlate,
	syncTabRoving,
} from './tab-strip';
import { navigateWithUnsavedGuard } from './unsaved-guard';
import { tryNativeUrlRemap } from '../native-url-remap';
import type { Window } from './index';

export {
	activatePanelTab,
	handleTabStripKeydown,
	positionTabPlate,
	setPanelTabs,
	syncTabRoving,
} from './tab-strip';
export type { PanelTabEntry } from './tab-strip';

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
				key === 'desktop_mode_portal' ||
				PAGE_IDENTITY_PARAMS.includes( key )
			) {
				continue;
			}
			const curVal = current.searchParams.get( key );
			if ( curVal !== value ) {
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

export function syncActiveTab( win: Window, currentUrl: string ): void {
	const submenuTabs = win.element.querySelectorAll<HTMLElement>(
		'.os-window__tab[data-kind="submenu"]',
	);
	if ( ! submenuTabs.length ) {
		return;
	}

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
	if ( ! active ) {
		const lit = Array.from( submenuTabs ).some( ( t ) =>
			t.classList.contains( 'os-window__tab--active' ),
		);
		if ( lit ) {
			return;
		}

		let isPluginPage = false;
		try {
			const parsed = new URL( currentUrl, window.location.origin );
			isPluginPage =
				parsed.pathname.endsWith( '/admin.php' ) &&
				parsed.searchParams.has( 'page' );
		} catch {
			return;
		}
		if ( ! isPluginPage || ! submenuTabs[ 0 ] ) {
			return;
		}
		active = submenuTabs[ 0 ];
	}
	for ( const tab of submenuTabs ) {
		const isActive = tab === active;
		tab.classList.toggle( 'os-window__tab--active', isActive );
		tab.setAttribute( 'aria-selected', isActive ? 'true' : 'false' );
	}
}

function pageUrlOf( win: Window ): string | undefined {
	const current = win.getCurrentUrl();
	return current && current !== 'about:blank' ? current : win.config.url;
}

export function setSubmenuTabs(
	win: Window,
	entry: {
		url: string;
		submenu?: Window[ 'config' ][ 'submenu' ];
		selfLabel?: string;
	},
): boolean {
	const strip = win.element.querySelector< HTMLElement >( '.os-window__tabs' );
	if ( ! strip || win.config.native ) {
		return false;
	}
	const next = {
		...win.config,
		submenu: entry.submenu ?? [],
		selfLabel: entry.selfLabel,
		parentUrl: entry.url || win.config.parentUrl,
		url: pageUrlOf( win ),
	};

	if ( ! next.url ) {
		return false;
	}
	const currentUrl = next.url;
	win.config.submenu = next.submenu;
	win.config.selfLabel = next.selfLabel;
	win.config.parentUrl = next.parentUrl;

	const fresh = buildSubmenuTabs( next );
	const current = Array.from(
		strip.querySelectorAll< HTMLElement >( ':scope > [data-kind="submenu"]' ),
	);
	const signature = ( tabs: HTMLElement[] ): string =>
		tabs.map( ( t ) => `${ t.dataset.url ?? '' }\n${ t.textContent ?? '' }` ).join( '\n\n' );
	if ( signature( fresh ) === signature( current ) ) {
		return false;
	}

	const litUrl = current.find( ( t ) =>
		t.classList.contains( 'os-window__tab--active' ),
	)?.dataset.url;
	if ( litUrl && ! fresh.some( ( t ) => t.classList.contains( 'os-window__tab--active' ) ) ) {
		const keep = fresh.find( ( t ) => t.dataset.url === litUrl );
		keep?.classList.add( 'os-window__tab--active' );
		keep?.setAttribute( 'aria-selected', 'true' );
	}

	const hadFocus = current.some( ( t ) => t === strip.ownerDocument.activeElement );
	const anchor =
		current[ 0 ] ??
		strip.querySelector( ':scope > [data-kind="main"]' )?.nextSibling ??
		strip.querySelector( '.os-window__tab-plate' )?.nextSibling ??
		null;
	for ( const tab of fresh ) {
		strip.insertBefore( tab, anchor );
	}
	for ( const stale of current ) {
		stale.remove();
	}

	const main = strip.querySelector( ':scope > [data-kind="main"]' );
	if ( fresh.length > 0 ) {
		main?.remove();
	} else if ( externalTabCount( win ) > 0 ) {
		ensureMainTab( win, strip );
	}

	syncTabStripSemantics( strip );
	syncActiveTab( win, currentUrl );
	if ( hadFocus ) {
		(
			strip.querySelector< HTMLElement >( '.os-window__tab--active' ) ??
			strip.querySelector< HTMLElement >( ':scope > .os-window__tab' )
		)?.focus();
	}
	return true;
}

export function addExternalTab(
	win: Window,
	url: string,
	label: string,
): void {
	if ( ! win.iframe ) {
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

	syncTabStripSemantics( tabStrip );

	const iframe = document.createElement( 'iframe' );
	iframe.className = 'os-window__iframe os-window__iframe--external';
	iframe.dataset.tabId = tabId;
	iframe.style.display = 'none';
	iframe.src = url;
	body.appendChild( iframe );

	let loaded = false;
	const onLoad = (): void => {
		loaded = true;
	};
	iframe.addEventListener( 'load', onLoad, { once: true } );
	const probeTimer = window.setTimeout( () => {
		if ( loaded || hasPage( iframe ) ) {
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

	win._emitChange( 'state' );
}

function ensureMainTab( win: Window, tabStrip: HTMLElement ): void {
	if ( tabStrip.querySelector( '[data-kind="main"]' ) ) {
		return;
	}
	if ( tabStrip.querySelector( '[data-kind="submenu"]' ) ) {
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
	syncTabStripSemantics( tabStrip );
}

export function switchToTab( win: Window, tabId: 'primary' | string ): void {
	if ( win._activeTabId === tabId ) {
		return;
	}
	win._activeTabId = tabId;

	if ( win.iframe ) {
		win.iframe.style.display = tabId === 'primary' ? '' : 'none';
	}

	for ( const [ id, entry ] of win._externalTabs ) {
		entry.iframe.style.display = tabId === id ? '' : 'none';
	}

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
			isActive =
				tabId === 'primary' &&
				t.classList.contains( 'os-window__tab--active' );
		}
		t.classList.toggle( 'os-window__tab--active', isActive );
		t.setAttribute( 'aria-selected', isActive ? 'true' : 'false' );
	} );
}

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

	if ( win._externalTabs.size === 0 ) {
		const main = win.element.querySelector(
			'.os-window__tab--main',
		);
		main?.remove();
	}

	syncTabStripSemantics(
		win.element.querySelector< HTMLElement >( '.os-window__tabs' ),
	);

	win._emitChange( 'state' );
}

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

	}
	window.open( url, '_blank', 'noopener' );
	closeExternalTab( win, tabId );
}

function hasPage( iframe: HTMLIFrameElement ): boolean {
	try {
		return iframe.contentWindow?.location.href !== 'about:blank';
	} catch {
		return true;
	}
}

function fallbackToBrowserTab( win: Window, tabId: string ): void {
	const entry = win._externalTabs.get( tabId );
	if ( ! entry ) {
		return;
	}
	const { url, label } = entry;
	closeExternalTab( win, tabId );
	showToast( {
		message: sprintf(

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

export function externalTabCount( win: Window ): number {
	return win._externalTabs.size;
}

export function externalTabsSnapshot(
	win: Window,
): { url: string; label: string }[] {
	const out: { url: string; label: string }[] = [];
	for ( const entry of win._externalTabs.values() ) {
		let url = entry.url;
		try {
			const href = entry.iframe.contentWindow?.location.href;
			if ( href && href !== 'about:blank' ) {
				url = href;
			}
		} catch {

		}
		out.push( { url, label: entry.label } );
	}
	return out;
}

export function handleTabStripClick( win: Window, e: Event ): void {
	const target = e.target as HTMLElement;

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

	if ( kind === 'panel' && tab.dataset.panel ) {
		activatePanelTab( win.element, tab.dataset.panel );
		return;
	}

	if ( tab.dataset.url ) {
		const destination = tab.dataset.url;

		if ( tryNativeUrlRemap( destination ) ) {
			return;
		}
		const next = withChromelessParam( destination );

		switchToTab( win, 'primary' );
		const paint = (): void => {
			win.markContentLoading();

			syncActiveTab( win, destination );
		};
		if ( next && win.iframe ) {
			navigateWithUnsavedGuard( win, {
				commit: paint,
				navigate: () => {
					if ( win.iframe ) {
						win.iframe.src = next;
					}
				},
			} );
		} else {
			syncActiveTab( win, destination );
		}
	}
}

const OVERFLOW_EPSILON = 1;

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

export function observeTabOverflow( strip: HTMLElement ): () => void {
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

			syncTabRoving( strip );
		} );
	};

	const scheduleWithDirection = (): void => {
		rtl = null;
		schedule();
	};

	strip.addEventListener( 'scroll', schedule, { passive: true } );

	const resizeObserver =
		typeof ResizeObserver === 'undefined'
			? null
			: new ResizeObserver( scheduleWithDirection );
	resizeObserver?.observe( strip );

	const mutationObserver =
		typeof MutationObserver === 'undefined'
			? null
			: new MutationObserver( scheduleWithDirection );

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
