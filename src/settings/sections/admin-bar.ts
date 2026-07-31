/**
 * Admin-bar section — segmented control (Static / Dynamic / Hidden)
 * bound to `state.adminBarMode`. The pick is written as a
 * `desktop-mode-admin-bar-<mode>` body class by `ctx.apply()`, which
 * is what `desktop.css` keys off to place, auto-hide, or remove the
 * WordPress admin bar above the shell.
 *
 * `Hidden` takes away the admin bar's "Switch to Classic Admin"
 * toggle, so the description names the replacement route out — the
 * "Exit Desktop Mode" tile on the dock (`src/exit-desktop-mode.ts`),
 * which is always present on the core rail.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { ADMIN_BAR_MODES } from '../constants';
import { translateAdminBarModeLabel } from '../labels';
import type { AdminBarModeId, SettingsCtx } from '../types';

/** Per-mode helper copy, shown under the segmented control. */
function describe( id: AdminBarModeId ): string {
	switch ( id ) {
		case 'dynamic':
			return __(
				'The admin bar slides out of the way and comes back when you move the pointer to the top edge of the screen.',
			);
		case 'hidden':
			return __(
				'The admin bar is never shown. Use the Exit Desktop Mode tile on the dock to get back to the classic admin.',
			);
		default:
			return __( 'The admin bar is always visible above the desktop.' );
	}
}

export function buildAdminBarSection( ctx: SettingsCtx ): HTMLElement {
	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! ADMIN_BAR_MODES.some( ( m ) => m.id === id ) ) {
			return;
		}
		ctx.state.adminBarMode = id as AdminBarModeId;
		ctx.save();
		ctx.apply();
		paint();
	};

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<wpd-section
					heading=${ __( 'Admin bar' ) }
					description=${ describe( ctx.state.adminBarMode ) }
				>
					<wpd-segmented
						value=${ ctx.state.adminBarMode }
						label=${ __( 'Admin bar' ) }
						@wpd-pick=${ onPick }
					>
						${ ADMIN_BAR_MODES.map(
		( m ) => html`<wpd-segment value=${ m.id }
								>${ translateAdminBarModeLabel(
			m.id,
			m.label,
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
