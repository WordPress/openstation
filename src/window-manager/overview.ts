import { doAction, HOOKS } from '../hooks';
import { _n, __, sprintf } from '../i18n';
import { osIconSvg } from '../ui/icons';
import type { Desktop } from '../types';
import { computeOverviewLayout, type OverviewLayoutItem } from './geometry';
import { overviewTopBarReserve } from './overview-constants';
import {
	closeDesktop,
	createDesktop,
	renameDesktop,
	switchDesktop,
} from './desktops';
import type { Window } from '../window';
import { updateFullscreenBodyClass } from '../window/dom';

import {
	createWorkspaceFromOverview,
	editWorkspaceFromOverview,
	isWorkspaceOverviewInstalled,
	restoreWorkspace,
	workspaceCanRestore,
} from '../workspaces/overview-control';
import type { WindowManager } from './index';

const OVERVIEW_INERT_ELEMENTS = [
	'adminmenumain',
	'adminmenuback',
	'os-dock',
	'os-side-dock',
	'os-widgets',
];

const OVERVIEW_FULLSCREEN_DATA_KEY = 'osHadFullscreenBeforeOverview';

const TILE_LABEL_DOUBLE_CLICK_MS = 250;

export function prepareWindowForOverviewLayout( w: Window ): void {
	if (
		w.state === 'fullscreen' ||
		w.element.classList.contains( 'os-window--fullscreen' )
	) {
		w.element.classList.remove( 'os-window--fullscreen' );
		w.element.dataset[ OVERVIEW_FULLSCREEN_DATA_KEY ] = 'true';
		updateFullscreenBodyClass();
	}
	if ( w.state !== 'minimized' ) {
		return;
	}
	w.element.style.removeProperty( 'content-visibility' );
	if ( w.iframe ) {
		w.iframe.style.visibility = '';
	}
}

function restoreOverviewFullscreenState( w: Window ): void {
	if ( w.element.dataset[ OVERVIEW_FULLSCREEN_DATA_KEY ] !== 'true' ) {
		return;
	}
	if ( w.state !== 'fullscreen' && w.state !== 'minimized' ) {
		delete w.element.dataset[ OVERVIEW_FULLSCREEN_DATA_KEY ];
		updateFullscreenBodyClass();
		return;
	}
	w.element.classList.add( 'os-window--fullscreen' );
	delete w.element.dataset[ OVERVIEW_FULLSCREEN_DATA_KEY ];
	updateFullscreenBodyClass();
}

export function restoreWindowAfterOverviewLayout(
	w: Window,
	restoreFullscreen = true,
): void {
	if ( restoreFullscreen ) {
		restoreOverviewFullscreenState( w );
	}
	if ( w.state === 'minimized' ) {
		w.element.style.setProperty( 'content-visibility', 'hidden' );
		if ( w.iframe ) {
			w.iframe.style.visibility = 'hidden';
		}
	}
}

function inertWpBodyContentChildren( inactive: boolean ): void {
	const content = document.getElementById( 'wpbody-content' );
	if ( ! content ) {
		return;
	}
	for ( const child of Array.from( content.children ) ) {
		( child as HTMLElement & { inert: boolean } ).inert = inactive;
	}
}

function inertWindowChildren( mgr: WindowManager, inactive: boolean ): void {
	for ( const w of mgr._stack ) {
		for ( const child of Array.from( w.element.children ) ) {
			( child as HTMLElement & { inert: boolean } ).inert = inactive;
		}
	}
}

export function enterOverview( mgr: WindowManager ): void {
	if ( mgr._overviewActive ) {
		return;
	}

	flushPendingOverviewExit( mgr );

	const eligible = mgr._stack.filter(
		( w ) =>
			w.config.desktopId === mgr._activeDesktopId,
	);

	mgr._overviewActive = true;

	doAction( HOOKS.OVERVIEW_ENTERING, {} );

	doAction( HOOKS.DOCK_REFRESH_ACTIVE, {} );

	for ( const id of OVERVIEW_INERT_ELEMENTS ) {
		const el = document.getElementById( id );
		if ( el ) {
			( el as HTMLElement & { inert: boolean } ).inert = true;
		}
	}

	inertWpBodyContentChildren( true );

	inertWindowChildren( mgr, true );

	mgr._overviewSnapshot.clear();
	for ( const w of eligible ) {
		mgr._overviewSnapshot.set( w.id, {
			transform: w.element.style.transform || '',
			transition: w.element.style.transition || '',
		} );
	}

	for ( const w of eligible ) {
		prepareWindowForOverviewLayout( w );
	}

	const currentRect = mgr._desktop.getBoundingClientRect();
	const docks = Array.from(
		document.querySelectorAll< HTMLElement >( '.os-dock' ),
	);
	let reclaimedWidth = 0;
	for ( const d of docks ) {
		const r = d.getBoundingClientRect();
		const verticallyOverlaps =
			r.bottom > currentRect.top && r.top < currentRect.bottom;
		const isHorizontalRail = r.height > r.width;
		if ( verticallyOverlaps && isHorizontalRail ) {
			reclaimedWidth += r.width;
		}
	}
	const targetRect = new DOMRect(
		0,
		0,
		currentRect.width + reclaimedWidth,
		currentRect.height,
	);

	mgr._desktop.classList.add( 'os-area--overview' );
	const shell = document.getElementById( 'os-shell' );
	shell?.classList.add( 'os-shell--overview' );

	mgr._overviewTopBar = buildOverviewTopBar( mgr );
	mgr._desktop.appendChild( mgr._overviewTopBar );

	const layout = computeOverviewLayout(
		eligible,
		targetRect,
		overviewTopBarReserve( mgr._overviewTopBar ),
	);

	mgr._overviewLabels.clear();
	for ( const item of layout ) {
		const el = item.win.element;
		el.classList.add( 'os-window--overview' );
		const dx = item.x - el.offsetLeft;
		const dy = item.y - el.offsetTop;

		el.style.transform = `translate(${ dx }px, ${ dy }px) scale(${ item.scale })`;

		const label = createOverviewLabel( item );

		el.insertAdjacentElement( 'afterend', label );
		mgr._overviewLabels.set( item.win.id, label );
	}

	const pressTargetForEvent = (
		e: PointerEvent,
	): { id: string; element: HTMLElement } | null => {
		const target = e.target as HTMLElement | null;
		const winEl = target?.closest<HTMLElement>(
			'.os-window--overview',
		);
		if ( winEl ) {
			return {
				id: winEl.id.replace( /^wp-window-/, '' ),
				element: winEl,
			};
		}
		if ( target === mgr._desktop ) {
			return { id: 'backdrop', element: mgr._desktop };
		}
		return null;
	};

	mgr._overviewPointerDownHandler = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			mgr._overviewPressTarget = null;
			return;
		}
		mgr._overviewPressTarget = pressTargetForEvent( e );

		if ( mgr._overviewPressTarget ) {
			e.preventDefault();
			e.stopPropagation();
		}
	};

	mgr._overviewPointerUpHandler = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		const pressed = mgr._overviewPressTarget;
		mgr._overviewPressTarget = null;
		if ( ! pressed ) {
			return;
		}
		const rect = pressed.element.getBoundingClientRect();
		const inside =
			e.clientX >= rect.left &&
			e.clientX <= rect.right &&
			e.clientY >= rect.top &&
			e.clientY <= rect.bottom;
		if ( ! inside ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		if ( pressed.id === 'backdrop' ) {
			exitOverview( mgr );
			return;
		}
		const selected = mgr.getById( pressed.id );
		doAction( HOOKS.OVERVIEW_WINDOW_CLICK, { windowId: pressed.id } );
		exitOverview( mgr, selected );
	};

	mgr._overviewKeyHandler = ( e: KeyboardEvent ) => {
		if ( e.key === 'Escape' ) {
			exitOverview( mgr );
			return;
		}

		if ( e.key === 'Enter' ) {
			const target = e.target as HTMLElement | null;
			const doc = target?.ownerDocument || document;
			if ( doc.activeElement && doc.activeElement.tagName === 'BUTTON' ) {
				return;
			}
			e.preventDefault();
			if ( mgr._overviewAddTileFocused ) {
				commitAddTile( mgr );
				return;
			}
			exitOverview( mgr );
		}
	};
	mgr._desktop.addEventListener(
		'pointerdown',
		mgr._overviewPointerDownHandler,
		true,
	);
	mgr._desktop.addEventListener(
		'pointerup',
		mgr._overviewPointerUpHandler,
		true,
	);

	mgr._overviewClickBlocker = ( e: MouseEvent ) => {
		const target = e.target as HTMLElement | null;
		if ( target?.closest( '.os-overview-top-bar' ) ) {
			return;
		}
		e.stopPropagation();
		e.preventDefault();
	};
	mgr._desktop.addEventListener(
		'click',
		mgr._overviewClickBlocker,
		true,
	);
	document.addEventListener( 'keydown', mgr._overviewKeyHandler );

	mgr._lastOverviewHoverId = null;
	mgr._overviewMouseHandler = ( e: MouseEvent ) => {
		const target = e.target as HTMLElement | null;
		const winEl = target?.closest<HTMLElement>(
			'.os-window--overview',
		);
		const newId = winEl
			? winEl.id.replace( /^wp-window-/, '' )
			: null;
		if ( newId === mgr._lastOverviewHoverId ) {
			return;
		}
		if ( mgr._lastOverviewHoverId ) {
			doAction( HOOKS.OVERVIEW_WINDOW_UNHOVER, {
				windowId: mgr._lastOverviewHoverId,
			} );
		}
		if ( newId ) {
			doAction( HOOKS.OVERVIEW_WINDOW_HOVER, { windowId: newId } );
		}
		mgr._lastOverviewHoverId = newId;
	};
	mgr._desktop.addEventListener( 'mouseover', mgr._overviewMouseHandler );

	mgr._overviewEnterTimeoutId = window.setTimeout( () => {
		mgr._overviewEnterTimeoutId = null;
		if ( mgr._overviewActive ) {
			doAction( HOOKS.OVERVIEW_ENTERED, {} );
		}
	}, 300 ) as unknown as number;
}

export function flushPendingOverviewExit( mgr: WindowManager ): void {
	if ( mgr._overviewExitTimeoutId !== null ) {
		window.clearTimeout( mgr._overviewExitTimeoutId );
		mgr._overviewExitTimeoutId = null;
	}
	const finalize = mgr._overviewExitFinalizer;
	mgr._overviewExitFinalizer = null;
	finalize?.();
}

export function cancelOverviewTimers( mgr: WindowManager ): void {
	if ( mgr._overviewEnterTimeoutId !== null ) {
		window.clearTimeout( mgr._overviewEnterTimeoutId );
		mgr._overviewEnterTimeoutId = null;
	}
	if ( mgr._overviewExitTimeoutId !== null ) {
		window.clearTimeout( mgr._overviewExitTimeoutId );
		mgr._overviewExitTimeoutId = null;
	}

	mgr._overviewExitFinalizer = null;
}

let overviewHeaderBuilder: ( () => HTMLElement | null ) | null = null;

export function installOverviewHeader(
	build: () => HTMLElement | null,
): () => void {
	overviewHeaderBuilder = build;
	return () => {
		overviewHeaderBuilder = null;
	};
}

function buildOverviewTopBar( mgr: WindowManager ): HTMLElement {
	const bar = document.createElement( 'div' );
	bar.className = 'os-overview-top-bar';

	const header = overviewHeaderBuilder?.();
	if ( header ) {
		const row = document.createElement( 'div' );
		row.className = 'os-overview-top-bar__header';
		row.appendChild( header );
		bar.appendChild( row );
	}

	const list = document.createElement( 'div' );
	list.className = 'os-overview-top-bar__list';
	bar.appendChild( list );

	if ( mgr._desktops.some( workspaceCanRestore ) ) {
		list.classList.add( 'os-overview-top-bar__list--restorable' );
	}

	for ( const d of mgr._desktops ) {
		list.appendChild( buildDesktopTile( mgr, d ) );
	}

	const addTile = document.createElement( 'button' );
	addTile.type = 'button';
	addTile.className =
		'os-overview-top-bar__tile os-overview-top-bar__tile--add';
	if ( mgr._overviewAddTileFocused ) {
		addTile.classList.add(
			'os-overview-top-bar__tile--cursor',
		);
	}
	addTile.setAttribute( 'aria-label', __( 'Add new workspace' ) );

	addTile.innerHTML =
		'<span class="os-overview-top-bar__tile-preview">' +
		'<span class="os-overview-top-bar__tile-plus" aria-hidden="true">+</span>' +
		'</span>' +
		'<span class="os-overview-top-bar__tile-label" aria-hidden="true">&nbsp;</span>';
	addTile.addEventListener( 'click', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		commitAddTile( mgr );
	} );

	const addWrapper = document.createElement( 'div' );
	addWrapper.className =
		'os-overview-top-bar__tile-wrapper os-overview-top-bar__tile-wrapper--add';
	addWrapper.appendChild( addTile );
	const addActions = document.createElement( 'div' );
	addActions.className = 'os-overview-top-bar__tile-actions';
	addWrapper.appendChild( addActions );
	list.appendChild( addWrapper );

	return bar;
}

export function commitAddTile( mgr: WindowManager ): void {
	mgr._overviewAddTileFocused = false;
	const created = createDesktop( mgr );
	exitOverviewToDesktop( mgr, created.id );

	createWorkspaceFromOverview( created.id );
}

function buildDesktopTile( mgr: WindowManager, d: Desktop ): HTMLElement {
	const wrapper = document.createElement( 'div' );
	wrapper.className = 'os-overview-top-bar__tile-wrapper';

	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className = 'os-overview-top-bar__tile';
	tile.dataset.desktopId = d.id;

	if ( d.id === mgr._activeDesktopId && ! mgr._overviewAddTileFocused ) {
		tile.classList.add( 'os-overview-top-bar__tile--active' );
	}

	tile.setAttribute( 'aria-label', sprintf( __( 'Switch to %s' ), d.label ) );

	const profile = d.profile;
	if ( profile?.color ) {
		wrapper.style.setProperty( '--os-workspace-accent', profile.color );
		tile.classList.add( 'os-overview-top-bar__tile--tinted' );
	}

	const preview = document.createElement( 'span' );
	preview.className = 'os-overview-top-bar__tile-preview';
	if ( profile?.icon ) {
		const glyph = document.createElement( 'span' );
		glyph.className = `os-overview-top-bar__tile-glyph dashicons ${ profile.icon }`;
		glyph.setAttribute( 'aria-hidden', 'true' );
		preview.appendChild( glyph );
	}

	const count = mgr._stack.filter(
		( w ) => w.config.desktopId === d.id,
	).length;
	if ( count > 0 ) {
		const badge = document.createElement( 'span' );
		badge.className = 'os-overview-top-bar__tile-count';
		badge.textContent = String( count );
		preview.appendChild( badge );
	}
	tile.appendChild( preview );

	const label = document.createElement( 'span' );
	label.className = 'os-overview-top-bar__tile-label';
	label.textContent = d.label;

	label.title = sprintf(

		__( '%s — double-click to rename' ),
		d.label,
	);
	tile.appendChild( label );

	let switchTimer: number | undefined;
	label.addEventListener( 'click', ( e: MouseEvent ) => {
		if ( label.hasAttribute( 'contenteditable' ) ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		if ( switchTimer !== undefined ) {
			return;
		}
		switchTimer = window.setTimeout( () => {
			switchTimer = undefined;

			if ( mgr._overviewActive ) {
				exitOverviewToDesktop( mgr, d.id );
			}
		}, TILE_LABEL_DOUBLE_CLICK_MS );
	} );
	label.addEventListener( 'dblclick', ( e: MouseEvent ) => {
		if ( label.hasAttribute( 'contenteditable' ) ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		window.clearTimeout( switchTimer );
		switchTimer = undefined;
		beginRename( mgr, label, d );
	} );

	tile.addEventListener( 'click', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();

		if ( label.hasAttribute( 'contenteditable' ) ) {
			return;
		}
		exitOverviewToDesktop( mgr, d.id );
	} );

	const editable = isWorkspaceOverviewInstalled();
	const editBtn = document.createElement( 'button' );
	editBtn.type = 'button';
	editBtn.className = 'os-overview-top-bar__tile-edit';
	if ( editable ) {
		editBtn.setAttribute(
			'aria-label',

			sprintf( __( 'Edit %s — its apps, widgets, look and windows' ), d.label ),
		);
	} else {
		editBtn.setAttribute( 'aria-label', sprintf( __( 'Rename %s' ), d.label ) );
	}
	editBtn.title = editBtn.getAttribute( 'aria-label' ) ?? '';
	editBtn.innerHTML = osIconSvg( 'edit', { size: 14 } );
	editBtn.addEventListener( 'click', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		if ( ! editable ) {
			beginRename( mgr, label, d );
			return;
		}

		exitOverviewToDesktop( mgr, d.id );
		editWorkspaceFromOverview( d.id );
	} );

	const closeBtn = document.createElement( 'button' );
	closeBtn.type = 'button';
	closeBtn.className = 'os-overview-top-bar__tile-close';

	closeBtn.setAttribute( 'aria-label', sprintf( __( 'Close %s' ), d.label ) );
	closeBtn.innerHTML = osIconSvg( 'close', { size: 16 } );
	closeBtn.addEventListener( 'click', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		closeDesktop( mgr, d.id );
		refreshOverviewTopBar( mgr );
	} );

	wrapper.appendChild( tile );
	wrapper.appendChild( editBtn );
	wrapper.appendChild( closeBtn );

	const actions = document.createElement( 'div' );
	actions.className = 'os-overview-top-bar__tile-actions';

	if ( workspaceCanRestore( d ) ) {
		const restoreBtn = document.createElement( 'button' );
		restoreBtn.type = 'button';
		restoreBtn.className =
			'os-overview-top-bar__tile-action os-overview-top-bar__tile-restore';

		restoreBtn.setAttribute(
			'aria-label',

			sprintf( __( 'Restore %s — reopen its windows, widgets and look' ), d.label ),
		);
		restoreBtn.title = restoreBtn.getAttribute( 'aria-label' ) ?? '';
		restoreBtn.innerHTML = `${ osIconSvg( 'windows', { size: 12 } ) }<span>${ __( 'Restore' ) }</span>`;
		restoreBtn.addEventListener( 'click', ( e: MouseEvent ) => {
			e.preventDefault();
			e.stopPropagation();
			if ( restoreWorkspace( d.id ) ) {
				exitOverview( mgr );
			}
		} );
		actions.appendChild( restoreBtn );
	}

	if ( actions.childElementCount > 0 ) {
		wrapper.appendChild( actions );
	}

	return wrapper;
}

function beginRename(
	mgr: WindowManager,
	label: HTMLElement,
	d: Desktop,
): void {
	if ( label.hasAttribute( 'contenteditable' ) ) {
		return;
	}

	label.setAttribute( 'contenteditable', 'true' );
	try {
		label.contentEditable = 'plaintext-only';
	} catch {

	}
	label.spellcheck = false;
	label.focus();

	const view = label.ownerDocument.defaultView;
	const range = label.ownerDocument.createRange();
	range.selectNodeContents( label );
	const selection = view?.getSelection();
	selection?.removeAllRanges();
	selection?.addRange( range );

	let settled = false;
	const finish = ( commit: boolean ): void => {
		if ( settled ) {
			return;
		}
		settled = true;
		label.removeAttribute( 'contenteditable' );
		if ( commit ) {
			renameDesktop( mgr, d.id, label.textContent ?? '' );
		}

		if ( mgr._overviewActive ) {
			refreshOverviewTopBar( mgr );
		}
	};

	label.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
		e.stopPropagation();
		if ( e.key === 'Enter' || e.key === 'Escape' ) {
			e.preventDefault();
			finish( e.key === 'Enter' );
		}
	} );
	label.addEventListener( 'blur', () => finish( true ) );

	label.addEventListener( 'click', ( e: MouseEvent ) => e.stopPropagation() );
}

export function refreshOverviewTopBar( mgr: WindowManager ): void {
	if ( ! mgr._overviewTopBar ) {
		return;
	}
	const fresh = buildOverviewTopBar( mgr );
	mgr._overviewTopBar.replaceWith( fresh );
	mgr._overviewTopBar = fresh;
}

function exitOverviewToDesktop( mgr: WindowManager, desktopId: string ): void {
	switchDesktop( mgr, desktopId );

	exitOverview( mgr );
}

export function createOverviewLabel( item: OverviewLayoutItem ): HTMLElement {
	const label = document.createElement( 'div' );
	label.className = 'os-overview-label';
	label.dataset.windowId = item.win.id;

	const thumbW = item.win.element.offsetWidth * item.scale;
	label.style.left = `${ item.x }px`;
	label.style.top = `${ item.y - 34 }px`;
	label.style.width = `${ thumbW }px`;

	const iconClass = item.win.config.icon || 'dashicons-admin-generic';
	const icon = document.createElement( 'span' );
	icon.className = `os-overview-label__icon dashicons ${ iconClass }`;
	icon.setAttribute( 'aria-hidden', 'true' );
	label.appendChild( icon );

	const title = document.createElement( 'span' );
	title.className = 'os-overview-label__title';
	title.textContent = item.win.config.title;
	label.appendChild( title );

	const tabCount = item.win.getExternalTabCount();
	if ( tabCount > 0 ) {
		const meta = document.createElement( 'span' );
		meta.className = 'os-overview-label__meta';
		meta.textContent = sprintf(

			_n( '· %d open tab', '· %d open tabs', tabCount ),
			tabCount,
		);
		label.appendChild( meta );
	}

	return label;
}

export function exitOverview(
	mgr: WindowManager,
	selected?: Window,
	maximize = false,
): void {
	if ( ! mgr._overviewActive ) {
		return;
	}
	mgr._overviewActive = false;

	mgr._overviewAddTileFocused = false;

	doAction( HOOKS.OVERVIEW_EXITING, {
		windowId: selected ? selected.id : undefined,
		reason: selected ? 'select' : 'cancel',
	} );

	doAction( HOOKS.DOCK_REFRESH_ACTIVE, {} );

	mgr._desktop.classList.remove( 'os-area--overview' );
	const shell = document.getElementById( 'os-shell' );
	shell?.classList.remove( 'os-shell--overview' );

	for ( const id of OVERVIEW_INERT_ELEMENTS ) {
		const el = document.getElementById( id );
		if ( el ) {
			( el as HTMLElement & { inert: boolean } ).inert = false;
		}
	}
	inertWpBodyContentChildren( false );
	inertWindowChildren( mgr, false );

	for ( const [ id, snap ] of mgr._overviewSnapshot ) {
		const w = mgr.getById( id );
		if ( ! w ) {
			continue;
		}
		w.element.style.transform = snap.transform;
	}
	if ( selected ) {
		if ( selected.state === 'minimized' ) {
			restoreOverviewFullscreenState( selected );
			selected.restore();
		}

		mgr.focus( selected );
		if ( maximize ) {
			selected.maximize();
		}
	}

	for ( const w of mgr._stack ) {
		if ( w.state === 'minimized' ) {
			w.element.classList.remove( 'os-window--overview' );
		}
	}

	for ( const label of mgr._overviewLabels.values() ) {
		label.classList.add( 'os-overview-label--out' );
	}

	if ( mgr._overviewTopBar ) {
		mgr._overviewTopBar.classList.add(
			'os-overview-top-bar--out',
		);
	}

	const ANIMATION_MS = 280;
	mgr._overviewExitFinalizer = () => {
		for ( const w of mgr._stack ) {
			w.element.classList.remove( 'os-window--overview' );
			restoreWindowAfterOverviewLayout(
				w,
				w.config.desktopId === mgr._activeDesktopId,
			);
		}
		for ( const label of mgr._overviewLabels.values() ) {
			label.remove();
		}
		mgr._overviewLabels.clear();
		mgr._overviewSnapshot.clear();
		if ( mgr._overviewTopBar ) {
			mgr._overviewTopBar.remove();
			mgr._overviewTopBar = null;
		}

		if ( mgr._overviewClickBlocker ) {
			mgr._desktop.removeEventListener(
				'click',
				mgr._overviewClickBlocker,
				true,
			);
			mgr._overviewClickBlocker = null;
		}
		doAction( HOOKS.OVERVIEW_EXITED, {
			windowId: selected ? selected.id : undefined,
			reason: selected ? 'select' : 'cancel',
		} );
	};
	mgr._overviewExitTimeoutId = window.setTimeout(
		() => flushPendingOverviewExit( mgr ),
		ANIMATION_MS,
	) as unknown as number;

	if ( mgr._overviewPointerDownHandler ) {
		mgr._desktop.removeEventListener(
			'pointerdown',
			mgr._overviewPointerDownHandler,
			true,
		);
		mgr._overviewPointerDownHandler = null;
	}
	if ( mgr._overviewPointerUpHandler ) {
		mgr._desktop.removeEventListener(
			'pointerup',
			mgr._overviewPointerUpHandler,
			true,
		);
		mgr._overviewPointerUpHandler = null;
	}
	mgr._overviewPressTarget = null;
	if ( mgr._overviewKeyHandler ) {
		document.removeEventListener( 'keydown', mgr._overviewKeyHandler );
		mgr._overviewKeyHandler = null;
	}
	if ( mgr._overviewMouseHandler ) {
		mgr._desktop.removeEventListener(
			'mouseover',
			mgr._overviewMouseHandler,
		);
		mgr._overviewMouseHandler = null;
	}

	if ( mgr._lastOverviewHoverId ) {
		doAction( HOOKS.OVERVIEW_WINDOW_UNHOVER, {
			windowId: mgr._lastOverviewHoverId,
		} );
		mgr._lastOverviewHoverId = null;
	}
}
