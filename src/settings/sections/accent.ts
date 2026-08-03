/**
 * Accent-color section — a row of small swatches bound to
 * `state.accent`. Selecting a new swatch updates state + applies it
 * (which writes `--wp-admin-theme-color` on the shell).
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { getAccents } from '../constants';
import { translateAccentLabel } from '../labels';
import type { AccentId, SettingsCtx } from '../types';

export function buildAccentSection( ctx: SettingsCtx ): HTMLElement {
	// Accent-row interactions. Extracted so the template below reads as
	// pure markup — state mutation + repaint live here.
	//
	// The accent list is resolved per-paint so if PHP refreshes the
	// filtered list mid-session (rare, but possible via a live menu
	// refresh after plugin activation), the picker picks up the new
	// values on the next repaint.
	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! getAccents().some( ( a ) => a.id === id ) ) {
			return;
		}
		ctx.state.accent = id as AccentId;
		ctx.save();
		ctx.apply();
		paint();
	};

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<os-section
					heading=${ __( 'Accent color' ) }
					description=${ __( 'Used in focused window title bars, buttons, and focus rings.' ) }
				>
					<os-swatch-grid
						label=${ __( 'Accent color' ) }
						mode="row"
						@os-pick=${ onPick }
					>
						${ getAccents().map(
		( a ) => html`<os-swatch
								value=${ a.id }
								label=${ translateAccentLabel( a.id, a.label ) }
								preview=${ a.value }
								size="small"
								?selected=${ ctx.state.accent === a.id }
							></os-swatch>`,
	) }
					</os-swatch-grid>
				</os-section>
			`,
			wrapper,
		);
	paint();
	return wrapper;
}
