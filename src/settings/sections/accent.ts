/**
 * Accent-color section — a row of small swatches bound to
 * `state.accent`. Selecting a new swatch updates state + applies it
 * (which writes `--wp-admin-theme-color` on the shell).
 *
 * The last swatch is Custom, and it is not one of the presets: it
 * carries {@link CUSTOM_ACCENT_ID} and opens the native colour wheel
 * on the swatch itself. A site's brand colour is rarely one of ten we
 * picked, and before this the only way to get it was a PHP filter,
 * which is not a thing you ask a person choosing a wallpaper to
 * write.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { CUSTOM_ACCENT_ID, getAccents } from '../constants';
import { translateAccentLabel } from '../labels';
import type { AccentId, SettingsCtx } from '../types';

/**
 * The Custom swatch's own face: the accent families as a colour wheel,
 * so the tile reads as "any colour" rather than as one more preset.
 * A conic gradient rather than the brand meshes, because those are
 * reserved for hero surfaces and this is a 28px chip.
 */
const CUSTOM_PREVIEW =
	'conic-gradient( #f252fc, #9af2ff, #93f0c6, #f8f2b6, #ff5a5a, #f252fc )';

export function buildAccentSection( ctx: SettingsCtx ): HTMLElement {
	// Accent-row interactions. Extracted so the template below reads as
	// pure markup — state mutation + repaint live here.
	//
	// The accent list is resolved per-paint so if PHP refreshes the
	// filtered list mid-session (rare, but possible via a live menu
	// refresh after plugin activation), the picker picks up the new
	// values on the next repaint.
	/*
	 * Opens the native colour wheel on the Custom swatch.
	 *
	 * Where the wheel appears is not something `showPicker()` takes an
	 * argument for: it is a browser popup anchored to the box of the
	 * `<input type="color">` it belongs to. So the input is laid out
	 * over the Custom swatch in CSS (`.os-settings__accent-custom`
	 * gives the cell its containing block, `.os-settings__accent-picker`
	 * fills it) and the wheel follows the swatch for free, through
	 * every window resize and grid reflow, with nothing to measure.
	 *
	 * It used to be measured and moved here instead, one line before
	 * the call, and the wheel opened under the FIRST swatch: an inline
	 * `left`/`top` written in the same tick leaves layout dirty, and
	 * the popup is placed from the box the browser has already
	 * computed: the input's static position, at the start of the row.
	 * The DOM looked correct afterwards either way, which is what made
	 * that one hard to see.
	 */
	const openWheel = (): void => {
		const input = wrapper.querySelector< HTMLInputElement >(
			'.os-settings__accent-picker',
		);
		if ( ! input ) {
			return;
		}
		try {
			input.showPicker();
		} catch {
			input.click();
		}
	};

	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if (
			id !== CUSTOM_ACCENT_ID &&
			! getAccents().some( ( a ) => a.id === id )
		) {
			return;
		}
		ctx.state.accent = id as AccentId;
		ctx.save();
		ctx.apply();
		paint();
		// Picking Custom means "I want a colour that is not here", so
		// the wheel opens on the same click, under the swatch.
		if ( id === CUSTOM_ACCENT_ID ) {
			openWheel();
		}
	};

	const onCustomColor = ( e: Event ): void => {
		const value = ( e.target as HTMLInputElement ).value;
		if ( ! /^#[0-9a-fA-F]{6}$/.test( value ) ) {
			return;
		}
		ctx.state.customAccent = value;
		// Picking a colour IS picking the custom accent. Making the user
		// choose the swatch and then the colour would leave the obvious
		// gesture doing nothing visible.
		ctx.state.accent = CUSTOM_ACCENT_ID;
		ctx.save();
		ctx.apply();
		paint();
	};

	const wrapper = document.createElement( 'div' );
	const paint = (): void => {
		const isCustom = ctx.state.accent === CUSTOM_ACCENT_ID;
		render(
			html`
				<os-section
					heading=${ __( 'Accent color' ) }
					description=${ __(
						'Used in focused window title bars, buttons, and focus rings.',
					) }
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
								variant="accent"
								?selected=${ ctx.state.accent === a.id }
							></os-swatch>`,
						) }
						<span class="os-settings__accent-custom">
							<os-swatch
								value=${ CUSTOM_ACCENT_ID }
								label=${ __( 'Custom' ) }
								preview=${ isCustom
									? ctx.state.customAccent
									: CUSTOM_PREVIEW }
								size="small"
								variant="accent"
								?selected=${ isCustom }
							></os-swatch>
							<input
								type="color"
								class="os-settings__accent-picker"
								tabindex="-1"
								aria-hidden="true"
								.value=${ ctx.state.customAccent }
								@input=${ onCustomColor }
							/>
						</span>
					</os-swatch-grid>
				</os-section>
			`,
			wrapper,
		);
	};
	paint();
	return wrapper;
}
