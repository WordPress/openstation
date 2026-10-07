import { __, sprintf } from '../i18n';
import type { WindowManager } from '../window-manager';
import type { Window as WPWindow } from '../window';
import type { DockOrientation } from '../dock';
import { sanitizeClassName } from '../utils';
import { hashTitleToHue } from '../ui/util/hash-hue';
import { isConstellationMounted } from '../dock-constellation/active';

import { ITEM_MENU_OPENING_EVENT } from '../item-visibility-menu-events';
import { applyFilters, HOOKS } from '../hooks';

export interface DockPeekCardContext {

	window: WPWindow;

	item: { id: string; title: string; icon: string; url: string };
}

export interface DockPeekDeps {
	tile: HTMLElement;
	item: {
		id: string;
		title: string;
		icon: string;
		url: string;
	};

	getInstances: () => WPWindow[];

	enableGhost?: boolean;
	windowManager: WindowManager;
	getOrientation: () => DockOrientation;

	openNew: () => void;

	suppressTooltip: ( on: boolean ) => void;
}

const SHOW_DELAY_MS = 180;

const HIDE_DELAY_MS = 220;

const STAGGER_MS = 32;

interface PreviewEntry {

	wasMinimized: boolean;

	previouslyFocusedId: string | null;
}

export function attachDockPeek( deps: DockPeekDeps ): () => void {
	const { tile } = deps;

	let popover: HTMLElement | null = null;
	let showTimer: number | null = null;
	let hideTimer: number | null = null;
	let inside = false;

	let previewByWindowId: Map< string, PreviewEntry > | null = null;

	const cancelShow = (): void => {
		if ( showTimer !== null ) {
			window.clearTimeout( showTimer );
			showTimer = null;
		}
	};
	const cancelHide = (): void => {
		if ( hideTimer !== null ) {
			window.clearTimeout( hideTimer );
			hideTimer = null;
		}
	};

	const tearDown = (): void => {
		cancelShow();
		cancelHide();
		tile.removeAttribute( 'data-peek-active' );
		if ( popover ) {
			popover.remove();
			popover = null;
		}
		previewByWindowId?.clear();
		previewByWindowId = null;
		deps.suppressTooltip( false );
	};

	const onPointerEnterTile = ( e: PointerEvent ): void => {
		if ( e.pointerType !== 'mouse' ) {
			return;
		}

		if (
			isConstellationMounted() &&
			( tile.dataset.menuSlug || tile.dataset.constellationId )
		) {
			return;
		}

		if ( ! shouldShowPeek( deps ) ) {
			return;
		}
		inside = true;
		cancelHide();
		if ( popover ) {
			return;
		}
		showTimer = window.setTimeout( () => {
			showTimer = null;
			if ( ! inside ) {
				return;
			}
			showPeek();
		}, SHOW_DELAY_MS );
	};

	const onPointerLeaveTile = ( e: PointerEvent ): void => {
		if ( popover && e.relatedTarget instanceof Node && popover.contains( e.relatedTarget ) ) {
			return;
		}
		inside = false;
		cancelShow();
		scheduleHide();
	};

	const scheduleHide = (): void => {
		cancelHide();
		hideTimer = window.setTimeout( () => {
			hideTimer = null;
			if ( inside ) {
				return;
			}
			tearDown();
		}, HIDE_DELAY_MS );
	};

	const showPeek = (): void => {
		deps.suppressTooltip( true );
		tile.setAttribute( 'data-peek-active', '' );
		previewByWindowId = new Map();
		popover = buildPopover( deps, () => tearDown(), previewByWindowId );
		document.body.appendChild( popover );

		inheritShellSchemeVars( popover );
		positionPopover( popover, tile, deps.getOrientation() );

		requestAnimationFrame( () => {
			popover?.classList.add( 'os-dock-peek--open' );
		} );

		popover.addEventListener( 'pointerenter', () => {
			inside = true;
			cancelHide();
		} );
		popover.addEventListener( 'pointerleave', ( e: PointerEvent ) => {
			if ( e.relatedTarget instanceof Node && tile.contains( e.relatedTarget ) ) {
				return;
			}
			inside = false;
			scheduleHide();
		} );
	};

	const onMenuOpening = (): void => tearDown();

	tile.addEventListener( 'pointerenter', onPointerEnterTile );
	tile.addEventListener( 'pointerleave', onPointerLeaveTile );
	document.addEventListener( ITEM_MENU_OPENING_EVENT, onMenuOpening );

	return (): void => {
		tile.removeEventListener( 'pointerenter', onPointerEnterTile );
		tile.removeEventListener( 'pointerleave', onPointerLeaveTile );
		document.removeEventListener(
			ITEM_MENU_OPENING_EVENT,
			onMenuOpening,
		);
		tearDown();
	};
}

function shouldShowPeek( deps: DockPeekDeps ): boolean {
	return deps.getInstances().length >= 1;
}

function buildPopover(
	deps: DockPeekDeps,
	dismiss: () => void,
	previewByWindowId: Map< string, PreviewEntry >,
): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'os-dock-peek';
	root.setAttribute( 'role', 'menu' );
	root.setAttribute( 'aria-label', sprintf(

		__( '%s — open windows' ),
		deps.item.title,
	) );

	const cards = document.createElement( 'div' );
	cards.className = 'os-dock-peek__cards';
	root.appendChild( cards );

	const instances = deps.getInstances();
	let cardIndex = 0;
	for ( const win of instances ) {
		const card = buildInstanceCard( win, deps, cardIndex++, dismiss, previewByWindowId );
		cards.appendChild( card );
	}

	if ( deps.enableGhost !== false ) {
		const ghost = buildGhostCard( deps, cardIndex, dismiss );
		cards.appendChild( ghost );
	}

	return root;
}

function restoreIfMinimized( win: WPWindow, card?: HTMLElement ): void {
	if ( win.state !== 'minimized' ) {
		return;
	}
	win.restore();
	if ( card ) {
		delete card.dataset.state;
	}
}

function buildInstanceCard(
	win: WPWindow,
	deps: DockPeekDeps,
	index: number,
	dismiss: () => void,
	previewByWindowId: Map< string, PreviewEntry >,
): HTMLElement {
	const card = document.createElement( 'button' );
	card.type = 'button';
	card.setAttribute( 'role', 'menuitem' );
	card.className =
		'os-dock-peek__card os-dock-peek__card--instance';
	card.style.setProperty( '--peek-card-index', String( index ) );
	card.style.setProperty(
		'--peek-card-delay',
		`${ index * STAGGER_MS }ms`,
	);
	const title = win.config.title || deps.item.title;
	card.style.setProperty(
		'--peek-card-hue',
		`${ hashTitleToHue( win.id || title ) }`,
	);

	card.style.setProperty(
		'--peek-card-vt-name',
		`os-peek-card-${ win.id }`,
	);

	const titlebar = document.createElement( 'span' );
	titlebar.className = 'os-dock-peek__card-titlebar';

	const dots = document.createElement( 'span' );
	dots.className = 'os-dock-peek__card-dots';
	dots.setAttribute( 'aria-hidden', 'true' );
	for ( let i = 0; i < 3; i++ ) {
		dots.appendChild( document.createElement( 'i' ) );
	}
	titlebar.appendChild( dots );

	const iconHost = document.createElement( 'span' );
	iconHost.className = 'os-dock-peek__card-icon';
	iconHost.setAttribute( 'aria-hidden', 'true' );
	const iconCls = win.config.icon || deps.item.icon;
	if ( iconCls.startsWith( 'dashicons-' ) ) {
		iconHost.classList.add( 'dashicons', sanitizeClassName( iconCls ) );
	} else {
		iconHost.classList.add( 'dashicons', 'dashicons-admin-generic' );
	}
	titlebar.appendChild( iconHost );

	const label = document.createElement( 'span' );
	label.className = 'os-dock-peek__card-label';
	label.textContent = title;
	titlebar.appendChild( label );

	card.appendChild( titlebar );

	const defaultBody = document.createElement( 'span' );
	defaultBody.className = 'os-dock-peek__card-body';
	defaultBody.setAttribute( 'aria-hidden', 'true' );
	for ( let i = 0; i < 3; i++ ) {
		const line = document.createElement( 'span' );
		line.className = 'os-dock-peek__card-line';
		defaultBody.appendChild( line );
	}
	const ctx: DockPeekCardContext = { window: win, item: deps.item };
	const body = applyFilters< HTMLElement, [ DockPeekCardContext ] >(
		HOOKS.DOCK_PEEK_CARD_CONTENT,
		defaultBody,
		ctx,
	);

	if ( body !== defaultBody ) {
		body.classList.add( 'os-dock-peek__card-body--custom' );
	}
	card.appendChild( body );

	if ( win.state === 'minimized' ) {
		card.dataset.state = 'minimized';
	}

	const commitPreview = (): void => {
		previewByWindowId.delete( win.id );
		delete card.dataset.preview;
	};

	const revertPreview = ( entry: PreviewEntry ): void => {
		commitPreview();
		if ( entry.wasMinimized ) {
			win.minimize();
			card.dataset.state = 'minimized';
		} else if ( entry.previouslyFocusedId ) {
			const prevWin = deps.windowManager.getById( entry.previouslyFocusedId );
			if ( prevWin ) {
				deps.windowManager.focus( prevWin );
			}
		}
	};

	card.addEventListener( 'click', () => {
		commitPreview();
		spawnFocusViewTransition( deps, win, card, dismiss );
	} );

	card.addEventListener( 'pointerenter', () => {
		if ( previewByWindowId.has( win.id ) ) {
			return;
		}

		const wasMinimized = win.state === 'minimized';
		const previouslyFocused = deps.windowManager.getFocused();
		const previouslyFocusedId: string | null =
			previouslyFocused && previouslyFocused !== win
				? previouslyFocused.id
				: null;

		if ( wasMinimized || previouslyFocusedId !== null ) {
			previewByWindowId.set( win.id, {
				wasMinimized,
				previouslyFocusedId,
			} );
			card.dataset.preview = '';
		}

		if ( wasMinimized ) {
			restoreIfMinimized( win, card );
		} else if ( previouslyFocused && previouslyFocused !== win ) {
			deps.windowManager.focus( win );
		}
	} );

	card.addEventListener( 'pointerleave', () => {
		const entry = previewByWindowId.get( win.id );
		if ( entry ) {
			revertPreview( entry );
		}
	} );

	const finalCard = applyFilters< HTMLElement, [ DockPeekCardContext ] >(
		HOOKS.DOCK_PEEK_CARD_ELEMENT,
		card,
		ctx,
	);

	return finalCard;
}

function spawnFocusViewTransition(
	deps: DockPeekDeps,
	win: WPWindow,
	card: HTMLElement,
	dismiss: () => void,
): void {
	const doc = document as Document & {
		startViewTransition?: ( cb: () => void ) => unknown;
	};
	const vtName = `os-peek-card-${ win.id }`;
	const focus = (): void => {
		dismiss();
		restoreIfMinimized( win, card );
		deps.windowManager.focus( win );
	};
	if ( typeof doc.startViewTransition !== 'function' ) {
		focus();
		return;
	}

	const targetEl = win.element;
	card.style.setProperty( 'view-transition-name', vtName );
	targetEl.style.setProperty( 'view-transition-name', vtName );
	const transition = doc.startViewTransition( focus );
	const cleanup = (): void => {
		card.style.removeProperty( 'view-transition-name' );
		targetEl.style.removeProperty( 'view-transition-name' );
	};
	const t = transition as { finished?: Promise< void > };
	if ( t.finished && typeof t.finished.then === 'function' ) {
		t.finished.then( cleanup, cleanup );
	} else {
		Promise.resolve().then( cleanup );
	}
}

function buildGhostCard(
	deps: DockPeekDeps,
	index: number,
	dismiss: () => void,
): HTMLElement {
	const card = document.createElement( 'button' );
	card.type = 'button';
	card.setAttribute( 'role', 'menuitem' );
	card.className =
		'os-dock-peek__card os-dock-peek__card--ghost';
	card.style.setProperty( '--peek-card-index', String( index ) );
	card.style.setProperty(
		'--peek-card-delay',
		`${ index * STAGGER_MS }ms`,
	);

	const plus = document.createElement( 'span' );
	plus.className = 'os-dock-peek__card-plus';
	plus.setAttribute( 'aria-hidden', 'true' );
	plus.textContent = '+';
	card.appendChild( plus );

	const label = document.createElement( 'span' );
	label.className = 'os-dock-peek__card-label';
	label.textContent = sprintf(

		__( 'New %s' ),
		deps.item.title,
	);
	card.appendChild( label );

	card.addEventListener( 'click', () => {
		spawnWithViewTransition( deps, dismiss );
	} );

	return card;
}

function spawnWithViewTransition(
	deps: DockPeekDeps,
	dismiss: () => void,
): void {
	const doc = document as Document & {
		startViewTransition?: ( cb: () => void ) => unknown;
	};
	const spawn = (): void => {
		dismiss();
		deps.openNew();
	};
	if ( typeof doc.startViewTransition === 'function' ) {
		doc.startViewTransition( spawn );
		return;
	}
	spawn();
}

const VIEWPORT_MARGIN_PX = 12;

const SHELL_SCHEME_VARS = [
	'--wp-admin-theme-color',
	'--os-titlebar-bg',
	'--os-titlebar-bg-focused',
	'--os-titlebar-color',
	'--os-titlebar-color-focused',
] as const;

function inheritShellSchemeVars( popover: HTMLElement ): void {
	const shell = document.querySelector< HTMLElement >( '.os-shell' );
	if ( ! shell ) {
		return;
	}
	const computed = window.getComputedStyle( shell );
	for ( const name of SHELL_SCHEME_VARS ) {
		const value = computed.getPropertyValue( name ).trim();
		if ( value ) {
			popover.style.setProperty( name, value );
		}
	}
}

function positionPopover(
	popover: HTMLElement,
	tile: HTMLElement,
	orientation: DockOrientation,
): void {
	const rect = tile.getBoundingClientRect();
	popover.dataset.orientation = orientation;
	if ( orientation === 'bottom' ) {
		popover.style.left = `${ rect.left + rect.width / 2 }px`;
		popover.style.top = `${ rect.top - 12 }px`;
	} else if ( orientation === 'right' ) {
		popover.style.top = `${ rect.top }px`;
		popover.style.left = `${ rect.left - 12 }px`;
	} else {
		popover.style.top = `${ rect.top }px`;
		popover.style.left = `${ rect.right + 12 }px`;
	}

	requestAnimationFrame( () => clampToViewport( popover, orientation ) );
}

function clampToViewport(
	popover: HTMLElement,
	orientation: DockOrientation,
): void {
	const rect = popover.getBoundingClientRect();
	const vh = window.innerHeight;
	const vw = window.innerWidth;
	const min = VIEWPORT_MARGIN_PX;

	let dy = 0;
	let dx = 0;

	if ( rect.top < min ) {
		dy = min - rect.top;
	} else if ( rect.bottom > vh - min ) {
		dy = vh - min - rect.bottom;
	}
	if ( rect.left < min ) {
		dx = min - rect.left;
	} else if ( rect.right > vw - min ) {
		dx = vw - min - rect.right;
	}

	if ( dx === 0 && dy === 0 ) {
		return;
	}

	popover.style.setProperty( '--peek-clamp-x', `${ dx }px` );
	popover.style.setProperty( '--peek-clamp-y', `${ dy }px` );
	popover.classList.add( 'os-dock-peek--clamped' );

	void orientation;
}
