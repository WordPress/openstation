/**
 * Mobile — when the phone layer renders, and what its tab bar holds.
 *
 * Two controls, both plain settings-store writes: the layout
 * override (`mobileLayout`) and the pinned tabs (`mobileTabs`, at
 * most three). The pin list is drawn from the same navigation items
 * the Navigation page lists, minus the ones a tab cannot stand for.
 */

import { __, html, sprintf } from '@openstation/app';
import { readNavItems } from '../../../src/nav/config';
import type { NavItem } from '../../../src/nav/types';
import { TAB_BAR_MAX_PINS } from '../../../src/mobile/tab-bar';
import { shellConfig, update } from './store';
import { pickedChecked, pickedValue, type Ctx, type Section } from './types';

const LAYOUTS = [
	{ id: 'auto', label: () => __( 'Automatic' ) },
	{ id: 'desktop', label: () => __( 'Always desktop' ) },
	{ id: 'mobile', label: () => __( 'Always mobile' ) },
] as const;

type LayoutId = ( typeof LAYOUTS )[ number ][ 'id' ];

/** Items a tab can stand for: something that opens, and not the exit. */
function pinnable( items: readonly NavItem[] ): NavItem[] {
	return items.filter(
		( item ) =>
			! item.locked &&
			! item.transient &&
			!! ( item.windowId || item.tile || item.menu?.url || item.entry?.url ),
	);
}

export const renderMobile: Section = ( s, _ctx: Ctx ) => {
	const items = pinnable( readNavItems() );
	// What the bar actually renders: the user's pins, else the server
	// default — narrowed to items this site has, so the checked rows
	// are exactly the tabs. The first toggle starts from that list,
	// so unticking a default keeps the other two.
	const known = new Set( items.map( ( i ) => i.id ) );
	const fallback = ( shellConfig().mode?.tabBar ?? [] ).filter( ( id ) => known.has( id ) );
	const pinned = ( s.mobileTabs.length > 0 ? s.mobileTabs : fallback ).slice( 0, TAB_BAR_MAX_PINS );
	const full = pinned.length >= TAB_BAR_MAX_PINS;

	const onLayout = ( e: Event ): void => {
		const id = pickedValue( e );
		if ( LAYOUTS.some( ( l ) => l.id === id ) ) {
			update( { mobileLayout: id as LayoutId } );
		}
	};

	const togglePin = ( id: string ) => ( e: Event ): void => {
		const on = pickedChecked( e );
		const next = pinned.filter( ( p ) => p !== id );
		if ( on && next.length < TAB_BAR_MAX_PINS ) {
			next.push( id );
		}
		update( { mobileTabs: next } );
	};

	return html`
		<os-section
			heading=${ __( 'Layout' ) }
			description=${ __( 'Automatic follows the screen: phones get the phone layer, everything wider gets the desktop. Force either to preview or to opt out.' ) }
		>
			<os-segmented value=${ s.mobileLayout } label=${ __( 'Mobile layout' ) } @os-pick=${ onLayout }>
				${ LAYOUTS.map( ( l ) => html`<os-segment value=${ l.id }>${ l.label() }</os-segment>` ) }
			</os-segmented>
		</os-section>

		<os-section
			heading=${ __( 'Tab bar' ) }
			description=${ sprintf(
				/* translators: %d: number of pinnable slots. */
				__( 'Home and the app switcher are always there. Pin up to %d apps between them; leave it empty for the default set.' ),
				TAB_BAR_MAX_PINS,
			) }
		>
			${ items.length === 0
				? html`<p class="os-features__hint">${ __( 'Nothing to pin yet.' ) }</p>`
				: items.map( ( item ) => {
					const checked = pinned.includes( item.id );
					return html`
						<div class="os-features__item">
							<os-checkbox-label
								label=${ item.title }
								?checked=${ checked }
								?disabled=${ ! checked && full }
								@os-checkbox-change=${ togglePin( item.id ) }
							></os-checkbox-label>
						</div>
					`;
				} ) }
		</os-section>
	`;
};
