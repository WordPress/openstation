/**
 * Close-all-windows section — the way back from "Don't ask again".
 *
 * The `⌥⌘W` / `Ctrl+Alt+W` shortcut asks before it wipes the desk, and
 * its confirmation carries a "Don't ask again" checkbox. Ticking that
 * box is the only thing in the shell that writes
 * `confirmCloseAllWindows: false` — so without this toggle the opt-out
 * would be one-way, which makes it a trap rather than a preference.
 *
 * Nothing here calls `ctx.apply()`: the shortcut reads the state at
 * press time, so there is no CSS or layout to repaint.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import type { SettingsCtx } from '../types';

export function buildCloseAllSection( ctx: SettingsCtx ): HTMLElement {
	const onToggle = ( e: Event ): void => {
		ctx.state.confirmCloseAllWindows =
			( e as CustomEvent ).detail?.checked === true;
		ctx.save();
		paint();
	};

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<os-section
					heading=${ __( 'Closing every window' ) }
					description=${ __(
						'⌥⌘W on macOS, Ctrl+Alt+W elsewhere, closes every open window on every desktop. Unticked, it closes them without asking — a page holding unsaved changes still gets to raise its own prompt.',
					) }
				>
					<os-checkbox-label
						label=${ __( 'Ask before closing all windows' ) }
						?checked=${ ctx.state.confirmCloseAllWindows }
						@os-checkbox-change=${ onToggle }
					></os-checkbox-label>
				</os-section>
			`,
			wrapper,
		);
	paint();
	return wrapper;
}
