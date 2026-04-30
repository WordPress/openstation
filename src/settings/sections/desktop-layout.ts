/**
 * Desktop-layout section — segmented control (Classic / Unified /
 * Spatial) bound to `state.desktopLayout`. The shell root's
 * `data-wp-desktop-layout` attribute is the single source of truth
 * the layout dispatcher reads to rebuild the dock(s) and (for
 * Spatial) the synthesized desktop icons.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { DESKTOP_LAYOUTS } from '../constants';
import {
	translateDesktopLayoutDescription,
	translateDesktopLayoutLabel,
} from '../labels';
import type { DesktopLayoutId, SettingsCtx } from '../types';

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

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<wpd-section
					heading=${ __( 'Desktop layout' ) }
					description=${ translateDesktopLayoutDescription(
						ctx.state.desktopLayout,
					) }
				>
					<wpd-segmented
						value=${ ctx.state.desktopLayout }
						label=${ __( 'Desktop layout' ) }
						@wpd-pick=${ onPick }
					>
						${ DESKTOP_LAYOUTS.map(
							( l ) => html`<wpd-segment value=${ l.id }
									>${ translateDesktopLayoutLabel(
										l.id,
										l.label,
									) }</wpd-segment
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
