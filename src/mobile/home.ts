import { __ } from '../i18n';
import type { NavItem, NavResult } from '../nav/types';

export interface HomeGridSections {
	apps: NavItem[];
	system: NavItem[];
}

export const HIDDEN_ON_PHONE: ReadonlySet< string > = new Set( [
	'os-mio-toggle',
	'os-overview',
	'os-site-assistant',
] );

export function isOpenable( item: NavItem ): boolean {
	if ( HIDDEN_ON_PHONE.has( item.id ) ) {
		return false;
	}
	return !! ( item.windowId || item.tile || item.menu?.url || item.entry?.url );
}

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

	getArt?: ( item: NavItem ) => string;
	onOpen: ( item: NavItem ) => void;
}

export interface HomeSurface {
	el: HTMLElement;

	render( nav: NavResult | null ): void;
	setHidden( hidden: boolean ): void;

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

	search.setAttribute( 'aria-label', __( 'Search apps' ) );
	search.setAttribute( 'autocomplete', 'off' );
	searchWrap.appendChild( search );

	const scroll = document.createElement( 'div' );
	scroll.className = 'os-mobile-home__scroll';

	const content = document.createElement( 'div' );
	content.className = 'os-mobile-home__content';
	scroll.appendChild( content );

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
			deps.renderIcon( deps.getArt?.( item ) || item.icon, {
				title: item.title,
				className: 'os-mobile-tile__glyph',
			} ),
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
		content.replaceChildren();
		if ( query.trim() ) {
			const hits = filterByQuery( [ ...sections.apps, ...sections.system ], query );
			const s = section( __( 'Results' ), hits );
			if ( s ) {
				content.appendChild( s );
			} else {
				const empty = document.createElement( 'p' );
				empty.className = 'os-mobile-home__empty';
				empty.textContent = __( 'Nothing matches.' );
				content.appendChild( empty );
			}
			return;
		}
		const apps = section( __( 'Apps' ), sections.apps );
		const system = section( __( 'System' ), sections.system );
		if ( apps ) {
			content.appendChild( apps );
		}
		if ( system ) {
			content.appendChild( system );
		}
		if ( ! apps && ! system ) {
			const empty = document.createElement( 'p' );
			empty.className = 'os-mobile-home__empty';
			empty.textContent = __( 'Nothing to show yet.' );
			content.appendChild( empty );
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
