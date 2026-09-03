/**
 * OpenStation — phone layer: the bottom tab bar.
 *
 * Five slots, thumb-reachable: Home, up to three pinned apps, and the
 * app switcher. The pins come from the user's `mobileTabs` setting,
 * else from the server's `openstation_mobile_tab_bar` filter; empty
 * slots fill from the navigation's own order so the bar is never
 * half-empty. `resolveTabBarItems()` is the pure rule.
 *
 * The bar also owns one gesture: a flick up opens the switcher
 * (`bindSwipeUp`, wired by the layer).
 */
import { __, sprintf } from '../i18n';
import type { NavItem, NavResult } from '../nav/types';
import { osIcon } from '../ui/icons';
import { deriveWindowId } from '../utils';
import { isOpenable } from './home';

/** Pins the bar can hold beside Home and the switcher. */
export const TAB_BAR_MAX_PINS = 3;

/**
 * The window id a navigation item opens, so the bar can mark the
 * tab of the focused window. `null` for a tile with only an
 * `onOpen` — the bar cannot know what that opens.
 */
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

/**
 * Which items sit in the pinned slots. Pinned ids, in their order,
 * when they exist, are openable and are not locked (Exit OpenStation
 * is never a tab). A pin the user (or the server default) chose is
 * the whole answer: one pin means one tab, never one pin plus two
 * the bar picked on its own — that is how ticking Posts once made
 * Dashboard appear. Only when NO pin resolves at all does the
 * navigation's own order — core menus, sidebar, apps — fill the bar,
 * so a site whose defaults are all missing still gets one.
 */
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
	/** `'home'`, `'switcher'`, a pinned item's id, or `null`. */
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
		// With something open the glyph IS the count, in a rounded
		// square (the browser tab-switcher convention); with nothing
		// open the windows icon stands in for it.
		switcherIcon?.classList.toggle( 'os-mobile-tabs__icon--counted', state.openCount > 0 );
		if ( switcherButton ) {
			switcherButton.setAttribute(
				'aria-label',
				sprintf(
					/* translators: %d: number of open apps. */
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

			// "Open apps", the same words as the sheet it opens: the Home
			// grid already has a section called Apps, and one word for
			// both was what made the switcher hard to find.
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
