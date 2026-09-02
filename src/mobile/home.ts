/**
 * OpenStation — phone layer: the home screen.
 *
 * A grid of app tiles built from the computed navigation — the same
 * `NavResult` the dock, the sidebar and the wallpaper icons render —
 * so what the phone shows is what the user arranged, in the order
 * they arranged it. Two sections: the apps (WordPress menus, plugin
 * menus, launchers, wallpaper icons) and the system controls.
 *
 * A search field sits above the grid: an admin with thirty plugins
 * has thirty-plus tiles, and typing three letters beats scrolling.
 * Enter opens the first match.
 *
 * `homeGridItems()` and `filterByQuery()` are pure so the grid's
 * membership rules are testable without a DOM.
 */
import { __ } from '../i18n';
import type { NavItem, NavResult } from '../nav/types';

export interface HomeGridSections {
	apps: NavItem[];
	system: NavItem[];
}

/**
 * Items the phone never shows. Mio is a desk companion: it floats
 * over the wallpaper between windows, and a phone has neither a
 * wallpaper to float over nor windows to settle onto. Overview is the
 * desk's zoom-out grid; the phone's overview is the switcher, which
 * already sits in the tab bar. The ids are `MIO_TILE_ID`
 * (`src/mio/controller.ts`) and `OVERVIEW_TILE_ID`
 * (`src/dock-shell-tiles.ts`), repeated here so the phone bundle does
 * not carry those modules for two strings.
 */
export const HIDDEN_ON_PHONE: ReadonlySet< string > = new Set( [ 'os-mio-toggle', 'os-overview' ] );

/**
 * Whether a tap on this item can open anything the phone can show.
 * A system tile whose only opener is `onOpen` IS openable from the
 * phone (unlike the wallpaper icon grid, which needs a window id or
 * URL); the desk-only items in {@link HIDDEN_ON_PHONE} are not.
 */
export function isOpenable( item: NavItem ): boolean {
	if ( HIDDEN_ON_PHONE.has( item.id ) ) {
		return false;
	}
	return !! ( item.windowId || item.tile || item.menu?.url || item.entry?.url );
}

/**
 * The home grid's membership. Every surface the desktop renders is
 * folded in — rails, sidebar, wallpaper — deduplicated by id and
 * keeping the first position, with the ephemeral entries (on a rail
 * only because their window is open) left out: those belong to the
 * switcher.
 */
export function homeGridItems( nav: NavResult | null ): HomeGridSections {
	if ( ! nav ) {
		return { apps: [], system: [] };
	}
	const seen = new Set< string >();
	const take = ( lists: readonly ( readonly NavItem[] )[] ): NavItem[] => {
		const out: NavItem[] = [];
		for ( const list of lists ) {
			for ( const item of list ) {
				if ( seen.has( item.id ) || nav.ephemeral.has( item.id ) || ! isOpenable( item ) ) {
					continue;
				}
				seen.add( item.id );
				out.push( item );
			}
		}
		return out;
	};
	const apps = take( [ nav.dock.core, nav.sidebar, nav.dock.apps, nav.desktop ] );
	const system = take( [ nav.dock.controls ] );
	return { apps, system };
}

/** Case-insensitive title match; an empty query matches everything. */
export function filterByQuery( items: readonly NavItem[], query: string ): NavItem[] {
	const q = query.trim().toLocaleLowerCase();
	if ( ! q ) {
		return items.slice();
	}
	return items.filter( ( item ) => item.title.toLocaleLowerCase().includes( q ) );
}

export interface HomeDeps {
	renderIcon: ( icon: string, opts: { title: string; className?: string } ) => HTMLElement;
	getBadge: ( item: NavItem ) => number;
	onOpen: ( item: NavItem ) => void;
}

export interface HomeSurface {
	el: HTMLElement;
	/** Repaint from fresh navigation. */
	render( nav: NavResult | null ): void;
	setHidden( hidden: boolean ): void;
	/** Reset the search and scroll to the top (a fresh "home"). */
	reset(): void;
}

function badgeLabel( count: number ): string {
	return count > 99 ? '99+' : String( count );
}

export function createHome( host: HTMLElement, deps: HomeDeps ): HomeSurface {
	const el = document.createElement( 'div' );
	el.className = 'os-mobile-home';
	el.setAttribute( 'role', 'region' );
	el.setAttribute( 'aria-label', __( 'Home' ) );

	const searchWrap = document.createElement( 'div' );
	searchWrap.className = 'os-mobile-home__search';
	const search = document.createElement( 'os-text-field' );
	search.setAttribute( 'type', 'search' );
	search.setAttribute( 'placeholder', __( 'Search apps' ) );
	// The placeholder is the visible label; the name is for readers.
	search.setAttribute( 'aria-label', __( 'Search apps' ) );
	search.setAttribute( 'autocomplete', 'off' );
	searchWrap.appendChild( search );

	const scroll = document.createElement( 'div' );
	scroll.className = 'os-mobile-home__scroll';

	el.append( searchWrap, scroll );
	host.appendChild( el );

	let sections: HomeGridSections = { apps: [], system: [] };
	let query = '';

	const tile = ( item: NavItem ): HTMLElement => {
		const cell = document.createElement( 'div' );
		cell.className = 'os-mobile-grid__cell';
		cell.setAttribute( 'role', 'listitem' );
		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'os-mobile-tile';
		button.dataset.navId = item.id;
		const iconWrap = document.createElement( 'span' );
		iconWrap.className = 'os-mobile-tile__icon';
		iconWrap.appendChild(
			deps.renderIcon( item.icon, { title: item.title, className: 'os-mobile-tile__glyph' } ),
		);
		const badge = deps.getBadge( item );
		if ( badge > 0 ) {
			const pip = document.createElement( 'span' );
			pip.className = 'os-mobile-tile__badge';
			pip.textContent = badgeLabel( badge );
			pip.setAttribute( 'aria-hidden', 'true' );
			iconWrap.appendChild( pip );
		}
		const label = document.createElement( 'span' );
		label.className = 'os-mobile-tile__label';
		label.textContent = item.title;
		button.append( iconWrap, label );
		button.setAttribute(
			'aria-label',
			badge > 0 ? `${ item.title }, ${ badgeLabel( badge ) }` : item.title,
		);
		button.addEventListener( 'click', () => deps.onOpen( item ) );
		cell.appendChild( button );
		return cell;
	};

	const section = ( heading: string, items: readonly NavItem[] ): HTMLElement | null => {
		if ( items.length === 0 ) {
			return null;
		}
		const wrap = document.createElement( 'section' );
		wrap.className = 'os-mobile-home__section';
		const h = document.createElement( 'h2' );
		h.className = 'os-mobile-home__heading';
		h.textContent = heading;
		const grid = document.createElement( 'div' );
		grid.className = 'os-mobile-grid';
		grid.setAttribute( 'role', 'list' );
		for ( const item of items ) {
			grid.appendChild( tile( item ) );
		}
		wrap.append( h, grid );
		return wrap;
	};

	const paint = (): void => {
		scroll.replaceChildren();
		if ( query.trim() ) {
			const hits = filterByQuery( [ ...sections.apps, ...sections.system ], query );
			const s = section( __( 'Results' ), hits );
			if ( s ) {
				scroll.appendChild( s );
			} else {
				const empty = document.createElement( 'p' );
				empty.className = 'os-mobile-home__empty';
				empty.textContent = __( 'Nothing matches.' );
				scroll.appendChild( empty );
			}
			return;
		}
		const apps = section( __( 'Apps' ), sections.apps );
		const system = section( __( 'System' ), sections.system );
		if ( apps ) {
			scroll.appendChild( apps );
		}
		if ( system ) {
			scroll.appendChild( system );
		}
		if ( ! apps && ! system ) {
			const empty = document.createElement( 'p' );
			empty.className = 'os-mobile-home__empty';
			empty.textContent = __( 'Nothing to show yet.' );
			scroll.appendChild( empty );
		}
	};

	search.addEventListener( 'os-input-change', ( e: Event ) => {
		query = ( e as CustomEvent< { value?: string } > ).detail?.value ?? '';
		paint();
	} );
	search.addEventListener( 'os-submit', () => {
		const first = filterByQuery( [ ...sections.apps, ...sections.system ], query )[ 0 ];
		if ( first ) {
			deps.onOpen( first );
		}
	} );

	return {
		el,
		render( nav ) {
			sections = homeGridItems( nav );
			paint();
		},
		setHidden( hidden ) {
			el.hidden = hidden;
		},
		reset() {
			if ( query ) {
				query = '';
				search.setAttribute( 'value', '' );
				( search as HTMLElement & { value?: string } ).value = '';
				paint();
			}
			scroll.scrollTop = 0;
		},
	};
}
