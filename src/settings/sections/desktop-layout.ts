/**
 * Desktop-layout section — where navigation lives.
 *
 * Two controls, one section builder, because they answer one question
 * between them and the second only makes sense in the light of the
 * first:
 *
 *   - **Desktop layout** (One dock / Side bar / Spatial) bound to
 *     `state.desktopLayout`. The shell root's `data-os-layout`
 *     attribute is the single source of truth the layout dispatcher
 *     reads to rebuild the dock(s) and (for Spatial) the synthesized
 *     desktop icons.
 *   - **Dock position** (Bottom / Left / Right) bound to
 *     `state.dockPlacement`, rendered only for the one-rail layouts.
 *     Side bar has two rails whose edges ARE the layout, so there is
 *     nothing to move there and the control is not painted — a
 *     disabled segmented bar would just be a puzzle. Keeping both in
 *     one builder is what makes that appear and disappear on the same
 *     repaint as the layout pick.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { DESKTOP_LAYOUTS, DOCK_PLACEMENTS } from '../constants';
import {
	translateDesktopLayoutDescription,
	translateDesktopLayoutLabel,
	translateDockPlacementLabel,
} from '../labels';
import type {
	DesktopLayoutId,
	DockPlacementId,
	SettingsCtx,
} from '../types';

export function buildDesktopLayoutSection( ctx: SettingsCtx ): HTMLElement {
	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! DESKTOP_LAYOUTS.some( ( l ) => l.id === id ) ) {
			return;
		}
		ctx.state.desktopLayout = id as DesktopLayoutId;
		ctx.save();
		ctx.apply();
		paint();
	};

	const onPickPlacement = ( e: Event ): void => {
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
				<os-section
					heading=${ __( 'Desktop layout' ) }
					description=${ translateDesktopLayoutDescription(
						ctx.state.desktopLayout,
					) }
				>
					<os-segmented
						value=${ ctx.state.desktopLayout }
						label=${ __( 'Desktop layout' ) }
						@os-pick=${ onPick }
					>
						${ DESKTOP_LAYOUTS.map(
							( l ) => html`<os-segment value=${ l.id }
									>${ translateDesktopLayoutLabel(
										l.id,
										l.label,
									) }</os-segment
								>`,
						) }
					</os-segmented>
				</os-section>
				${ 'classic' === ctx.state.desktopLayout
					? ''
					: html`
							<os-section
								heading=${ __( 'Dock position' ) }
								description=${ __(
									'Which edge of the screen the dock sits on.',
								) }
							>
								<os-segmented
									value=${ ctx.state.dockPlacement }
									label=${ __( 'Dock position' ) }
									@os-pick=${ onPickPlacement }
								>
									${ DOCK_PLACEMENTS.map(
										( p ) => html`<os-segment
												value=${ p.id }
												>${ translateDockPlacementLabel(
													p.id,
													p.label,
												) }</os-segment
											>`,
									) }
								</os-segmented>
							</os-section>
					  ` }
			`,
			wrapper,
		);
	paint();
	return wrapper;
}
