/**
 * Dock-placement section — segmented control (Bottom / Left / Right)
 * bound to `state.dockPlacement`. The shell root's
 * `data-wp-desktop-dock-placement` attribute is the single source of
 * truth that CSS reads to position the rail; `ctx.apply()` writes it.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { DOCK_PLACEMENTS } from '../constants';
import { translateDockPlacementLabel } from '../labels';
import type { DockPlacementId, SettingsCtx } from '../types';

export function buildDockPlacementSection( ctx: SettingsCtx ): HTMLElement {
	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! DOCK_PLACEMENTS.some( ( p ) => p.id === id ) ) {
			return;
		}
		ctx.state.dockPlacement = id as DockPlacementId;
		ctx.save();
		ctx.apply();
		paint();
	};

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<wpd-section
					heading=${ __( 'Dock placement' ) }
					description=${ __(
						'Which edge of the screen the dock hugs. Core and plugin menus share a single rail — this picks where it lives.',
					) }
				>
					<wpd-segmented
						value=${ ctx.state.dockPlacement }
						label=${ __( 'Dock placement' ) }
						@wpd-pick=${ onPick }
					>
						${ DOCK_PLACEMENTS.map(
							( p ) => html`<wpd-segment value=${ p.id }
									>${ translateDockPlacementLabel( p.id, p.label ) }</wpd-segment
								>`,
						) }
					</wpd-segmented>
				</wpd-section>
			`,
			wrapper,
		);
	paint();
	return wrapper;
}
