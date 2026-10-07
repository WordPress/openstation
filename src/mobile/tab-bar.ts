import { __, sprintf } from '../i18n';
import type { NavItem, NavResult } from '../nav/types';
import { osIcon } from '../ui/icons';
import { deriveWindowId } from '../utils';
import { isOpenable } from './home';

export const TAB_BAR_MAX_PINS = 3;

export function navItemWindowId( item: NavItem, adminUrl: string ): string | null {
	if ( item.windowId ) {
		return item.windowId;
	}
	const url = item.menu?.url || item.entry?.url;
	if ( ! url ) {
		return null;
	}
	try {
		return deriveWindowId( url, adminUrl );
	} catch {
		return null;
	}
}

export function resolveTabBarItems(
	nav: NavResult | null,
	pinnedIds: readonly string[],
	max: number = TAB_BAR_MAX_PINS,
): NavItem[] {
	if ( ! nav || max <= 0 ) {
		return [];
	}
	const all = [ ...nav.dock.core, ...nav.sidebar, ...nav.dock.apps, ...nav.desktop ];
	const byId = new Map< string, NavItem >();
	for ( const item of all ) {
		if ( ! byId.has( item.id ) ) {
			byId.set( item.id, item );
		}
	}
	const eligible = ( item: NavItem | undefined ): item is NavItem =>
		!! item && ! item.locked && ! nav.ephemeral.has( item.id ) && isOpenable( item );

	const out: NavItem[] = [];
	const taken = new Set< string >();
	for ( const id of pinnedIds ) {
		const item = byId.get( id );
		if ( eligible( item ) && ! taken.has( item.id ) ) {
			taken.add( item.id );
			out.push( item );
			if ( out.length >= max ) {
				return out;
			}
		}
	}
	if ( out.length > 0 ) {
		return out;
	}
	for ( const item of all ) {
		if ( out.length >= max ) {
			break;
		}
		if ( eligible( item ) && ! taken.has( item.id ) ) {
			taken.add( item.id );
			out.push( item );
		}
	}
	return out;
}

export interface TabBarDeps {
	renderIcon: ( icon: string, opts: { title: string; className?: string } ) => HTMLElement;
	getBadge: ( item: NavItem ) => number;
	onHome: () => void;
	onSwitcher: () => void;
	onOpen: ( item: NavItem ) => void;
}

export interface TabBarState {

	active: string | null;
	openCount: number;
}

export interface TabBarSurface {
	el: HTMLElement;
	render( items: readonly NavItem[], state: TabBarState ): void;
	setState( state: TabBarState ): void;
}

export function createTabBar( host: HTMLElement, deps: TabBarDeps ): TabBarSurface {
	const el = document.createElement( 'nav' );
	el.className = 'os-mobile-tabs';
	el.setAttribute( 'aria-label', __( 'Primary' ) );
	host.appendChild( el );

	let buttons: HTMLButtonElement[] = [];
	let countEl: HTMLElement | null = null;
	let switcherButton: HTMLButtonElement | null = null;
	let switcherIcon: HTMLElement | null = null;

	const button = ( id: string, label: string, glyph: Node ): HTMLButtonElement => {
		const b = document.createElement( 'button' );
		b.type = 'button';
		b.className = 'os-mobile-tabs__item';
		b.dataset.tab = id;
		const icon = document.createElement( 'span' );
		icon.className = 'os-mobile-tabs__icon';
		icon.appendChild( glyph );
		const text = document.createElement( 'span' );
		text.className = 'os-mobile-tabs__label';
		text.textContent = label;
		b.append( icon, text );
		return b;
	};

	const applyState = ( state: TabBarState ): void => {
		for ( const b of buttons ) {
			const current = b.dataset.tab === state.active;
			if ( current ) {
				b.setAttribute( 'aria-current', 'page' );
			} else {
				b.removeAttribute( 'aria-current' );
			}
		}
		if ( countEl ) {
			countEl.hidden = state.openCount === 0;
			countEl.textContent = countEl.hidden ? '' : String( Math.min( state.openCount, 99 ) );
		}

		switcherIcon?.classList.toggle( 'os-mobile-tabs__icon--counted', state.openCount > 0 );
		if ( switcherButton ) {
			switcherButton.setAttribute(
				'aria-label',
				sprintf(

					__( 'Open apps (%d)' ),
					state.openCount,
				),
			);
		}
	};

	return {
		el,
		render( items, state ) {
			el.replaceChildren();
			buttons = [];

			const home = button( 'home', __( 'Home' ), osIcon( 'apps', { size: 22 } ) );
			home.addEventListener( 'click', deps.onHome );
			buttons.push( home );

			for ( const item of items ) {
				const b = button(
					item.id,
					item.title,
					deps.renderIcon( item.icon, { title: item.title, className: 'os-mobile-tabs__glyph' } ),
				);
				const badge = deps.getBadge( item );
				if ( badge > 0 ) {
					const pip = document.createElement( 'span' );
					pip.className = 'os-mobile-tabs__badge';
					pip.textContent = badge > 99 ? '99+' : String( badge );
					pip.setAttribute( 'aria-hidden', 'true' );
					b.querySelector( '.os-mobile-tabs__icon' )?.appendChild( pip );
					b.setAttribute( 'aria-label', `${ item.title }, ${ badge > 99 ? '99+' : badge }` );
				}
				b.addEventListener( 'click', () => deps.onOpen( item ) );
				buttons.push( b );
			}

			switcherButton = button( 'switcher', __( 'Open apps' ), osIcon( 'windows', { size: 22 } ) );
			switcherIcon = switcherButton.querySelector< HTMLElement >( '.os-mobile-tabs__icon' );
			countEl = document.createElement( 'span' );
			countEl.className = 'os-mobile-tabs__count';
			countEl.setAttribute( 'aria-hidden', 'true' );
			switcherIcon?.appendChild( countEl );
			switcherButton.addEventListener( 'click', deps.onSwitcher );
			buttons.push( switcherButton );

			el.append( ...buttons );
			applyState( state );
		},
		setState: applyState,
	};
}
