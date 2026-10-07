import { activity } from './activity';
import { applyFilters, doAction, HOOKS } from './hooks';
import { isMobileStamped } from './mode/stamp';
import type { WindowManager } from './window-manager';
import { deriveWindowId } from './utils';
import { __, _n, sprintf } from './i18n';
import { hashTitleToHue } from './ui/util/hash-hue';
import {
	resolveThemedIcon,
	resolveThemedIconColor,
} from './desktop-themes/icons';
import { applyIconMask } from './desktop-themes/paint-tinted-icon';
import { slotForTileId } from './desktop-themes/slots';
import { attachDockPeek } from './dock-peek';
import { tryOpenExternalUrl } from './external-url';
import { openItemVisibilityMenu } from './item-visibility-menu-loader';
import {
	resolveNativeUrlRemap,
	tryNativeUrlRemap,
} from './native-url-remap';
import { persistZoneOrder as persistNavZoneOrder } from './nav/config';
import { zoneFor } from './nav/defaults';
import type { NavPlacement } from './nav/types';

import { NAV_ZONES as DOCK_ZONE_ORDER } from './nav/compute';
import { urlActs } from './pwa/acting-url';
import { isShellDocumentUrl } from './shell-url';

export interface SystemDockItem {

	id: string;

	title: string;

	icon: string;

	onOpen: ( event?: MouseEvent ) => void;

	isOpen?: () => boolean;

	multi?: boolean;

	onOpenNew?: () => void;

	placeable?: boolean;

	submenu?: SubmenuItem[];

	order?: number;

	windowId?: string;

	navKind?: 'core' | 'app' | 'control';

	locked?: boolean;

	defaultPlacement?: NavPlacement;
}

export type DockEntry =
	| { type: 'menu'; item: DockItem }
	| { type: 'system'; item: SystemDockItem };

export interface DockZones {

	core: DockEntry[];

	apps: DockEntry[];

	controls: DockEntry[];
}

export function zoneForSystemTile(
	item: SystemDockItem,
): keyof DockZones {
	return zoneFor( item.navKind ?? 'app' );
}

export interface SubmenuItem {
	title: string;
	url: string;

	onSelect?: ( event?: MouseEvent ) => void;

	windowId?: string;

	offSite?: boolean;
}

export interface DockItem {

	id: string;

	title: string;

	icon: string;

	url: string;

	windowId?: string;

	selfLabel?: string;

	badge: number;

	submenu: { title: string; url: string; offSite?: boolean }[];

	multi?: boolean;

	isCore?: boolean;

	pluginFile?: string | null;

	pluginName?: string | null;
}

export type DockOrientation = 'left' | 'right' | 'bottom';

export interface DockHookContextBase {
	rail: 'dock' | 'taskbar';
	orientation: DockOrientation;
	dockId: string;
	container: HTMLElement;
}

export interface DockTileContext extends DockHookContextBase {
	item: DockItem | SystemDockItem;
	isSystem: boolean;
}

export interface DockRenderContext extends DockHookContextBase {
	items: DockItem[];
	tileElements: ReadonlyMap<string, HTMLElement>;
}

export type DockAttentionMode = 'pulse' | 'shake' | 'bounce' | null;

export type DockAttentionIntensity = 'subtle' | 'normal' | 'strong';

export interface DockAttentionOptions {

	durationMs?: number;

	intensity?: DockAttentionIntensity;
}

export class Dock {
	private container: HTMLElement;

	private itemHost: HTMLElement;

	private systemHost: HTMLElement;
	private windowManager: WindowManager;
	private items: DockItem[];
	private tooltip: HTMLElement;
	private itemElements: Map<string, HTMLElement> = new Map();
	private adminUrl: string;
	private orientation: DockOrientation;

	private rail: 'dock' | 'taskbar';
	private systemItems: SystemDockItem[] = [];
	private systemItemElements: Map<string, HTMLElement> = new Map();

	private zones: DockZones = { core: [], apps: [], controls: [] };

	private badgeOverrides: Map<string, number> = new Map();

	private artOverrides: Map<string, string> = new Map();

	private attentionTimers: Map<string, number> = new Map();

	private peekTeardowns: Map<string, () => void> = new Map();

	private boundRefresh: () => void = () => undefined;

	private hooksNamespace: string;

	private static instanceCounter = 0;

	private static activeDragReset: ( () => void ) | null = null;

	private buildHookContextBase(): DockHookContextBase {
		return {
			rail: this.rail,
			orientation: this.orientation,
			dockId: this.container.id,
			container: this.container,
		};
	}

	constructor(
		container: HTMLElement,
		windowManager: WindowManager,
		items: DockItem[],
		adminUrl: string,
		orientation: DockOrientation = 'left',
	) {
		this.container = container;
		this.windowManager = windowManager;
		this.items = items;
		this.adminUrl = adminUrl;
		this.orientation = orientation;
		this.rail = orientation === 'bottom' ? 'taskbar' : 'dock';
		this.hooksNamespace = `desktop-mode/dock/${ ++Dock.instanceCounter }`;

		this.container.classList.add( 'os-dock--no-transition' );
		this.container.setAttribute(
			'data-os-dock-placement',
			orientation,
		);
		void this.container.offsetWidth;
		this.container.classList.remove( 'os-dock--no-transition' );

		const scroll = document.createElement( 'div' );
		scroll.className = 'os-dock__scroll';
		const pinned = document.createElement( 'div' );
		pinned.className = 'os-dock__pinned';
		container.appendChild( scroll );
		container.appendChild( pinned );
		this.itemHost = scroll;
		this.systemHost = pinned;

		this.tooltip = document.createElement( 'div' );
		this.tooltip.className = 'os-dock__tooltip';
		this.tooltip.setAttribute( 'role', 'tooltip' );

		if ( orientation === 'bottom' ) {
			this.tooltip.classList.add( 'os-dock__tooltip--above' );
		} else if ( orientation === 'right' ) {
			this.tooltip.classList.add( 'os-dock__tooltip--before' );
		} else {
			this.tooltip.classList.add( 'os-dock__tooltip--after' );
		}
		document.body.appendChild( this.tooltip );

		this.zones = this.zonesFromMenu( items, [] );
		this.render();
		this.bindWindowEvents();
	}

	public setOrientation( orientation: DockOrientation ): void {
		if ( this.orientation === orientation ) {
			return;
		}
		this.orientation = orientation;
		this.container.setAttribute(
			'data-os-dock-placement',
			orientation,
		);
		this.tooltip.classList.remove(
			'os-dock__tooltip--above',
			'os-dock__tooltip--before',
			'os-dock__tooltip--after',
		);
		if ( orientation === 'bottom' ) {
			this.tooltip.classList.add( 'os-dock__tooltip--above' );
		} else if ( orientation === 'right' ) {
			this.tooltip.classList.add( 'os-dock__tooltip--before' );
		} else {
			this.tooltip.classList.add( 'os-dock__tooltip--after' );
		}
	}

	public replaceItems( items: DockItem[] ): void {
		this.zones = this.zonesFromMenu( items, this.systemEntries() );
		this.render();
	}

	public setZones( zones: DockZones ): void {
		this.zones = {
			core: zones.core.slice(),
			apps: zones.apps.slice(),
			controls: zones.controls.slice(),
		};
		this.render();
	}

	private systemEntries(): DockEntry[] {
		const out: DockEntry[] = [];
		for ( const zone of DOCK_ZONE_ORDER ) {
			for ( const entry of this.zones[ zone ] ) {
				if ( 'system' === entry.type ) {
					out.push( entry );
				}
			}
		}
		return out;
	}

	private zonesFromMenu(
		items: DockItem[],
		systemEntries: DockEntry[],
	): DockZones {
		const zones: DockZones = { core: [], apps: [], controls: [] };
		for ( const item of items ) {
			zones[ item.isCore ? 'core' : 'apps' ].push( {
				type: 'menu',
				item,
			} );
		}
		for ( const entry of systemEntries ) {
			if ( 'system' !== entry.type ) {
				continue;
			}
			zones[ zoneForSystemTile( entry.item ) ].push( entry );
		}
		return zones;
	}

	public hasItems(): boolean {
		return this.itemElements.size > 0 || this.systemItemElements.size > 0;
	}

	public removeSystemItem( id: string ): void {
		let found = false;
		for ( const zone of DOCK_ZONE_ORDER ) {
			const next = this.zones[ zone ].filter(
				( entry ) =>
					'system' !== entry.type || entry.item.id !== id,
			);
			if ( next.length !== this.zones[ zone ].length ) {
				found = true;
			}
			this.zones[ zone ] = next;
		}
		if ( ! found ) {
			return;
		}

		this.badgeOverrides.delete( id );
		this.artOverrides.delete( id );
		this.render();

		doAction( HOOKS.DOCK_ITEM_REMOVED, { id, placement: this.rail } );
	}

	public setBadge( itemId: string, count: number ): void {
		const tile = this._resolveTileElement( itemId );

		if ( ! tile ) {
			return;
		}
		const safe = Math.max( 0, Math.floor( Number( count ) || 0 ) );

		if ( safe === 0 ) {
			this.badgeOverrides.delete( itemId );
		} else {
			this.badgeOverrides.set( itemId, safe );
		}

		const primary = tile.querySelector< HTMLElement >(
			'.os-dock__item-primary',
		);
		_applyBadgeNode( primary ?? tile, safe );

		activity.publish( 'os/badge-changed', {
			itemId,
			count: safe,
			rail: this.rail,
		} );
	}

	public clearBadge( itemId: string ): void {
		this.setBadge( itemId, 0 );
	}

	public setArt( itemId: string, svg: string ): void {
		if ( ! svg ) {
			if ( ! this.artOverrides.delete( itemId ) ) {
				return;
			}
			const tile = this._resolveTileElement( itemId );
			const declared = this._declaredIcon( itemId );
			if ( tile && declared ) {
				this._paintArt( tile, itemId, declared );
			}
			activity.publish( 'os/art-changed', {
				itemId,
				icon: '',
				rail: this.rail,
			} );
			return;
		}

		this.artOverrides.set( itemId, svg );
		const tile = this._resolveTileElement( itemId );
		if ( ! tile ) {
			return;
		}
		this._paintArt( tile, itemId, svg );
		activity.publish( 'os/art-changed', {
			itemId,
			icon: svg,
			rail: this.rail,
		} );
	}

	public getArt( itemId: string ): string {
		return this.artOverrides.get( itemId ) ?? '';
	}

	private _declaredIcon( itemId: string ): string {
		const menu = this.items.find( ( i ) => i.id === itemId );
		if ( menu ) {
			return menu.icon;
		}
		const system = this.systemItems.find( ( i ) => i.id === itemId );
		return system ? system.icon : '';
	}

	private _paintArt( tile: HTMLElement, itemId: string, svg: string ): void {
		const primary =
			tile.querySelector< HTMLElement >( '.os-dock__item-primary' ) ??
			tile;

		const next = this.resolveIcon(
			svg,
			this._declaredTitle( itemId ),
			undefined,
			slotForTileId( itemId ),
		);
		const current = primary.querySelector< HTMLElement >(
			'.os-dock__item-mask, .os-dock__item-svg, .dashicons, img',
		);
		if ( current ) {
			current.replaceWith( next );
		} else {
			primary.prepend( next );
		}
	}

	private _declaredTitle( itemId: string ): string {
		const menu = this.items.find( ( i ) => i.id === itemId );
		if ( menu ) {
			return menu.title;
		}
		const system = this.systemItems.find( ( i ) => i.id === itemId );
		return system ? system.title : '';
	}

	public setAttention(
		itemId: string,
		mode: DockAttentionMode,
		opts: DockAttentionOptions = {},
	): void {
		const tile = this._resolveTileElement( itemId );
		if ( ! tile ) {
			return;
		}

		const pending = this.attentionTimers.get( itemId );
		if ( pending !== undefined ) {
			window.clearTimeout( pending );
			this.attentionTimers.delete( itemId );
		}

		tile.classList.remove(
			'os-dock__item--attention-pulse',
			'os-dock__item--attention-shake',
			'os-dock__item--attention-bounce',
			'os-dock__item--intensity-subtle',
			'os-dock__item--intensity-normal',
			'os-dock__item--intensity-strong',
		);

		if ( mode === null ) {
			return;
		}

		tile.classList.add( `os-dock__item--attention-${ mode }` );
		const intensity = opts.intensity ?? 'normal';
		tile.classList.add( `os-dock__item--intensity-${ intensity }` );

		const duration = opts.durationMs ?? 4000;
		if ( duration > 0 ) {
			const handle = window.setTimeout( () => {
				this.attentionTimers.delete( itemId );
				this.setAttention( itemId, null );
			}, duration );
			this.attentionTimers.set( itemId, handle );
		}
	}

	private _resolveTileElement( itemId: string ): HTMLElement | null {
		return (
			this.itemElements.get( itemId ) ??
			this.systemItemElements.get( itemId ) ??
			null
		);
	}

	public appendSystemItem( item: SystemDockItem ): void {
		const zone = zoneForSystemTile( item );
		const entry: DockEntry = { type: 'system', item };

		for ( const z of DOCK_ZONE_ORDER ) {
			this.zones[ z ] = this.zones[ z ].filter(
				( e ) => 'system' !== e.type || e.item.id !== item.id,
			);
		}
		const list = this.zones[ zone ];
		const order = item.order ?? 0;

		const at = list.findIndex(
			( e ) => 'system' === e.type && ( e.item.order ?? 0 ) > order,
		);
		if ( at === -1 ) {
			list.push( entry );
		} else {
			list.splice( at, 0, entry );
		}
		this.render();
	}

	private render(): void {
		if ( Dock.activeDragReset ) {
			const prev = Dock.activeDragReset;
			Dock.activeDragReset = null;
			prev();
		}

		for ( const teardown of this.peekTeardowns.values() ) {
			teardown();
		}
		this.peekTeardowns.clear();

		this.itemHost.innerHTML = '';
		this.systemHost.innerHTML = '';
		this.itemElements.clear();
		this.systemItemElements.clear();

		this.items = [];
		this.systemItems = [];
		for ( const zone of DOCK_ZONE_ORDER ) {
			for ( const entry of this.zones[ zone ] ) {
				if ( 'menu' === entry.type ) {
					this.items.push( entry.item );
				} else {
					this.systemItems.push( entry.item );
				}
			}
		}

		const base = this.buildHookContextBase();
		doAction( HOOKS.DOCK_BEFORE_RENDER, {
			...base,
			items: this.items,
			tileElements: this.itemElements as ReadonlyMap<string, HTMLElement>,
		} );

		let painted = false;
		for ( const zone of DOCK_ZONE_ORDER ) {
			const entries = this.zones[ zone ];
			if ( 0 === entries.length ) {
				continue;
			}
			const host =
				'controls' === zone ? this.systemHost : this.itemHost;
			if ( painted ) {
				const sep = document.createElement( 'div' );

				sep.className =
					'controls' === zone
						? 'os-dock__separator'
						: 'os-dock__separator os-dock__separator--group';
				sep.setAttribute( 'aria-hidden', 'true' );
				host.appendChild( sep );
			}
			for ( const entry of entries ) {
				this.paintEntry( entry, zone, host, base );
			}
			painted = true;
		}

		this.updateActiveStates();

		doAction( HOOKS.DOCK_AFTER_RENDER, {
			...base,
			items: this.items,
			tileElements: this.itemElements as ReadonlyMap<string, HTMLElement>,
		} );
	}

	private paintEntry(
		entry: DockEntry,
		zone: keyof DockZones,
		host: HTMLElement,
		base: DockHookContextBase,
	): void {
		const id = entry.item.id;
		const tile =
			'menu' === entry.type
				? this.createItemButton( entry.item )
				: this.createSystemItemButton( entry.item );

		tile.dataset.zone = zone;
		tile.dataset.navId = id;
		const locked =
			'system' === entry.type && true === entry.item.locked;
		if ( locked ) {
			tile.dataset.navLocked = 'true';
		} else {
			this.attachDragReorder( tile, id, zone );

			tile.addEventListener( 'contextmenu', ( ev: MouseEvent ) => {
				ev.preventDefault();
				openItemVisibilityMenu( {
					x: ev.clientX,
					y: ev.clientY,
					id,
					title: entry.item.title,
					surface: 'dock',
					pluginFile:
						'menu' === entry.type
							? entry.item.pluginFile ?? null
							: null,
					pluginName:
						'menu' === entry.type
							? entry.item.pluginName ?? null
							: null,
				} );
			} );
		}
		if ( 'menu' === entry.type ) {
			this.itemElements.set( id, tile );
		} else {
			this.systemItemElements.set( id, tile );
		}
		host.appendChild( tile );

		const badge = this.badgeOverrides.get( id );
		if ( badge !== undefined ) {
			const primary = tile.querySelector< HTMLElement >(
				'.os-dock__item-primary',
			);
			_applyBadgeNode( primary ?? tile, badge );
		}
		const art = this.artOverrides.get( id );
		if ( art ) {
			this._paintArt( tile, id, art );
		}

		doAction( HOOKS.DOCK_TILE_RENDERED, {
			...base,
			item: entry.item,
			isSystem: 'system' === entry.type,
			el: tile,
		} );
	}

	private createSystemItemButton( item: SystemDockItem ): HTMLElement {
		const ctx: DockTileContext = {
			...this.buildHookContextBase(),
			item,
			isSystem: true,
		};

		const tile = document.createElement( 'div' );
		const baseClasses = [
			'os-dock__item',
			'os-dock__item--system',
		];
		const filteredClasses = applyFilters< string[] >(
			HOOKS.DOCK_TILE_CLASS,
			baseClasses,
			ctx,
		);
		tile.className = filteredClasses.join( ' ' );
		tile.dataset.systemId = item.id;

		( tile.dataset as unknown as Record< string, string > ).osWindowBaseId = item.id;

		if ( item.submenu && item.submenu.length > 0 ) {
			tile.dataset.constellationId = item.id;
		}

		const primary = document.createElement( 'button' );
		primary.className = 'os-dock__item-primary';
		primary.setAttribute( 'type', 'button' );
		primary.setAttribute( 'aria-label', item.title );

		primary.appendChild(
			this.resolveIcon(
				item.icon,
				item.title,
				undefined,
				slotForTileId( item.id ),
			),
		);

		primary.addEventListener( 'click', ( event ) => item.onOpen( event ) );

		tile.appendChild( primary );
		this.bindTooltipFiltered( tile, item.title, ctx );

		const teardown = attachDockPeek( {
			tile,
			item: {
				id: item.id,
				title: item.title,
				icon: item.icon,
				url: '',
			},

			getInstances: () => this.windowManager.getAllByBaseIdOnActiveDesktop( item.id ),
			enableGhost: !! item.multi,
			windowManager: this.windowManager,
			getOrientation: () => this.orientation,
			openNew: () => {
				const fn = item.onOpenNew ?? item.onOpen;
				fn();
			},
			suppressTooltip: ( on: boolean ) => {
				if ( on ) {
					this.tooltip.classList.remove(
						'os-dock__tooltip--visible',
					);
				}
			},
		} );
		this.peekTeardowns.set( `system:${ item.id }`, teardown );

		this.bindPrewarmDwell( tile, () => this.prewarmNativeWindow( item.id ) );

		return applyFilters< HTMLElement >(
			HOOKS.DOCK_TILE_ELEMENT,
			tile,
			ctx,
		);
	}

	private createItemButton( item: DockItem ): HTMLElement {
		const ctx: DockTileContext = {
			...this.buildHookContextBase(),
			item,
			isSystem: false,
		};

		const tile = document.createElement( 'div' );
		const baseClasses = [ 'os-dock__item' ];
		if ( item.multi ) {
			baseClasses.push( 'os-dock__item--multi' );
		}
		const filteredClasses = applyFilters< string[] >(
			HOOKS.DOCK_TILE_CLASS,
			baseClasses,
			ctx,
		);
		tile.className = filteredClasses.join( ' ' );
		tile.dataset.menuSlug = item.id;

		const primary = document.createElement( 'button' );
		primary.className = 'os-dock__item-primary';
		primary.setAttribute( 'type', 'button' );
		primary.setAttribute( 'aria-label', item.title );

		const iconEl = this.resolveIcon(
			item.icon,
			item.title,
			item.url,
			slotForTileId( item.id ),
		);
		primary.appendChild( iconEl );

		if ( item.badge > 0 ) {
			const displayCount = item.badge > 99 ? '99+' : String( item.badge );
			const badge = document.createElement( 'span' );
			badge.className = 'os-dock__badge';
			badge.textContent = displayCount;
			badge.setAttribute(
				'aria-label',
				sprintf(

					_n( '%d update', '%d updates', item.badge ),
					item.badge,
				),
			);
			primary.appendChild( badge );
		}

		primary.addEventListener( 'click', () => {
			this.openPage( item );
		} );

		tile.appendChild( primary );

		this.bindTooltipFiltered( tile, item.title, ctx );

		const baseId = this.resolveItemBaseId( item );

		( tile.dataset as unknown as Record< string, string > ).osWindowBaseId = baseId;
		const teardown = attachDockPeek( {
			tile,
			item: {
				id: item.id,
				title: item.title,
				icon: item.icon,
				url: item.url,
			},

			getInstances: () => this.windowManager.getAllByBaseIdOnActiveDesktop( baseId ),

			enableGhost: true,
			windowManager: this.windowManager,
			getOrientation: () => this.orientation,
			openNew: () => this.openNewInstance( item ),
			suppressTooltip: ( on: boolean ) => {
				if ( on ) {
					this.tooltip.classList.remove(
						'os-dock__tooltip--visible',
					);
				}
			},
		} );
		this.peekTeardowns.set( item.id, teardown );

		this.bindHoverPrewarm( tile, item );

		return applyFilters< HTMLElement >(
			HOOKS.DOCK_TILE_ELEMENT,
			tile,
			ctx,
		);
	}

	private attachDragReorder(
		tile: HTMLElement,
		itemId: string,
		zone: keyof DockZones,
	): void {
		const THRESHOLD = 5;
		const FLIP_MS = 200;
		let active = false;
		let startX = 0;
		let startY = 0;
		let originalOrder: string[] = [];
		let originalNext: ChildNode | null = null;
		let pointerId = -1;
		let originRect: DOMRect | null = null;
		let justDragged = false;

		const hardReset = (): void => {
			active = false;
			tile.classList.remove( 'os-dock__item--dragging' );
			tile.style.transform = '';
			tile.style.transition = '';
			document.removeEventListener( 'pointermove', onMove );
			document.removeEventListener( 'pointerup', onUp );
			document.removeEventListener( 'pointercancel', onCancel );
			document.removeEventListener( 'keydown', onKey, true );
			window.removeEventListener( 'blur', onBlur );
			document.removeEventListener( 'visibilitychange', onVisibility );
			pointerId = -1;
			originRect = null;
		};

		const host: HTMLElement =
			'controls' === zone ? this.systemHost : this.itemHost;

		const isSameZoneTile = ( el: Element | null ): el is HTMLElement => {
			return (
				!! el &&
				el instanceof HTMLElement &&
				el.classList.contains( 'os-dock__item' ) &&
				el.dataset.zone === zone &&
				!! el.dataset.navId &&
				undefined === el.dataset.navLocked
			);
		};

		const eachSiblingTile = ( fn: ( el: HTMLElement ) => void ): void => {
			for ( const child of Array.from( host.children ) ) {
				if (
					child instanceof HTMLElement &&
					child !== tile &&
					isSameZoneTile( child )
				) {
					fn( child );
				}
			}
		};

		const snapshotZoneOrder = (): string[] => {
			const ids: string[] = [];
			for ( const child of Array.from( host.children ) ) {
				if ( isSameZoneTile( child ) ) {
					ids.push( child.dataset.navId as string );
				}
			}
			return ids;
		};

		const flipSiblings = (
			prevRects: Map< Element, DOMRect >,
		): void => {
			eachSiblingTile( ( sib ) => {
				const prev = prevRects.get( sib );
				if ( ! prev ) {
					return;
				}
				const now = sib.getBoundingClientRect();
				const dx = prev.left - now.left;
				const dy = prev.top - now.top;
				if ( Math.abs( dx ) < 0.5 && Math.abs( dy ) < 0.5 ) {
					return;
				}
				sib.style.transition = 'none';
				sib.style.transform = `translate(${ dx }px, ${ dy }px)`;

				void sib.offsetHeight;
				sib.style.transition = `transform ${ FLIP_MS }ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
				sib.style.transform = '';
				const onEnd = (): void => {
					sib.style.transition = '';
					sib.style.transform = '';
					sib.removeEventListener( 'transitionend', onEnd );
				};
				sib.addEventListener( 'transitionend', onEnd );
			} );
		};

		const onMove = ( ev: PointerEvent ): void => {
			if ( pointerId !== -1 && ev.pointerId !== pointerId ) {
				return;
			}
			if ( ! active ) {
				const dx = ev.clientX - startX;
				const dy = ev.clientY - startY;
				if ( dx * dx + dy * dy < THRESHOLD * THRESHOLD ) {
					return;
				}

				active = true;
				originalOrder = snapshotZoneOrder();
				originalNext = tile.nextSibling;
				originRect = tile.getBoundingClientRect();
				tile.classList.add( 'os-dock__item--dragging' );

				this.tooltip.classList.remove(
					'os-dock__tooltip--visible',
				);
			}

			if ( ! originRect ) {
				return;
			}

			const dx = ev.clientX - startX;
			const dy = ev.clientY - startY;
			tile.style.transform = `translate(${ dx }px, ${ dy }px)`;

			const under = document.elementFromPoint( ev.clientX, ev.clientY );
			const targetTile = under?.closest(
				'.os-dock__item',
			) as HTMLElement | null;
			if ( ! targetTile || targetTile === tile ) {
				return;
			}
			if ( ! isSameZoneTile( targetTile ) ) {
				return;
			}

			const rect = targetTile.getBoundingClientRect();
			let insertBefore: boolean;
			if ( this.orientation === 'bottom' ) {
				insertBefore = ev.clientX < rect.left + rect.width / 2;
			} else {
				insertBefore = ev.clientY < rect.top + rect.height / 2;
			}

			const prevRects = new Map< Element, DOMRect >();
			eachSiblingTile( ( sib ) => {
				prevRects.set( sib, sib.getBoundingClientRect() );
			} );

			let reordered = false;
			if ( insertBefore ) {
				if ( targetTile !== tile.nextSibling ) {
					host.insertBefore( tile, targetTile );
					reordered = true;
				}
			} else if ( targetTile.nextSibling !== tile ) {
				host.insertBefore( tile, targetTile.nextSibling );
				reordered = true;
			}

			if ( reordered ) {
				tile.style.transform = '';
				const fresh = tile.getBoundingClientRect();
				startX = fresh.left + fresh.width / 2;
				startY = fresh.top + fresh.height / 2;
				tile.style.transform = `translate(${
					ev.clientX - startX
				}px, ${ ev.clientY - startY }px)`;
				flipSiblings( prevRects );
			}
		};

		const cleanup = (): void => {
			tile.classList.remove( 'os-dock__item--dragging' );
			tile.style.transform = '';
			tile.style.transition = '';
			document.removeEventListener( 'pointermove', onMove );
			document.removeEventListener( 'pointerup', onUp );
			document.removeEventListener( 'pointercancel', onCancel );
			document.removeEventListener( 'keydown', onKey, true );
			window.removeEventListener( 'blur', onBlur );
			document.removeEventListener( 'visibilitychange', onVisibility );
			pointerId = -1;
			originRect = null;
			active = false;
			if ( Dock.activeDragReset === hardReset ) {
				Dock.activeDragReset = null;
			}
		};

		const animateHome = (): void => {
			tile.style.transition = `transform ${ FLIP_MS }ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
			tile.style.transform = '';
			const onEnd = (): void => {
				tile.style.transition = '';
				tile.removeEventListener( 'transitionend', onEnd );
			};
			tile.addEventListener( 'transitionend', onEnd );
		};

		const persistZoneOrder = ( finalOrder: string[] ): void => {
			void itemId;
			persistNavZoneOrder( finalOrder );
		};

		const onUp = ( ev: PointerEvent ): void => {
			if ( pointerId !== -1 && ev.pointerId !== pointerId ) {
				return;
			}
			if ( ! active ) {
				cleanup();
				return;
			}
			justDragged = true;
			const finalOrder = snapshotZoneOrder();
			animateHome();
			cleanup();

			const same =
				finalOrder.length === originalOrder.length &&
				finalOrder.every( ( id, i ) => id === originalOrder[ i ] );
			if ( ! same ) {
				persistZoneOrder( finalOrder );
			}
			setTimeout( () => {
				justDragged = false;
			}, 200 );
		};

		const onCancel = ( ev?: PointerEvent ): void => {
			if ( ev && pointerId !== -1 && ev.pointerId !== pointerId ) {
				return;
			}
			if ( active && originalNext !== undefined ) {
				const prevRects = new Map< Element, DOMRect >();
				eachSiblingTile( ( sib ) => {
					prevRects.set( sib, sib.getBoundingClientRect() );
				} );
				host.insertBefore( tile, originalNext );
				flipSiblings( prevRects );
			}
			animateHome();
			cleanup();
		};

		const onKey = ( ev: KeyboardEvent ): void => {
			if ( ev.key === 'Escape' ) {
				onCancel();
			}
		};

		const onBlur = (): void => onCancel();
		const onVisibility = (): void => {
			if ( document.visibilityState !== 'visible' ) {
				onCancel();
			}
		};

		tile.addEventListener( 'pointerdown', ( ev: PointerEvent ) => {
			if ( ev.button !== 0 || isMobileStamped() ) {
				return;
			}

			if ( Dock.activeDragReset ) {
				const prev = Dock.activeDragReset;
				Dock.activeDragReset = null;
				prev();
			}

			if ( active || pointerId !== -1 ) {
				hardReset();
			}
			startX = ev.clientX;
			startY = ev.clientY;
			pointerId = ev.pointerId;
			active = false;
			Dock.activeDragReset = hardReset;
			document.addEventListener( 'pointermove', onMove );
			document.addEventListener( 'pointerup', onUp );
			document.addEventListener( 'pointercancel', onCancel );
			document.addEventListener( 'keydown', onKey, true );
			window.addEventListener( 'blur', onBlur );
			document.addEventListener( 'visibilitychange', onVisibility );
		} );

		tile.addEventListener(
			'click',
			( ev: MouseEvent ) => {
				if ( justDragged ) {
					ev.preventDefault();
					ev.stopImmediatePropagation();
				}
			},
			true,
		);
	}

	private resolveIcon(
		icon: string,
		title: string,
		url?: string,
		slot?: string,
	): HTMLElement {
		let isThemed = false;
		let tint: string | null = null;
		if ( slot ) {
			const themed = resolveThemedIcon( slot );
			if ( themed !== null ) {
				icon = themed;
				isThemed = true;
			}
			tint = resolveThemedIconColor( slot );
		}

		if ( tint !== null && ! icon.startsWith( 'dashicons-' ) ) {
			const masked = this._makeMaskSpan();
			if ( applyIconMask( masked, icon, tint ) ) {
				return masked;
			}
		}

		if (
			icon.startsWith( 'dashicons-' ) &&
			( isThemed || icon !== 'dashicons-admin-generic' )
		) {
			const el = document.createElement( 'span' );
			el.className = `dashicons ${ icon }`;
			el.setAttribute( 'aria-hidden', 'true' );
			if ( tint !== null ) {
				el.style.color = tint;
			}
			return el;
		}

		if ( icon.startsWith( 'data:image/svg+xml;base64,' ) ) {
			const base64Part = icon.slice( 'data:image/svg+xml;base64,'.length );
			if ( /^[A-Za-z0-9+/=]+$/.test( base64Part ) ) {
				return this._makeSvgIcon( icon );
			}
		}

		if ( icon.startsWith( 'url(' ) ) {
			return this._makeSvgIcon( icon );
		}

		if ( icon.startsWith( 'http://' ) || icon.startsWith( 'https://' ) ) {
			const img = document.createElement( 'img' );
			img.className = 'os-dock__item-img';
			img.src = icon;
			img.alt = '';
			img.setAttribute( 'aria-hidden', 'true' );
			return img;
		}

		if ( url && ! isThemed ) {
			const native = this._extractNativeMenuIcon( url );
			if ( native ) {
				return native;
			}
		}

		if ( icon === 'dashicons-admin-generic' ) {
			const el = document.createElement( 'span' );
			el.className = 'dashicons dashicons-admin-generic';
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		return this.createLetterBadge( title );
	}

	private _makeMaskSpan(): HTMLElement {
		const el = document.createElement( 'span' );
		el.className = 'os-dock__item-mask';
		el.setAttribute( 'aria-hidden', 'true' );
		el.style.width = 'var( --os-dock-icon-size, 20px )';
		el.style.height = 'var( --os-dock-icon-size, 20px )';
		el.style.display = 'block';
		el.style.flexShrink = '0';
		return el;
	}

	private _makeSvgIcon( bgValue: string ): HTMLElement {
		const unwrapped = /^url\(\s*(['"]?)(.+?)\1\s*\)$/.exec( bgValue );
		const bare = unwrapped ? unwrapped[ 2 ] : bgValue;
		const masked = this._makeMaskSpan();
		if ( applyIconMask( masked, bare, 'currentColor' ) ) {
			return masked;
		}

		const el = document.createElement( 'span' );
		el.className = 'os-dock__item-svg';
		el.style.backgroundImage = bgValue.startsWith( 'url(' )
			? bgValue
			: `url("${ bgValue }")`;
		el.style.backgroundSize = 'contain';
		el.style.backgroundRepeat = 'no-repeat';
		el.style.backgroundPosition = 'center';
		el.setAttribute( 'aria-hidden', 'true' );
		return el;
	}

	private _extractNativeMenuIcon( url: string ): HTMLElement | null {
		const adminMenu = document.getElementById( 'adminmenu' );
		if ( ! adminMenu ) {
			return null;
		}

		let target: string;
		try {
			const u = new URL( url, window.location.href );
			const filename = u.pathname.split( '/' ).pop() || '';
			target = filename + u.search;
		} catch {
			return null;
		}
		if ( ! target ) {
			return null;
		}

		const links = adminMenu.querySelectorAll< HTMLAnchorElement >( 'li.menu-top > a' );
		let matchLi: HTMLElement | null = null;
		for ( const link of Array.from( links ) ) {
			if ( link.href.endsWith( target ) ) {
				matchLi = link.closest( 'li.menu-top' );
				break;
			}
		}
		if ( ! matchLi ) {
			return null;
		}

		const imgWrap = matchLi.querySelector< HTMLElement >( '.wp-menu-image' );
		if ( ! imgWrap ) {
			return null;
		}

		const img = imgWrap.querySelector( 'img' );
		if ( img && img.src ) {
			const el = document.createElement( 'img' );
			el.className = 'os-dock__item-img';
			el.src = img.src;
			el.alt = '';
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		const dashMatch = imgWrap.className.match( /\bdashicons-[\w-]+\b/ );
		if ( dashMatch && dashMatch[ 0 ] !== 'dashicons-before' ) {
			const el = document.createElement( 'span' );
			el.className = `dashicons ${ dashMatch[ 0 ] }`;
			el.setAttribute( 'aria-hidden', 'true' );
			return el;
		}

		const before = window.getComputedStyle( imgWrap, '::before' );
		const bg = before.backgroundImage;
		if ( bg && bg !== 'none' && ! bg.includes( 'url("")' ) ) {
			return this._makeSvgIcon( bg );
		}

		const mask = before.maskImage || before.webkitMaskImage;
		if ( mask && mask !== 'none' && ! mask.includes( 'url("")' ) ) {
			return this._makeSvgIcon( mask );
		}

		const bgWrap = window.getComputedStyle( imgWrap ).backgroundImage;
		if ( bgWrap && bgWrap !== 'none' && ! bgWrap.includes( 'url("")' ) ) {
			return this._makeSvgIcon( bgWrap );
		}

		return null;
	}

	private createLetterBadge( title: string ): HTMLElement {
		const el = document.createElement( 'span' );
		el.className = 'os-dock__item-letter';
		el.setAttribute( 'aria-hidden', 'true' );

		const trimmed = title.trim();

		const firstCodePoint = trimmed ? Array.from( trimmed )[ 0 ] : '?';
		el.textContent = firstCodePoint.toUpperCase();

		const hue = hashTitleToHue( trimmed );

		el.style.background = `linear-gradient(135deg, hsl(${ hue } 62% 55%), hsl(${ ( hue + 24 ) % 360 } 58% 42%))`;

		return el;
	}

	private bindTooltipFiltered(
		tile: HTMLElement,
		text: string,
		ctx: DockTileContext,
	): void {
		const filtered = applyFilters< string >(
			HOOKS.DOCK_TILE_TOOLTIP,
			text,
			ctx,
		);
		tile.dataset.dockTooltip = filtered;
		if ( filtered === '' ) {
			return;
		}
		tile.addEventListener( 'pointerenter', () => {
			this.positionTooltip( tile, filtered );
			this.tooltip.classList.add( 'os-dock__tooltip--visible' );
		} );
		tile.addEventListener( 'pointerleave', () => {
			this.tooltip.classList.remove( 'os-dock__tooltip--visible' );
		} );
	}

	private positionTooltip( el: HTMLElement, text: string ): void {
		const rect = el.getBoundingClientRect();
		this.tooltip.textContent = text;
		if ( this.orientation === 'bottom' ) {
			this.tooltip.style.left = `${ rect.left + rect.width / 2 }px`;
			this.tooltip.style.top = `${ rect.top - 14 }px`;
		} else if ( this.orientation === 'right' ) {
			this.tooltip.style.top = `${ rect.top + rect.height / 2 - 14 }px`;
			this.tooltip.style.left = `${ rect.left }px`;
		} else {
			this.tooltip.style.top = `${ rect.top + rect.height / 2 - 14 }px`;
			this.tooltip.style.left = `${ rect.right + 8 }px`;
		}
	}

	private bindHoverPrewarm( tile: HTMLElement, item: DockItem ): void {
		if ( ! item.url ) {
			const { windowId } = item;
			if ( windowId ) {
				this.bindPrewarmDwell( tile, () => this.prewarmNativeWindow( windowId ) );
			}
			return;
		}
		this.bindPrewarmDwell( tile, () => {
			const nativeId = resolveNativeUrlRemap( item.url );
			if ( nativeId ) {
				this.prewarmNativeWindow( nativeId );
				return;
			}

			try {
				const parsed = new URL( item.url, window.location.href );
				if ( parsed.origin !== window.location.origin ) {
					return;
				}

				if ( urlActs( parsed ) ) {
					return;
				}

				if ( isShellDocumentUrl( parsed ) ) {
					return;
				}
			} catch {
				return;
			}
			const baseId = this.deriveWindowId( item.url );

			void this.windowManager.prewarm( {
				id: baseId,
				baseId,
				url: item.url,
				parentUrl: item.url,
				title: item.title,
				icon: item.icon.startsWith( 'dashicons-' )
					? item.icon
					: 'dashicons-admin-generic',
				submenu: item.submenu,
				selfLabel: item.selfLabel,
				multi: !! item.multi,
			} );
		} );
	}

	private bindPrewarmDwell( tile: HTMLElement, warm: () => void ): void {
		const DWELL_MS = 180;
		let dwellTimer: number | undefined;
		const cancel = () => {
			if ( dwellTimer !== undefined ) {
				window.clearTimeout( dwellTimer );
				dwellTimer = undefined;
			}
		};
		tile.addEventListener( 'pointerenter', ( e: PointerEvent ) => {
			if ( e.pointerType !== 'mouse' ) {
				return;
			}
			const os = (
				window as unknown as {
					wp?: {
						os?: {
							getOsSettings?: () => {
								windowPrewarmEnabled?: boolean;
							};
						};
					};
				}
			).wp?.os;
			if ( ! os?.getOsSettings?.().windowPrewarmEnabled ) {
				return;
			}
			cancel();
			dwellTimer = window.setTimeout( () => {
				dwellTimer = undefined;
				warm();
			}, DWELL_MS );
		} );
		tile.addEventListener( 'pointerleave', cancel );
		tile.addEventListener( 'pointerdown', cancel );
	}

	private prewarmNativeWindow( id: string ): void {
		if ( this.windowManager.getById( id ) ) {
			return;
		}
		const os = (
			window as unknown as {
				wp?: { os?: { prewarmWindow?: ( windowId: string ) => Promise< boolean > } };
			}
		).wp?.os;
		void os?.prewarmWindow?.( id );
	}

	private openPage( item: DockItem ): void {
		if ( item.windowId && ! item.url ) {
			const existing = this.windowManager.getById( item.windowId );
			if ( existing ) {
				const wasMinimized = existing.state === 'minimized';
				this.windowManager.focus( existing );
				if ( wasMinimized ) {
					existing.restore();
				}
				return;
			}
			const wp = ( window as unknown as {
				wp?: { os?: { openWindow?: ( id: string ) => unknown } };
			} ).wp?.os;
			wp?.openWindow?.( item.windowId );
			return;
		}

		if ( tryOpenExternalUrl( item.url ) ) {
			return;
		}

		if ( tryNativeUrlRemap( item.url ) ) {
			return;
		}

		const baseId = this.deriveWindowId( item.url );

		this.windowManager.open( {
			id: baseId,
			baseId,
			url: item.url,
			parentUrl: item.url,
			title: item.title,
			icon: item.icon.startsWith( 'dashicons-' ) ? item.icon : 'dashicons-admin-generic',
			submenu: item.submenu,
			selfLabel: item.selfLabel,
			multi: !! item.multi,
		} );
	}

	private openNewInstance( item: DockItem ): void {
		if ( tryOpenExternalUrl( item.url ) ) {
			return;
		}

		const openNewWindow = window.wp?.os?.openNewWindow;

		if ( item.windowId && ! item.url ) {
			if ( openNewWindow?.( item.windowId, { source: 'dock-peek' } ) ) {
				return;
			}
		}

		const remappedId = resolveNativeUrlRemap( item.url );
		if ( remappedId ) {
			if ( openNewWindow?.( remappedId, { source: 'dock-peek' } ) ) {
				return;
			}
		}

		const baseId = this.deriveWindowId( item.url );
		void this.windowManager.openNew( {
			id: baseId,
			baseId,
			url: item.url,
			parentUrl: item.url,
			title: item.title,
			icon: item.icon.startsWith( 'dashicons-' ) ? item.icon : 'dashicons-admin-generic',
			submenu: item.submenu,
			selfLabel: item.selfLabel,
			multi: true,
		} );
	}

	private deriveWindowId( url: string ): string {
		return deriveWindowId( url, this.adminUrl );
	}

	private resolveItemBaseId( item: DockItem ): string {
		if ( item.windowId ) {
			return item.windowId;
		}
		const remapped = resolveNativeUrlRemap( item.url );
		return remapped ?? this.deriveWindowId( item.url );
	}

	private bindWindowEvents(): void {
		const refresh = (): void => this.updateActiveStates();
		this.boundRefresh = refresh;
		document.addEventListener( 'os-window-opened', refresh );
		document.addEventListener( 'os-window-closed', refresh );
		document.addEventListener( 'os-window-focused', refresh );

		window.wp?.hooks?.addAction?.(
			'os.os.switched',
			this.hooksNamespace,
			refresh,
		);
		window.wp?.hooks?.addAction?.(
			'os.os.closed',
			this.hooksNamespace,
			refresh,
		);
		window.wp?.hooks?.addAction?.(
			HOOKS.WINDOW_MINIMIZED,
			this.hooksNamespace,
			refresh,
		);
		window.wp?.hooks?.addAction?.(
			HOOKS.WINDOW_RESTORED,
			this.hooksNamespace,
			refresh,
		);

		window.wp?.hooks?.addAction?.(
			HOOKS.DOCK_REFRESH_ACTIVE,
			this.hooksNamespace,
			refresh,
		);
	}

	public destroy(): void {
		document.removeEventListener(
			'os-window-opened',
			this.boundRefresh,
		);
		document.removeEventListener(
			'os-window-closed',
			this.boundRefresh,
		);
		document.removeEventListener(
			'os-window-focused',
			this.boundRefresh,
		);
		window.wp?.hooks?.removeAction?.(
			'os.os.switched',
			this.hooksNamespace,
		);
		window.wp?.hooks?.removeAction?.(
			'os.os.closed',
			this.hooksNamespace,
		);
		window.wp?.hooks?.removeAction?.(
			HOOKS.WINDOW_MINIMIZED,
			this.hooksNamespace,
		);
		window.wp?.hooks?.removeAction?.(
			HOOKS.DOCK_REFRESH_ACTIVE,
			this.hooksNamespace,
		);
		window.wp?.hooks?.removeAction?.(
			HOOKS.WINDOW_RESTORED,
			this.hooksNamespace,
		);
		for ( const handle of this.attentionTimers.values() ) {
			window.clearTimeout( handle );
		}
		this.attentionTimers.clear();
		for ( const teardown of this.peekTeardowns.values() ) {
			teardown();
		}
		this.peekTeardowns.clear();
		this.tooltip.remove();
		while ( this.container.firstChild ) {
			this.container.removeChild( this.container.firstChild );
		}
		this.itemElements.clear();
		this.systemItemElements.clear();
		this.systemItems = [];
		this.zones = { core: [], apps: [], controls: [] };
		this.container.removeAttribute( 'data-os-dock-placement' );
	}

	private updateActiveStates(): void {
		const focused = this.windowManager.getFocused();

		const activeDesktopId = this.windowManager.getActiveDesktopId();
		const onActiveDesktop = ( w: { config: { desktopId?: string } } ): boolean =>
			( w.config.desktopId || activeDesktopId ) === activeDesktopId;
		const isMinimized = ( w: { state?: string } ): boolean =>
			w.state === 'minimized';

		for ( const item of this.items ) {
			const tile = this.itemElements.get( item.id );
			if ( ! tile ) {
				continue;
			}

			const baseId = this.resolveItemBaseId( item );
			let instances = this.windowManager
				.getAllByBaseId( baseId )
				.filter( onActiveDesktop );
			if ( instances.length === 0 && item.url ) {
				const derivedId = this.deriveWindowId( item.url );
				instances = this.windowManager
					.getAll()
					.filter( ( w ) => {
						const wBase = w.config.baseId || w.id;
						if ( wBase === baseId || wBase === derivedId || wBase === item.id ) {
							return true;
						}

						if (
							w.config.parentUrl &&
							this.deriveWindowId( w.config.parentUrl ) === derivedId
						) {
							return true;
						}
						if ( w.config.url ) {
							const wDerived = this.deriveWindowId( w.config.url );
							return wDerived === baseId || wDerived === derivedId;
						}
						return false;
					} )
					.filter( onActiveDesktop );
			}
			const isOpen = instances.length > 0;
			const allMinimized = isOpen && instances.every( isMinimized );
			const isFocused =
				!! focused &&
				onActiveDesktop( focused ) &&
				! isMinimized( focused ) &&
				instances.some( ( w ) => w.id === focused.id || ( focused.config.baseId || focused.id ) === baseId );

			tile.classList.toggle( 'os-dock__item--active', isOpen );
			tile.classList.toggle( 'os-dock__item--focused', isFocused );
			tile.classList.toggle(
				'os-dock__item--all-minimized',
				allMinimized,
			);
			tile.classList.toggle(
				'os-dock__item--stacked',
				isOpen && instances.length > 1,
			);
		}

		for ( const sys of this.systemItems ) {
			const tile = this.systemItemElements.get( sys.id );
			if ( ! tile ) {
				continue;
			}
			const sysWin = this.windowManager.getById( sys.id );
			const isOpen = sys.isOpen ? sys.isOpen() : !! sysWin;
			const allMinimized = !! sysWin && isMinimized( sysWin );
			const isFocused =
				!! focused && focused.id === sys.id && ! isMinimized( focused );
			tile.classList.toggle( 'os-dock__item--active', isOpen );
			tile.classList.toggle( 'os-dock__item--focused', isFocused );
			tile.classList.toggle(
				'os-dock__item--all-minimized',
				allMinimized,
			);
		}

		this.updateShowDesktopBodyClass();
	}

	private updateShowDesktopBodyClass(): void {
		const activeDesktopId = this.windowManager.getActiveDesktopId();
		const live = this.windowManager
			.getAll()
			.filter(
				( w ) =>
					( w.config.desktopId || activeDesktopId ) === activeDesktopId,
			);
		const showDesktop =
			live.length > 0 && live.every( ( w ) => w.state === 'minimized' );
		document.body.classList.toggle(
			'os-show-desktop-active',
			showDesktop,
		);
	}
}

function _applyBadgeNode( host: HTMLElement, count: number ): void {
	const existing = host.querySelector< HTMLElement >(
		':scope > .os-dock__badge',
	);
	if ( count <= 0 ) {
		existing?.remove();
		return;
	}
	const display = count > 99 ? '99+' : String( count );
	if ( existing ) {
		if ( existing.textContent !== display ) {
			existing.textContent = display;
		}
		existing.setAttribute(
			'aria-label',
			sprintf(

				_n( '%d notification', '%d notifications', count ),
				count,
			),
		);
		return;
	}
	const badge = document.createElement( 'span' );
	badge.className = 'os-dock__badge';
	badge.textContent = display;
	badge.setAttribute(
		'aria-label',
		sprintf(

			_n( '%d notification', '%d notifications', count ),
			count,
		),
	);
	host.appendChild( badge );
}
