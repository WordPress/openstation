/**
 * Taskbar dock rail renderer.
 *
 * The other way to run a desktop: one bar along the bottom edge with a
 * Start button that opens every admin menu as a cascading menu, a
 * button for each open window (pressed while that window is in front,
 * click to bring it forward or put it away), and a tray with the
 * station's own controls and a clock.
 *
 * It paints only the bottom rail. On a side placement it hands the
 * rail to the default icon strip, because a column of window buttons
 * cut to a sidebar's width cannot show a title.
 *
 * Every colour and bevel reads a token (`--os-taskbar-*`, falling back
 * to the dock's own), so a desktop theme decides what the bar looks
 * like and recommends the renderer through `dockRailRenderer`.
 */

import { __ } from '../i18n';
import { addAction, HOOKS, removeAction } from '../hooks';
import { renderIcon } from '../icon';
import { slotForTileId } from '../desktop-themes/slots';
import { runClock } from '../ui/util/run-clock';
import { defaultDockRailRenderer } from './default-renderer';
import type {
	DockEntry,
	DockItem,
	DockZones,
	SubmenuItem,
	SystemDockItem,
} from '../dock';
import type { Window as DesktopWindow } from '../window';
import type {
	DockRailController,
	DockRailMountDeps,
	DockRailRenderer,
} from './types';

/** Hooks that change which window buttons show, or how. */
const WINDOW_HOOKS = [
	HOOKS.WINDOW_OPENED,
	HOOKS.WINDOW_REOPENED,
	HOOKS.WINDOW_CLOSED,
	HOOKS.WINDOW_FOCUSED,
	HOOKS.WINDOW_BLURRED,
	HOOKS.WINDOW_MINIMIZED,
	HOOKS.WINDOW_RESTORED,
	HOOKS.WINDOW_TITLE_CHANGED,
	HOOKS.DESKTOP_SWITCHED,
	HOOKS.WINDOW_DESKTOP_CHANGED,
];

let mountCount = 0;

function el< K extends keyof HTMLElementTagNameMap >(
	tag: K,
	className: string,
): HTMLElementTagNameMap[ K ] {
	const node = document.createElement( tag );
	node.className = className;
	return node;
}

function icon( value: string, title: string, slotId: string ): HTMLElement {
	return renderIcon( value || 'dashicons-admin-generic', {
		title,
		className: 'os-taskbar__icon',
		slot: slotForTileId( slotId ),
	} );
}

class Taskbar {
	private readonly deps: DockRailMountDeps;
	private readonly root: HTMLElement;
	private readonly start: HTMLButtonElement;
	private readonly tasks: HTMLElement;
	private readonly trayItems: HTMLElement;
	private readonly clock: HTMLTimeElement;
	private readonly menu: HTMLElement;
	private readonly namespace: string;
	private menuEntries: DockEntry[] = [];
	private trayEntries: SystemDockItem[] = [];
	private stopClock: () => void = () => undefined;
	private openOrder: string[] = [];
	private readonly onDocPointer = ( event: PointerEvent ): void => {
		const target = event.target as Node | null;
		if (
			target &&
			! this.menu.contains( target ) &&
			! this.start.contains( target )
		) {
			this.closeMenu();
		}
	};

	constructor( deps: DockRailMountDeps ) {
		this.deps = deps;
		this.namespace = `openstation/taskbar-${ ++mountCount }`;

		this.root = el( 'div', 'os-taskbar' );

		this.start = el( 'button', 'os-taskbar__start' );
		this.start.type = 'button';
		this.start.setAttribute( 'aria-haspopup', 'menu' );
		this.start.setAttribute( 'aria-expanded', 'false' );
		this.start.appendChild( icon( 'dashicons-wordpress', __( 'Start' ), 'os-taskbar-start' ) );
		const startLabel = el( 'span', 'os-taskbar__start-label' );
		startLabel.textContent = __( 'Start' );
		this.start.appendChild( startLabel );
		this.start.addEventListener( 'click', () => this.toggleMenu() );

		this.tasks = el( 'div', 'os-taskbar__tasks' );
		this.tasks.setAttribute( 'role', 'toolbar' );
		this.tasks.setAttribute( 'aria-label', __( 'Open windows' ) );

		const tray = el( 'div', 'os-taskbar__tray' );
		this.trayItems = el( 'div', 'os-taskbar__tray-items' );
		this.clock = el( 'time', 'os-taskbar__clock' );
		tray.append( this.trayItems, this.clock );

		this.menu = el( 'div', 'os-taskbar__menu' );
		this.menu.setAttribute( 'role', 'menu' );
		this.menu.hidden = true;
		this.menu.addEventListener( 'keydown', ( event ) => this.onMenuKey( event ) );

		this.root.append( this.start, this.tasks, tray );
		// The rail's placement attribute is the renderer's to stamp, as
		// the default icon strip does; the dock sheet positions the rail
		// from it.
		deps.container.setAttribute( 'data-os-dock-placement', deps.orientation );
		deps.container.setAttribute( 'data-os-dock-renderer', 'taskbar' );
		deps.container.append( this.root, this.menu );

		for ( const hook of WINDOW_HOOKS ) {
			addAction( hook, this.namespace, () => this.paintTasks() );
		}
		this.paintTasks();
		this.stopClock = runClock( this.clock );
	}

	public controller(): DockRailController {
		return {
			replaceItems: ( items ) => {
				this.menuEntries = items.map( ( item ) => ( {
					type: 'menu' as const,
					item,
				} ) );
			},
			setZones: ( zones ) => this.setZones( zones ),
			appendSystemItem: ( item ) => {
				this.trayEntries = [
					...this.trayEntries.filter( ( t ) => t.id !== item.id ),
					item,
				];
				this.paintTray();
			},
			removeSystemItem: ( id ) => {
				this.trayEntries = this.trayEntries.filter( ( t ) => t.id !== id );
				this.paintTray();
			},
			destroy: () => this.destroy(),
		};
	}

	/**
	 * Menus and launchers go in the Start menu; the station's own
	 * controls go in the tray, where their icons stay one click away.
	 */
	private setZones( zones: DockZones ): void {
		this.menuEntries = [ ...zones.core, ...zones.apps ];
		this.trayEntries = zones.controls
			.filter( ( e ) => e.type === 'system' )
			.map( ( e ) => e.item as SystemDockItem );
		this.paintTray();
	}

	/**
	 * The windows on this desk, in the order they opened. The window
	 * manager lists them in stacking order, which changes on every
	 * focus, so a button would move out from under the pointer when
	 * clicked.
	 */
	private windows(): DesktopWindow[] {
		const wm = this.deps.windowManager;
		const desk = wm.getActiveDesktopId();
		const all = wm.getAll();
		const open = new Set( all.map( ( w ) => w.id ) );
		this.openOrder = this.openOrder.filter( ( id ) => open.has( id ) );
		for ( const w of all ) {
			if ( ! this.openOrder.includes( w.id ) ) {
				this.openOrder.push( w.id );
			}
		}
		return all
			.filter( ( w ) => ! w.config.desktopId || w.config.desktopId === desk )
			.sort( ( a, b ) => this.openOrder.indexOf( a.id ) - this.openOrder.indexOf( b.id ) );
	}

	private paintTasks(): void {
		const wm = this.deps.windowManager;
		const buttons = this.windows().map( ( win ) => {
			const button = el( 'button', 'os-taskbar__task' );
			button.type = 'button';
			const front = win.isFocused() && ! win.isMinimized();
			button.classList.toggle( 'os-taskbar__task--active', front );
			button.setAttribute( 'aria-pressed', front ? 'true' : 'false' );
			button.title = win.config.title;
			const label = el( 'span', 'os-taskbar__task-label' );
			label.textContent = win.config.title;
			button.append(
				icon( win.config.icon ?? '', win.config.title, win.config.baseId ?? win.id ),
				label,
			);
			button.addEventListener( 'click', () => {
				if ( win.isMinimized() ) {
					win.restore();
					wm.focus( win );
				} else if ( win.isFocused() ) {
					win.minimize();
				} else {
					wm.focus( win );
				}
			} );
			return button;
		} );
		this.tasks.replaceChildren( ...buttons );
	}

	private paintTray(): void {
		const buttons = this.trayEntries.map( ( item ) => {
			const button = el( 'button', 'os-taskbar__tray-item' );
			button.type = 'button';
			button.title = item.title;
			button.setAttribute( 'aria-label', item.title );
			button.dataset.systemId = item.id;
			button.appendChild( icon( item.icon, item.title, item.id ) );
			button.addEventListener( 'click', ( event ) => item.onOpen( event ) );
			return button;
		} );
		this.trayItems.replaceChildren( ...buttons );
	}

	private toggleMenu(): void {
		if ( this.menu.hidden ) {
			this.openMenu();
		} else {
			this.closeMenu();
		}
	}

	private openMenu(): void {
		this.paintMenu();
		this.menu.hidden = false;
		this.start.setAttribute( 'aria-expanded', 'true' );
		this.start.classList.add( 'os-taskbar__start--open' );
		document.addEventListener( 'pointerdown', this.onDocPointer, true );
		this.menu.querySelector< HTMLElement >( '[role="menuitem"]' )?.focus();
	}

	private closeMenu(): void {
		if ( this.menu.hidden ) {
			return;
		}
		this.menu.hidden = true;
		this.start.setAttribute( 'aria-expanded', 'false' );
		this.start.classList.remove( 'os-taskbar__start--open' );
		document.removeEventListener( 'pointerdown', this.onDocPointer, true );
	}

	private paintMenu(): void {
		const banner = el( 'div', 'os-taskbar__banner' );
		banner.setAttribute( 'aria-hidden', 'true' );
		const strong = el( 'b', '' );
		strong.textContent = 'Open';
		banner.append( strong, 'Station' );

		const list = el( 'div', 'os-taskbar__menu-list' );
		for ( const entry of this.menuEntries ) {
			list.appendChild( this.menuRow( entry ) );
		}
		const exit = this.trayEntries.find( ( t ) => t.id === 'os-exit' );
		if ( exit ) {
			list.appendChild( el( 'div', 'os-taskbar__menu-separator' ) );
			list.appendChild( this.systemRow( exit ) );
		}
		this.menu.replaceChildren( banner, list );
	}

	private menuRow( entry: DockEntry ): HTMLElement {
		if ( entry.type === 'system' ) {
			return this.systemRow( entry.item );
		}
		const item: DockItem = entry.item;
		const children: SubmenuItem[] = item.submenu ?? [];
		const row = this.row( item.icon, item.title, item.id, children.length > 0 );
		if ( children.length === 0 ) {
			row.addEventListener( 'click', () => {
				this.closeMenu();
				this.deps.openItem( item );
			} );
			return row;
		}

		const sub = el( 'div', 'os-taskbar__submenu' );
		sub.setAttribute( 'role', 'menu' );
		const self = this.row( '', item.selfLabel || item.title, '', false );
		self.addEventListener( 'click', () => {
			this.closeMenu();
			this.deps.openItem( item );
		} );
		sub.appendChild( self );
		for ( const child of children ) {
			if ( child.offSite ) {
				continue;
			}
			const childRow = this.row( '', child.title, '', false );
			childRow.addEventListener( 'click', () => {
				this.closeMenu();
				this.deps.openSubmenuPick( item, child );
			} );
			sub.appendChild( childRow );
		}
		const wrap = el( 'div', 'os-taskbar__cascade' );
		wrap.append( row, sub );
		row.addEventListener( 'click', () => this.openCascade( wrap ) );
		wrap.addEventListener( 'pointerenter', () => this.openCascade( wrap ) );
		return wrap;
	}

	private systemRow( item: SystemDockItem ): HTMLElement {
		const row = this.row( item.icon, item.title, item.id, false );
		row.addEventListener( 'click', ( event ) => {
			this.closeMenu();
			item.onOpen( event );
		} );
		return row;
	}

	private row( iconValue: string, title: string, slotId: string, cascades: boolean ): HTMLElement {
		const row = el( 'button', 'os-taskbar__menu-item' );
		row.type = 'button';
		row.setAttribute( 'role', 'menuitem' );
		row.tabIndex = -1;
		if ( iconValue ) {
			row.appendChild( icon( iconValue, title, slotId ) );
		} else {
			row.appendChild( el( 'span', 'os-taskbar__icon os-taskbar__icon--blank' ) );
		}
		const label = el( 'span', 'os-taskbar__menu-label' );
		label.textContent = title;
		row.appendChild( label );
		if ( cascades ) {
			row.setAttribute( 'aria-haspopup', 'menu' );
			row.appendChild( el( 'span', 'os-taskbar__menu-arrow' ) );
		}
		row.addEventListener( 'pointerenter', () => row.focus() );
		return row;
	}

	private openCascade( wrap: HTMLElement ): void {
		for ( const open of this.menu.querySelectorAll( '.os-taskbar__cascade--open' ) ) {
			if ( open !== wrap ) {
				open.classList.remove( 'os-taskbar__cascade--open' );
			}
		}
		wrap.classList.add( 'os-taskbar__cascade--open' );

		// A cascade opening near the bar would run under it: lift it
		// until its last row clears the bar's top edge.
		const sub = wrap.querySelector< HTMLElement >( '.os-taskbar__submenu' );
		if ( sub ) {
			sub.style.removeProperty( '--os-taskbar-submenu-shift' );
			const overflow =
				sub.getBoundingClientRect().bottom -
				this.deps.container.getBoundingClientRect().top;
			if ( overflow > 0 ) {
				sub.style.setProperty( '--os-taskbar-submenu-shift', `${ -overflow }px` );
			}
		}
	}

	/** Arrow keys walk the column that has focus; right opens a cascade. */
	private onMenuKey( event: KeyboardEvent ): void {
		const current = this.menu.ownerDocument.activeElement as HTMLElement | null;
		if ( ! current || ! this.menu.contains( current ) ) {
			return;
		}
		const column = current.closest( '.os-taskbar__submenu, .os-taskbar__menu-list' );
		const rows = column
			? [ ...column.querySelectorAll< HTMLElement >( ':scope > [role="menuitem"], :scope > .os-taskbar__cascade > [role="menuitem"]' ) ]
			: [];
		const index = rows.indexOf( current );
		const inSub = !! current.closest( '.os-taskbar__submenu' );
		const cascade = current.closest< HTMLElement >( '.os-taskbar__cascade' );

		switch ( event.key ) {
			case 'ArrowDown':
				rows[ ( index + 1 ) % rows.length ]?.focus();
				break;
			case 'ArrowUp':
				rows[ ( index - 1 + rows.length ) % rows.length ]?.focus();
				break;
			case 'ArrowRight':
				if ( ! inSub && cascade ) {
					this.openCascade( cascade );
					cascade.querySelector< HTMLElement >( '.os-taskbar__submenu [role="menuitem"]' )?.focus();
				}
				break;
			case 'ArrowLeft':
				if ( inSub && cascade ) {
					cascade.classList.remove( 'os-taskbar__cascade--open' );
					cascade.querySelector< HTMLElement >( ':scope > [role="menuitem"]' )?.focus();
				}
				break;
			case 'Escape':
				this.closeMenu();
				this.start.focus();
				break;
			default:
				return;
		}
		event.preventDefault();
	}

	private destroy(): void {
		this.closeMenu();
		this.stopClock();
		for ( const hook of WINDOW_HOOKS ) {
			removeAction( hook, this.namespace );
		}
		this.root.remove();
		this.menu.remove();
		this.deps.container.removeAttribute( 'data-os-dock-renderer' );
		this.deps.container.removeAttribute( 'data-os-dock-placement' );
	}
}

export const taskbarDockRailRenderer: DockRailRenderer = {
	id: 'taskbar',
	label: 'Taskbar',
	description:
		'A Start menu with every admin page, a button for each open window, and a tray with the clock.',
	icon: 'dashicons-table-row-after',
	apiVersion: 1,
	mount( deps: DockRailMountDeps ): DockRailController {
		if ( deps.orientation !== 'bottom' ) {
			return defaultDockRailRenderer.mount( deps );
		}
		return new Taskbar( deps ).controller();
	},
};
