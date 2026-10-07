import { __, _n, sprintf } from '../i18n';
import { applyFilters, doAction, HOOKS } from '../hooks';
import type { DockItem, SubmenuItem, SystemDockItem } from '../dock';
import type { Window as OsWindow } from '../window';
import { hashTitleToHue } from '../ui/util/hash-hue';
import { deriveWindowId, sanitizeClassName } from '../utils';
import { applyIconMask } from '../desktop-themes/paint-tinted-icon';
import { CONSTELLATION_FLAG } from './active';

import { ITEM_MENU_OPENING_EVENT } from '../item-visibility-menu-events';
import { resolveNativeUrlRemap } from '../native-url-remap';
import {
	openMenuItem,
	openSubmenuItem,
	type ConstellationRouting,
} from './routing';

const SHOW_DELAY_MS = 130;

const HIDE_DELAY_MS = 240;

const EXIT_MS = 160;

const BEAM_GAP_PX = 14;

const BEAM_INSET_PX = 18;

const VIEWPORT_MARGIN_PX = 12;

const MIN_PANEL_HEIGHT_PX = 160;

const OPEN_BODY_CLASS = 'os-constellation-open';

type ConstellationSide = 'top' | 'left' | 'right';

const keyOf = ( tile: HTMLElement ): string =>
	tile.dataset.menuSlug ?? tile.dataset.constellationId ?? '';

const sideFor = ( tile: HTMLElement ): ConstellationSide => {
	const placement = tile
		.closest< HTMLElement >( '.os-dock' )
		?.getAttribute( 'data-os-dock-placement' );
	if ( placement === 'left' ) {
		return 'right';
	}
	if ( placement === 'right' ) {
		return 'left';
	}
	return 'top';
};

const OPEN_KEY: Readonly< Record< ConstellationSide, string > > = {
	top: 'ArrowUp',
	right: 'ArrowRight',
	left: 'ArrowLeft',
};

function prefersReducedMotion(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '( prefers-reduced-motion: reduce )' ).matches
	);
}

export interface DockConstellationDeps extends ConstellationRouting {

	getMenuItems: () => DockItem[];

	getSystemItem?: ( id: string ) => SystemDockItem | null;
}

export interface ConstellationMenu {

	id: string;
	title: string;
	icon: string;
	submenu: SubmenuItem[];
	menuItem: DockItem | null;
}

export interface ConstellationPanelContext {

	item: ConstellationMenu;

	instances: OsWindow[];

	tile: HTMLElement;
}

export function mountDockConstellation(
	deps: DockConstellationDeps,
): () => void {
	let panel: HTMLElement | null = null;
	let anchor: HTMLElement | null = null;
	let anchorSlug = '';
	let showTimer: number | null = null;
	let hideTimer: number | null = null;

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

	const tileFrom = ( target: EventTarget | null ): HTMLElement | null => {
		if ( ! ( target instanceof Element ) ) {
			return null;
		}
		const tile = target.closest< HTMLElement >( '.os-dock__item' );
		if ( ! tile || ! keyOf( tile ) ) {
			return null;
		}
		if ( ! tile.closest( '.os-dock' ) ) {
			return null;
		}
		return tile;
	};

	const closing = new Set< HTMLElement >();

	const syncBodyFlag = (): void => {
		document.body.classList.toggle(
			OPEN_BODY_CLASS,
			panel !== null || closing.size > 0,
		);
	};

	type RetireMode = 'exit' | 'cut';

	const retire = (
		mode: RetireMode,
		opts: { restoreFocus?: boolean; handoff?: boolean } = {},
	): void => {
		if ( ! panel ) {
			return;
		}
		const previousAnchor = anchor;
		const dying = panel;
		panel = null;
		anchor = null;
		anchorSlug = '';
		previousAnchor?.removeAttribute( 'data-constellation-open' );

		if ( mode === 'cut' || prefersReducedMotion() ) {
			dying.remove();
		} else {
			dying.classList.remove( 'os-constellation--open' );

			dying.classList.add( 'os-constellation--closing' );
			closing.add( dying );
			window.setTimeout( () => {
				dying.remove();
				closing.delete( dying );
				syncBodyFlag();
			}, EXIT_MS );
		}
		syncBodyFlag();

		if ( opts.restoreFocus && previousAnchor ) {
			previousAnchor
				.querySelector< HTMLElement >( '.os-dock__item-primary' )
				?.focus();
		}
		doAction( HOOKS.CONSTELLATION_CLOSED, {
			menuSlug: previousAnchor ? keyOf( previousAnchor ) : '',

			handoff: opts.handoff === true,
		} );
	};

	const close = ( restoreFocus = false, immediate = false ): void => {
		cancelShow();
		cancelHide();
		retire( immediate ? 'cut' : 'exit', { restoreFocus } );
	};

	const open = ( tile: HTMLElement, focusFirst = false ): void => {
		cancelShow();
		cancelHide();
		const slug = keyOf( tile );
		if ( panel && anchorSlug === slug ) {
			if ( focusFirst ) {
				focusRow( panel, 0 );
			}
			return;
		}
		const item = resolveMenu( deps, tile );
		if ( ! item ) {
			close();
			return;
		}

		const handingOff = panel !== null;

		retire( 'exit', { handoff: handingOff } );

		const instances = instancesFor( deps, item );
		panel = buildPanel( deps, item, instances, tile, close );

		for ( const row of rowsOf( panel ) ) {
			row.tabIndex = -1;
		}
		anchor = tile;
		anchorSlug = slug;

		panel.dataset.osCnSide = sideFor( tile );
		document.body.appendChild( panel );
		syncBodyFlag();
		tile.setAttribute( 'data-constellation-open', '' );
		inheritShellVars( panel );
		position( panel, tile );

		requestAnimationFrame( () => {
			panel?.classList.add( 'os-constellation--open' );
			if ( focusFirst && panel ) {
				focusRow( panel, 0 );
			}
		} );
		doAction( HOOKS.CONSTELLATION_OPENED, {
			menuSlug: slug,
			item,
			instances,
			handoff: handingOff,
		} );
	};

	const onPointerOver = ( e: PointerEvent ): void => {
		if ( e.pointerType && e.pointerType !== 'mouse' ) {
			return;
		}
		if ( panel && e.target instanceof Node && panel.contains( e.target ) ) {
			cancelHide();
			return;
		}
		const tile = tileFrom( e.target );
		if ( ! tile ) {
			return;
		}
		cancelHide();
		if ( panel && anchorSlug === keyOf( tile ) ) {
			return;
		}
		cancelShow();
		showTimer = window.setTimeout( () => {
			showTimer = null;
			open( tile );
		}, panel ? 0 : SHOW_DELAY_MS );
	};

	const onPointerOut = ( e: PointerEvent ): void => {
		const to = e.relatedTarget;
		const stillInside =
			to instanceof Node &&
			( ( panel && panel.contains( to ) ) ||
				( anchor && anchor.contains( to ) ) ||
				!! tileFrom( to ) );
		if ( stillInside ) {
			return;
		}
		cancelShow();
		cancelHide();
		hideTimer = window.setTimeout( () => {
			hideTimer = null;
			close();
		}, HIDE_DELAY_MS );
	};

	const onKeyDown = ( e: KeyboardEvent ): void => {
		if ( panel && e.target instanceof Node && panel.contains( e.target ) ) {
			const rows = rowsOf( panel );
			const current = rows.indexOf( e.target as HTMLElement );
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				close( true );
			} else if ( e.key === 'ArrowDown' ) {
				e.preventDefault();
				focusRow( panel, current + 1 );
			} else if ( e.key === 'ArrowUp' ) {
				e.preventDefault();

				if ( current <= 0 ) {
					close( true );
				} else {
					focusRow( panel, current - 1 );
				}
			} else if ( e.key === 'Home' ) {
				e.preventDefault();
				focusRow( panel, 0 );
			} else if ( e.key === 'End' ) {
				e.preventDefault();
				focusRow( panel, rows.length - 1 );
			} else if ( e.key === 'Tab' ) {
				close( true );
			}
			return;
		}

		const tile = tileFrom( e.target );
		if ( ! tile ) {
			return;
		}
		if ( e.key === OPEN_KEY[ sideFor( tile ) ] ) {
			e.preventDefault();
			open( tile, true );
		} else if ( e.key === 'Escape' ) {
			close();
		}
	};

	const onInvalidate = (): void => close( false, true );

	const onScroll = ( e: Event ): void => {
		if (
			panel &&
			e.target instanceof Node &&
			panel.contains( e.target )
		) {
			return;
		}
		onInvalidate();
	};

	const onClick = ( e: MouseEvent ): void => {
		if ( ! panel || ! ( e.target instanceof Element ) ) {
			return;
		}
		if ( panel.contains( e.target ) ) {
			return;
		}
		if ( e.target.closest( '.os-dock__item' ) ) {
			close();
		}
	};

	document.body.setAttribute( CONSTELLATION_FLAG, '' );
	document.addEventListener( 'pointerover', onPointerOver );
	document.addEventListener( 'pointerout', onPointerOut );
	document.addEventListener( 'click', onClick );
	document.addEventListener( 'keydown', onKeyDown );
	window.addEventListener( 'resize', onInvalidate );
	window.addEventListener( 'blur', onInvalidate );
	document.addEventListener( 'os-layout-changed', onInvalidate );

	document.addEventListener( ITEM_MENU_OPENING_EVENT, onInvalidate );

	document.addEventListener( 'scroll', onScroll, true );

	return (): void => {
		close( false, true );

		for ( const ghost of closing ) {
			ghost.remove();
		}
		closing.clear();
		syncBodyFlag();
		document.body.removeAttribute( CONSTELLATION_FLAG );
		document.removeEventListener( ITEM_MENU_OPENING_EVENT, onInvalidate );
		document.removeEventListener( 'pointerover', onPointerOver );
		document.removeEventListener( 'pointerout', onPointerOut );
		document.removeEventListener( 'click', onClick );
		document.removeEventListener( 'keydown', onKeyDown );
		window.removeEventListener( 'resize', onInvalidate );
		window.removeEventListener( 'blur', onInvalidate );
		document.removeEventListener( 'os-layout-changed', onInvalidate );
		document.removeEventListener( 'scroll', onScroll, true );
	};
}

function resolveMenu(
	deps: DockConstellationDeps,
	tile: HTMLElement,
): ConstellationMenu | null {
	const slug = tile.dataset.menuSlug;
	if ( slug ) {
		const item = deps.getMenuItems().find( ( i ) => i.id === slug );
		if ( ! item ) {
			return null;
		}

		const submenu = item.selfLabel
			? [ { title: item.selfLabel, url: item.url }, ...item.submenu ]
			: item.submenu;
		return {
			id: item.id,
			title: item.title,
			icon: item.icon,
			submenu,
			menuItem: item,
		};
	}

	const id = tile.dataset.constellationId;
	if ( ! id ) {
		return null;
	}
	const sys = deps.getSystemItem?.( id );
	if ( ! sys?.submenu?.length ) {
		return null;
	}
	return {
		id: sys.id,
		title: sys.title,
		icon: sys.icon,
		submenu: sys.submenu,
		menuItem: null,
	};
}

function instancesFor(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
): OsWindow[] {
	const seen = new Set< OsWindow >();

	if ( item.menuItem ) {
		const baseId = resolveBaseId( deps, item.menuItem );
		for ( const win of deps.windowManager.getAllByBaseIdOnActiveDesktop(
			baseId,
		) ) {
			seen.add( win );
		}

		const parentKey = deriveWindowId( item.menuItem.url, deps.adminUrl );
		if ( parentKey ) {
			const activeDesktop = deps.windowManager.getActiveDesktopId();
			for ( const win of deps.windowManager.getAll() ) {
				if (
					( win.config.desktopId || activeDesktop ) !== activeDesktop
				) {
					continue;
				}
				if (
					win.config.parentUrl &&
					deriveWindowId( win.config.parentUrl, deps.adminUrl ) ===
						parentKey
				) {
					seen.add( win );
				}
			}
		}
		return Array.from( seen );
	}

	for ( const sub of item.submenu ) {
		if ( ! sub.windowId ) {
			continue;
		}
		for ( const win of deps.windowManager.getAllByBaseIdOnActiveDesktop(
			sub.windowId,
		) ) {
			seen.add( win );
		}
	}
	return Array.from( seen );
}

function resolveBaseId(
	deps: DockConstellationDeps,
	item: DockItem,
): string {
	if ( item.windowId ) {
		return item.windowId;
	}

	return (
		resolveNativeUrlRemap( item.url ) ??
		deriveWindowId( item.url, deps.adminUrl )
	);
}

function buildPanel(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
	instances: OsWindow[],
	tile: HTMLElement,
	dismiss: () => void,
): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'os-constellation';
	root.setAttribute( 'role', 'menu' );
	root.setAttribute(
		'aria-label',
		sprintf(

			__( '%s menu' ),
			item.title,
		),
	);

	root.style.setProperty( '--os-cn-hue', String( hashTitleToHue( item.title ) ) );

	const surface = document.createElement( 'div' );
	surface.className = 'os-constellation__surface';
	root.appendChild( surface );

	surface.appendChild( buildHead( deps, item, dismiss ) );

	let rowIndex = 0;
	const nextIndex = (): number => rowIndex++;

	if ( instances.length > 0 ) {
		surface.appendChild(
			buildInstancesGroup( deps, item, instances, dismiss, nextIndex ),
		);
	}

	if ( item.submenu.length > 0 ) {
		surface.appendChild(
			buildSubmenuGroup( deps, item, dismiss, nextIndex ),
		);
	}

	surface.addEventListener( 'pointermove', ( e: PointerEvent ) => {
		const rect = surface.getBoundingClientRect();
		if ( ! rect.width || ! rect.height ) {
			return;
		}
		surface.style.setProperty(
			'--os-cn-x',
			`${ ( ( e.clientX - rect.left ) / rect.width ) * 100 }%`,
		);
		surface.style.setProperty(
			'--os-cn-y',
			`${ ( ( e.clientY - rect.top ) / rect.height ) * 100 }%`,
		);
	} );

	const sheen = document.createElement( 'span' );
	sheen.className = 'os-constellation__sheen';
	sheen.setAttribute( 'aria-hidden', 'true' );
	root.appendChild( sheen );

	const beam = document.createElement( 'span' );
	beam.className = 'os-constellation__beam';
	beam.setAttribute( 'aria-hidden', 'true' );
	root.appendChild( beam );

	const ctx: ConstellationPanelContext = { item, instances, tile };
	return applyFilters< HTMLElement, [ ConstellationPanelContext ] >(
		HOOKS.CONSTELLATION_PANEL,
		root,
		ctx,
	);
}

function buildHead(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
	dismiss: () => void,
): HTMLElement {
	const head = document.createElement( 'button' );
	head.type = 'button';
	head.className = 'os-constellation__head os-constellation__row';
	head.setAttribute( 'role', 'menuitem' );

	const iconHost = document.createElement( 'span' );
	iconHost.className = 'os-constellation__head-icon';
	iconHost.setAttribute( 'aria-hidden', 'true' );
	iconHost.appendChild( glyph( item.icon ) );
	head.appendChild( iconHost );

	const text = document.createElement( 'span' );
	text.className = 'os-constellation__head-text';
	const title = document.createElement( 'span' );
	title.className = 'os-constellation__head-title';
	title.textContent = item.title;
	text.appendChild( title );
	head.appendChild( text );

	head.addEventListener( 'click', ( event ) => {
		dismiss();
		if ( item.menuItem ) {
			openMenuItem( deps, item.menuItem );
			return;
		}

		runRow( deps, item, item.submenu[ 0 ], event );
	} );

	return head;
}

function runRow(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
	sub: SubmenuItem | undefined,
	event?: MouseEvent,
): void {
	if ( ! sub ) {
		return;
	}
	if ( sub.onSelect ) {
		sub.onSelect( event );
		return;
	}
	if ( item.menuItem ) {
		openSubmenuItem( deps, item.menuItem, sub );
		return;
	}
	if ( sub.url ) {
		window.open( sub.url, '_blank', 'noopener,noreferrer' );
	}
}

function buildInstancesGroup(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
	instances: OsWindow[],
	dismiss: () => void,
	nextIndex: () => number,
): HTMLElement {
	const group = document.createElement( 'div' );
	group.className =
		'os-constellation__group os-constellation__group--live';
	group.setAttribute( 'role', 'group' );
	group.setAttribute( 'aria-label', __( 'Open windows' ) );
	group.appendChild(
		legend(
			sprintf(

				_n( '%d open window', '%d open windows', instances.length ),
				instances.length,
			),
		),
	);

	for ( const win of instances ) {
		const row = document.createElement( 'button' );
		row.type = 'button';
		row.className =
			'os-constellation__row os-constellation__row--live';
		row.setAttribute( 'role', 'menuitem' );
		row.style.setProperty( '--os-cn-row', String( nextIndex() ) );
		if ( win.state === 'minimized' ) {
			row.dataset.state = 'minimized';
		}

		const pip = document.createElement( 'span' );
		pip.className = 'os-constellation__pip';
		pip.setAttribute( 'aria-hidden', 'true' );
		row.appendChild( pip );

		const label = document.createElement( 'span' );
		label.className = 'os-constellation__row-label';
		label.textContent = win.config.title || item.title;
		row.appendChild( label );

		const state = document.createElement( 'span' );
		state.className = 'os-constellation__row-meta';
		state.textContent =
			win.state === 'minimized' ? __( 'Minimized' ) : __( 'Open' );
		row.appendChild( state );

		row.addEventListener( 'click', () => {
			dismiss();
			if ( win.state === 'minimized' ) {
				win.restore();
			}
			deps.windowManager.focus( win );
		} );

		group.appendChild( row );
	}
	return group;
}

function buildSubmenuGroup(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
	dismiss: () => void,
	nextIndex: () => number,
): HTMLElement {
	const group = document.createElement( 'div' );
	group.className = 'os-constellation__group';
	group.setAttribute( 'role', 'group' );
	group.setAttribute( 'aria-label', item.title );
	group.appendChild( legend( __( 'Open' ) ) );

	for ( const sub of item.submenu ) {
		group.appendChild(
			buildSubmenuRow( deps, item, sub, dismiss, nextIndex() ),
		);
	}
	return group;
}

function buildSubmenuRow(
	deps: DockConstellationDeps,
	item: ConstellationMenu,
	sub: SubmenuItem,
	dismiss: () => void,
	index: number,
): HTMLElement {
	const row = document.createElement( 'button' );
	row.type = 'button';
	row.className = 'os-constellation__row os-constellation__row--sub';
	row.setAttribute( 'role', 'menuitem' );
	row.style.setProperty( '--os-cn-row', String( index ) );

	row.style.setProperty(
		'--os-cn-row-hue',
		String( hashTitleToHue( sub.title ) ),
	);

	const orbit = document.createElement( 'span' );
	orbit.className = 'os-constellation__orbit';
	orbit.setAttribute( 'aria-hidden', 'true' );
	row.appendChild( orbit );

	const label = document.createElement( 'span' );
	label.className = 'os-constellation__row-label';
	label.textContent = sub.title;
	row.appendChild( label );

	if ( sub.offSite ) {
		const mark = document.createElement( 'span' );
		mark.className = 'dashicons dashicons-external os-constellation__row-offsite';
		mark.setAttribute( 'aria-hidden', 'true' );
		row.appendChild( mark );

		const note = document.createElement( 'span' );
		note.className = 'os-constellation__row-note';
		note.textContent = __( '(opens in a new tab)' );
		row.appendChild( note );
	}

	row.addEventListener( 'click', ( event ) => {
		dismiss();
		runRow( deps, item, sub, event );
	} );

	return row;
}

function legend( text: string ): HTMLElement {
	const el = document.createElement( 'span' );
	el.className = 'os-constellation__legend';
	el.textContent = text;
	return el;
}

function glyph( icon: string ): HTMLElement {
	if ( ! icon.startsWith( 'dashicons-' ) ) {
		const masked = document.createElement( 'span' );
		masked.className = 'os-constellation__head-art';
		if ( applyIconMask( masked, icon, 'currentColor' ) ) {
			return masked;
		}
	}

	const el = document.createElement( 'span' );
	el.className = 'dashicons';
	el.classList.add(
		icon.startsWith( 'dashicons-' )
			? sanitizeClassName( icon )
			: 'dashicons-admin-generic',
	);
	return el;
}

function rowsOf( panel: HTMLElement ): HTMLElement[] {
	return Array.from(
		panel.querySelectorAll< HTMLElement >( '.os-constellation__row' ),
	);
}

function focusRow( panel: HTMLElement, index: number ): void {
	const rows = rowsOf( panel );
	if ( rows.length === 0 ) {
		return;
	}
	const clamped = Math.max( 0, Math.min( rows.length - 1, index ) );
	rows[ clamped ].focus();
}

const SHELL_VARS = [
	'--wp-admin-theme-color',
	'--os-titlebar-bg-focused',
	'--os-titlebar-color-focused',
] as const;

function inheritShellVars( panel: HTMLElement ): void {
	const shell = document.querySelector< HTMLElement >( '.os-shell' );
	if ( ! shell ) {
		return;
	}
	const computed = window.getComputedStyle( shell );
	for ( const name of SHELL_VARS ) {
		const value = computed.getPropertyValue( name ).trim();
		if ( value ) {
			panel.style.setProperty( name, value );
		}
	}
}

function position( panel: HTMLElement, tile: HTMLElement ): void {
	const rect = tile.getBoundingClientRect();

	const side = sideFor( tile );

	const available =
		side === 'top'
			? rect.top - BEAM_GAP_PX - VIEWPORT_MARGIN_PX
			: window.innerHeight - VIEWPORT_MARGIN_PX * 2;
	panel.style.setProperty(
		'--os-cn-max-h',
		`${ Math.max( MIN_PANEL_HEIGHT_PX, available ) }px`,
	);

	if ( side !== 'top' ) {
		panel.style.left =
			side === 'right'
				? `${ rect.right + BEAM_GAP_PX }px`
				: `${ rect.left - BEAM_GAP_PX }px`;

		const height = panel.offsetHeight;
		const vh = window.innerHeight;
		const top = Math.max(
			VIEWPORT_MARGIN_PX,
			Math.min( rect.top, vh - VIEWPORT_MARGIN_PX - height ),
		);
		panel.style.top = `${ top }px`;

		const beamY = Math.max(
			BEAM_INSET_PX,
			Math.min(
				rect.top + rect.height / 2 - top,
				height - BEAM_INSET_PX,
			),
		);
		panel.style.setProperty( '--os-cn-beam-y', `${ beamY }px` );
		return;
	}

	panel.style.left = `${ rect.left + rect.width / 2 }px`;
	panel.style.top = `${ rect.top - BEAM_GAP_PX }px`;

	requestAnimationFrame( () => {
		const panelRect = panel.getBoundingClientRect();
		const vw = window.innerWidth;
		let dx = 0;
		if ( panelRect.left < VIEWPORT_MARGIN_PX ) {
			dx = VIEWPORT_MARGIN_PX - panelRect.left;
		} else if ( panelRect.right > vw - VIEWPORT_MARGIN_PX ) {
			dx = vw - VIEWPORT_MARGIN_PX - panelRect.right;
		}
		if ( dx !== 0 ) {
			panel.style.setProperty( '--os-cn-shift', `${ dx }px` );
			panel.style.setProperty( '--os-cn-beam-x', `${ -dx }px` );
		}
	} );
}
