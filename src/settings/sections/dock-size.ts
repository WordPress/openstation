/**
 * Dock-size section — segmented control (Compact / Default / Large)
 * bound to `state.dockSize`. Writes the dock width + icon size as CSS
 * custom properties via `ctx.apply()`.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { DOCK_SIZES } from '../constants';
import { translateDockSizeLabel } from '../labels';
import type { DockSizeId, SettingsCtx } from '../types';

export function buildDockSizeSection( ctx: SettingsCtx ): HTMLElement {
	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! DOCK_SIZES.some( ( d ) => d.id === id ) ) {
			return;
		}
		ctx.state.dockSize = id as DockSizeId;
		ctx.save();
		ctx.apply();
		// `<os-segmented>` already flips its children's aria-checked
		// when its `value` changes — no explicit re-paint needed here.
		// Calling paint() still reconciles and is cheap since the
		// templater no-ops unchanged attributes.
		paint();
	};

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<os-section
					heading=${ __( 'Dock size' ) }
					description=${ __( 'Width of the dock and size of its icons.' ) }
				>
					<os-segmented
						value=${ ctx.state.dockSize }
						label=${ __( 'Dock size' ) }
						@os-pick=${ onPick }
					>
						${ DOCK_SIZES.map(
		( s ) => html`<os-segment value=${ s.id }
								>${ translateDockSizeLabel( s.id, s.label ) }</os-segment
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
