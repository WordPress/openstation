import type { WindowConfig } from '../types';
import { urlMatchKey } from '../utils';
import { isShellDocumentUrl } from '../shell-url';
import { OS_TAB_PARAM } from '../native-url-remap';
import { paintThemedControlIcon } from '../window-chrome/controls/paint-themed-icon';
import { __, sprintf } from '../i18n';

import {
	markWindowContentLoading,
	markWindowContentReady,
} from '../window-channels';
import { HOOKS, applyFilters } from '../hooks';
import { noteFrameLoaded } from '../plugin-presence';
import { createRevealLayers } from '../reveals/surface';
import { syncTabStripSemantics } from './tab-strip';
import {
	LOADING_OVERLAY_CLASS,
	LOADING_OVERLAY_SHOW_DELAY_MS,
	LOADING_OVERLAY_VISIBLE_CLASS,
} from './constants';

export const LOADING_BODY_CLASS = 'os-window__body--loading';

export { syncTabStripSemantics } from './tab-strip';

export const LOADING_HANDOFF_BODY_CLASS = 'os-window__body--loading-out';

export const LOADING_STARTED_ATTR = 'data-os-loading-at';

export const LOADING_CYCLE_ATTR = 'data-os-loading-cycle';

export function loadingCycle( body: HTMLElement ): string {
	return body.getAttribute( LOADING_CYCLE_ATTR ) ?? '0';
}

export function stampLoadingStart( body: HTMLElement ): void {
	body.setAttribute( LOADING_STARTED_ATTR, String( Date.now() ) );
	body.setAttribute(
		LOADING_CYCLE_ATTR,
		String( Number( loadingCycle( body ) ) + 1 ),
	);
}

export function scheduleLoadingOverlayShow(
	body: HTMLElement,
	overlay: HTMLElement,
): void {
	const startedAt = Number( body.getAttribute( LOADING_STARTED_ATTR ) );
	const elapsed =
		Number.isFinite( startedAt ) && startedAt > 0 ? Date.now() - startedAt : 0;
	const remaining = LOADING_OVERLAY_SHOW_DELAY_MS - elapsed;
	if ( remaining <= 0 ) {
		overlay.classList.add( LOADING_OVERLAY_VISIBLE_CLASS );
		return;
	}

	window.setTimeout( () => {
		if ( ! overlay.isConnected ) {
			return;
		}
		if ( ! body.classList.contains( LOADING_BODY_CLASS ) ) {
			return;
		}
		overlay.classList.add( LOADING_OVERLAY_VISIBLE_CLASS );
	}, remaining );
}

const WINDOW_CONFIG_KEY = Symbol.for( 'desktop-mode/window-config' );

type ConfigCarrier = HTMLElement & { [ WINDOW_CONFIG_KEY ]?: WindowConfig };

function setWindowConfigOnElement( el: HTMLElement, config: WindowConfig ): void {
	( el as ConfigCarrier )[ WINDOW_CONFIG_KEY ] = config;
}

function getWindowConfigFromElement( el: HTMLElement ): WindowConfig | undefined {
	return ( el as ConfigCarrier )[ WINDOW_CONFIG_KEY ];
}

const INITIAL_ORIGIN = window.location.origin;

function namesAnotherWindowsTab( url: string ): boolean {
	try {
		return new URL( url, INITIAL_ORIGIN ).searchParams.has( OS_TAB_PARAM );
	} catch {
		return false;
	}
}

export function withChromelessParam( url: string ): string | null {
	const parsed = new URL( url, INITIAL_ORIGIN );
	if ( parsed.origin !== INITIAL_ORIGIN ) {
		return null;
	}
	if ( isShellDocumentUrl( parsed ) ) {
		return null;
	}
	parsed.searchParams.set( 'openstation_chromeless', '1' );
	return parsed.toString();
}

export function updateFullscreenBodyClass(): void {
	const hasFullscreen =
		document.querySelectorAll( '.os-window--fullscreen:not(.os-window--minimized)' ).length > 0;
	document.body.classList.toggle( 'os-has-fullscreen-window', hasFullscreen );
}

function buildDefaultLoadingOverlay(): HTMLElement {
	const overlay = document.createElement( 'div' );
	overlay.className = LOADING_OVERLAY_CLASS;

	overlay.setAttribute( 'role', 'status' );
	overlay.setAttribute( 'aria-live', 'polite' );

	const spinner = document.createElement( 'os-spinner' );

	spinner.setAttribute( 'preset', 'classic' );
	spinner.setAttribute( 'size', 'clamp(96px, 14vw, 192px)' );
	spinner.setAttribute( 'label', __( 'Loading window content' ) );
	overlay.appendChild( spinner );
	return overlay;
}

function createLoadingOverlay( config: WindowConfig ): HTMLElement {
	let overlay = buildDefaultLoadingOverlay();
	const ctx = { windowId: config.id, config };

	if ( typeof config.loading?.render === 'function' ) {
		try {
			config.loading.render( overlay, ctx );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] loading.render threw for "${ config.id }":`,
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
				`[openstation] WINDOW_LOADING_OVERLAY filter threw for "${ config.id }":`,
				err,
			);
		}
	}

	if ( overlay && ! overlay.classList.contains( LOADING_OVERLAY_CLASS ) ) {
		overlay.classList.add( LOADING_OVERLAY_CLASS );
	}
	return overlay;
}

export function removeLoadingOverlay( windowEl: HTMLElement ): void {
	const overlay = windowEl.querySelector( ':scope .os-window__loading' );
	overlay?.remove();
}

export function ensureLoadingOverlay( windowEl: HTMLElement ): void {
	const body = windowEl.querySelector< HTMLElement >(
		':scope .os-window__body',
	);
	if ( ! body ) {
		return;
	}
	const existing = body.querySelector( ':scope .os-window__loading' );
	if ( existing ) {
		return;
	}
	const config = getWindowConfigFromElement( windowEl );
	const overlay = config
		? createLoadingOverlay( config )
		: buildDefaultLoadingOverlay();
	body.appendChild( overlay );
	scheduleLoadingOverlayShow( body, overlay );
}

function createSlotHost( name: string ): HTMLElement {
	const host = document.createElement( 'span' );
	host.className =
		`os-window__slot os-window__slot--${ name }`;
	host.dataset.slot = name;
	return host;
}

export function createControlButton(
	variant: string,
	label: string,
	icon: string,
): HTMLElement {
	const btn = document.createElement( 'os-window-button' );
	btn.setAttribute( 'icon', icon );
	btn.setAttribute( 'aria-label', label );
	btn.classList.add( 'os-window__btn' );
	btn.classList.add( `os-window__btn--${ variant }` );
	if ( variant === 'close' ) {
		btn.setAttribute( 'danger', '' );
	}
	return btn;
}

export function buildSubmenuTabs(
	config: Pick< WindowConfig, 'submenu' | 'url' | 'parentUrl' | 'selfLabel' | 'title' >,
): HTMLButtonElement[] {
	const built: HTMLButtonElement[] = [];

	const tabSubmenu = ( config.submenu ?? [] ).filter(
		( s ) => ! s.offSite && ! namesAnotherWindowsTab( s.url ),
	);

	if ( tabSubmenu.length === 0 || ! config.url ) {
		return [];
	}
	const initialKey = urlMatchKey( config.url );

	const synthUrl = config.parentUrl ?? config.url;
	const synthKey = urlMatchKey( synthUrl );
	const parentAlreadyInSubmenu = tabSubmenu.some(
		( s ) => urlMatchKey( s.url ) === synthKey,
	);

	const seedSubmenu: { title: string; url: string }[] = parentAlreadyInSubmenu
		? [ ...tabSubmenu ]
		: [
			{ title: config.selfLabel || config.title, url: synthUrl },
			...tabSubmenu,
		];

	for ( const sub of seedSubmenu ) {
		const tab = document.createElement( 'button' );
		tab.className = 'os-window__tab';
		tab.dataset.kind = 'submenu';
		tab.setAttribute( 'type', 'button' );
		tab.setAttribute( 'role', 'tab' );
		tab.dataset.url = sub.url;
		tab.textContent = sub.title;
		if ( urlMatchKey( sub.url ) === initialKey ) {
			tab.classList.add( 'os-window__tab--active' );
			tab.setAttribute( 'aria-selected', 'true' );
		} else {
			tab.setAttribute( 'aria-selected', 'false' );
		}
		built.push( tab );
	}
	return built;
}

export function createWindowElement( config: WindowConfig ): HTMLElement {
	const el = document.createElement( 'div' );
	el.className = 'os-window';
	if ( config.native ) {
		el.classList.add( 'os-window--native' );
	}
	el.id = `wp-window-${ config.id }`;
	el.setAttribute( 'role', 'dialog' );
	el.setAttribute( 'aria-labelledby', `wp-window-title-${ config.id }` );

	el.setAttribute( 'aria-busy', 'true' );
	el.style.left = `${ config.x }px`;
	el.style.top = `${ config.y }px`;
	el.style.width = `${ config.width }px`;
	el.style.height = `${ config.height }px`;

	const titleBar = document.createElement( 'div' );
	titleBar.className = 'os-window__titlebar';

	const menuBtn = document.createElement( 'os-window-button' );
	menuBtn.setAttribute( 'icon', 'menu' );

	paintThemedControlIcon( menuBtn, 'core/menu' );
	menuBtn.setAttribute( 'aria-label', __( 'Window actions' ) );
	menuBtn.setAttribute( 'aria-haspopup', 'menu' );
	menuBtn.setAttribute( 'aria-expanded', 'false' );

	menuBtn.classList.add( 'os-window__btn' );
	menuBtn.classList.add( 'os-window__menu-btn' );

	const menuPanel = document.createElement( 'os-menu' );
	menuPanel.classList.add( 'os-window__menu-panel' );
	menuPanel.hidden = true;

	const startup = document.createElement( 'os-menu-item' );
	startup.setAttribute( 'role', 'menuitemcheckbox' );
	startup.setAttribute( 'value', 'startup' );

	startup.classList.add( 'os-window__menu-item' );
	startup.classList.add( 'os-window__menu-item--startup' );
	startup.textContent = __( 'Open on startup' );
	menuPanel.appendChild( startup );

	if ( config.multi ) {
		const openAnother = document.createElement( 'os-menu-item' );
		openAnother.setAttribute( 'role', 'menuitem' );
		openAnother.setAttribute( 'value', 'open-another' );
		openAnother.setAttribute( 'icon', 'dashicons-plus-alt2' );
		openAnother.classList.add( 'os-window__menu-item' );
		openAnother.classList.add(
			'os-window__menu-item--open-another',
		);
		openAnother.textContent = sprintf(

			__( 'Open another %s' ),
			config.title,
		);
		menuPanel.appendChild( openAnother );
	}

	if ( ! config.native ) {
		const openInNew = document.createElement( 'os-menu-item' );
		openInNew.setAttribute( 'role', 'menuitem' );
		openInNew.setAttribute( 'value', 'open-in-new-window' );
		openInNew.setAttribute( 'icon', 'dashicons-plus-alt' );
		openInNew.classList.add( 'os-window__menu-item' );
		openInNew.classList.add( 'os-window__menu-item--open-in-new-window' );
		openInNew.textContent = __( 'Open in new window' );
		menuPanel.appendChild( openInNew );
	}

	if ( ! config.native || config.render ) {
		const reload = document.createElement( 'os-menu-item' );
		reload.setAttribute( 'role', 'menuitem' );
		reload.setAttribute( 'value', 'reload' );
		reload.setAttribute( 'icon', 'dashicons-update' );
		reload.classList.add( 'os-window__menu-item' );
		reload.classList.add( 'os-window__menu-item--reload' );
		reload.textContent = __( 'Reload' );
		menuPanel.appendChild( reload );
	}

	if ( ! config.native ) {
		const openExternal = document.createElement( 'os-menu-item' );
		openExternal.setAttribute( 'role', 'menuitem' );
		openExternal.setAttribute( 'value', 'open-external' );
		openExternal.setAttribute( 'icon', 'dashicons-external' );
		openExternal.classList.add( 'os-window__menu-item' );
		openExternal.classList.add( 'os-window__menu-item--open-external' );
		openExternal.textContent = __( 'Open in classic wp-admin' );
		menuPanel.appendChild( openExternal );
	}

	const slotIcon = createSlotHost( 'icon' );

	const slotTitle = createSlotHost( 'title' );
	const titleEl = document.createElement( 'span' );
	titleEl.className = 'os-window__title';
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
	controls.className = 'os-window__controls';

	const screenMeta = document.createElement( 'div' );
	screenMeta.className = 'os-window__screen-meta';

	const customLeft = document.createElement( 'span' );
	customLeft.className = 'os-window__custom-buttons os-window__custom-buttons--left';

	const customRight = document.createElement( 'span' );
	customRight.className = 'os-window__custom-buttons os-window__custom-buttons--right';

	const activityRing = document.createElement( 'os-save-status' );
	activityRing.className = 'os-window__status';
	activityRing.setAttribute( 'mode', 'icon' );
	activityRing.setAttribute( 'variant', 'ring' );
	activityRing.setAttribute( 'phase', 'idle' );
	activityRing.setAttribute( 'data-os-activity-indicator', '' );

	const activityStatus = document.createElement( 'span' );
	activityStatus.className = 'os-window__activity-status';
	activityStatus.setAttribute( 'role', 'status' );
	activityStatus.setAttribute( 'aria-live', 'polite' );

	titleBar.appendChild( activityStatus );
	titleBar.appendChild( activityRing );
	titleBar.appendChild( slotBeforeIcon );
	titleBar.appendChild( slotIcon );
	titleBar.appendChild( slotTitle );
	titleBar.appendChild( slotAfterTitle );
	titleBar.appendChild( customLeft );
	titleBar.appendChild( screenMeta );

	if ( menuBtn && menuPanel && menuPanel.children.length > 0 ) {
		titleBar.appendChild( menuBtn );
		titleBar.appendChild( menuPanel );
	}
	titleBar.appendChild( customRight );
	titleBar.appendChild( slotBeforeControls );
	titleBar.appendChild( controls );
	titleBar.appendChild( slotAfterControls );

	for ( const child of Array.from( titleBar.children ) ) {
		( child as HTMLElement ).setAttribute(
			'data-os-default-chrome',
			'',
		);
	}

	const body = document.createElement( 'div' );
	body.className = `os-window__body ${ LOADING_BODY_CLASS }`;

	stampLoadingStart( body );

	if ( ! config.native ) {
		const iframe = document.createElement( 'iframe' );
		iframe.className = 'os-window__iframe';
		iframe.setAttribute( 'name', `os-frame-${ config.id }` );

		const chromelessSrc = config.url
			? withChromelessParam( config.url )
			: null;
		iframe.src = chromelessSrc ?? 'about:blank';

		body.appendChild( iframe );

		const onIframeLoad = (): void => {
			markWindowContentReady( config.id );
			noteFrameLoaded( iframe );
		};
		iframe.addEventListener( 'load', onIframeLoad );
	} else {
		body.classList.add( 'os-window__body--native' );
	}

	const loadingOverlay = createLoadingOverlay( config );
	body.appendChild( loadingOverlay );
	scheduleLoadingOverlayShow( body, loadingOverlay );

	for ( const layer of createRevealLayers() ) {
		body.appendChild( layer );
	}

	markWindowContentLoading( config.id );

	const resizeHandles: HTMLElement[] = [];
	for ( const dir of [ 'ne', 'nw', 'se', 'sw' ] as const ) {
		const h = document.createElement( 'div' );
		h.className = `os-window__resize-handle os-window__resize-handle--${ dir }`;
		h.dataset.dir = dir;
		h.setAttribute( 'aria-hidden', 'true' );
		resizeHandles.push( h );
	}

	el.appendChild( slotBeforeTitlebar );
	el.appendChild( titleBar );
	el.appendChild( slotAfterTitlebar );

	{
		const tabs = document.createElement( 'nav' );
		tabs.className = 'os-window__tabs';

		const plate = document.createElement( 'span' );
		plate.className = 'os-window__tab-plate';
		plate.setAttribute( 'aria-hidden', 'true' );
		const plateFill = document.createElement( 'span' );
		plateFill.className = 'os-window__tab-plate-fill';
		const plateJoint = document.createElement( 'span' );
		plateJoint.className = 'os-window__tab-plate-joint';
		plate.appendChild( plateFill );
		plate.appendChild( plateJoint );
		tabs.appendChild( plate );

		if ( config.native ) {
			tabs.dataset.tablistLabel = sprintf( __( '%s sections' ), config.title );
		} else {
			tabs.dataset.tablistLabel = sprintf( __( '%s sub-pages' ), config.title );
		}

		for ( const tab of buildSubmenuTabs( config ) ) {
			tabs.appendChild( tab );
		}
		syncTabStripSemantics( tabs );
		el.appendChild( tabs );
	}

	el.appendChild( body );
	for ( const h of resizeHandles ) {
		el.appendChild( h );
	}

	setWindowConfigOnElement( el, config );

	return el;
}
