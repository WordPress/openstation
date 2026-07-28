/**
 * Window-radius section — segmented control (Sharp / Default / Round)
 * bound to `state.windowRadius`. Writes the window corner radius as a
 * CSS custom property (`--desktop-mode-window-radius`) via `ctx.apply()`,
 * so every open window's corners reflow live.
 *
 * **When a desktop theme pins that same token, the theme wins** — its
 * compiled rule matches the shell root directly, while this preset is
 * an inline style on `<html>` that only reaches windows by
 * inheritance. Rather than leave a control that silently does
 * nothing, the picker disables itself and names the theme that took
 * the value over.
 */

import { __, sprintf } from '../../i18n';
import { html, render } from '../../ui/core';
import {
	findThemeTokenOverride,
	WINDOW_RADIUS_TOKEN,
} from '../../desktop-themes/token-overrides';
import { subscribeDesktopThemes } from '../../desktop-themes/registry';
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
	const paint = (): void => {
		const override = findThemeTokenOverride( WINDOW_RADIUS_TOKEN );
		render(
			html`
				<wpd-section
					heading=${ __( 'Window corners' ) }
					description=${ __( 'How rounded the corners of windows are.' ) }
				>
					<wpd-segmented
						value=${ ctx.state.windowRadius }
						label=${ __( 'Window corners' ) }
						?disabled=${ override !== null }
						@wpd-pick=${ onPick }
					>
						${ WINDOW_RADII.map(
		( r ) => html`<wpd-segment value=${ r.id }
								>${ translateWindowRadiusLabel(
			r.id,
			r.label,
		) }</wpd-segment
							>`,
	) }
					</wpd-segmented>
					${ override !== null
		? html`<wpd-notice tone="info">
								${ sprintf(
			/* translators: %s: desktop theme name. */
			__(
				'“%s” sets the window corner radius itself, so this preset has no effect while it is active. Switch to System default in Themes to choose your own.',
			),
			override.theme.name,
		) }
							</wpd-notice>`
		: '' }
				</wpd-section>
			`,
			wrapper,
		);
	};
	paint();

	// Switching desktop theme changes who owns the radius, so the
	// control has to re-evaluate. The `isConnected` guard keeps a
	// closed Settings window's stale subscriber from painting into a
	// detached tree — same pattern as the Themes section.
	const unsubscribe = subscribeDesktopThemes( () => {
		if ( ! wrapper.isConnected ) {
			unsubscribe();
			return;
		}
		paint();
	} );

	return wrapper;
}
