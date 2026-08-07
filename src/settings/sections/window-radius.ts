/**
 * Window-radius section — segmented control (Sharp / Default / Round)
 * bound to `state.windowRadius`. Writes the window corner radius as a
 * CSS custom property (`--os-window-radius`) via `ctx.apply()`,
 * so every open window's corners reflow live.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { WINDOW_RADII } from '../constants';
import { translateWindowRadiusLabel } from '../labels';
import type { SettingsCtx, WindowRadiusId } from '../types';

export function buildWindowRadiusSection( ctx: SettingsCtx ): HTMLElement {
	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! WINDOW_RADII.some( ( r ) => r.id === id ) ) {
			return;
		}
		ctx.state.windowRadius = id as WindowRadiusId;
		ctx.save();
		ctx.apply();
		paint();
	};

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<os-section
					heading=${ __( 'Window corners' ) }
					description=${ __( 'How rounded the corners of windows are.' ) }
				>
					<os-segmented
						value=${ ctx.state.windowRadius }
						label=${ __( 'Window corners' ) }
						@os-pick=${ onPick }
					>
						${ WINDOW_RADII.map(
		( r ) => html`<os-segment value=${ r.id }
								>${ translateWindowRadiusLabel(
			r.id,
			r.label,
		) }</os-segment
							>`,
	) }
					</os-segmented>
				</os-section>
			`,
			wrapper,
		);
	paint();
	return wrapper;
}
