/**
 * Extended Options section — admin-only, platform-wide toggles.
 *
 * Lives in the "Extended Options" tab of OS Settings. The tab itself is
 * hidden from non-admin users so the controls can't be seen (let alone
 * toggled). Values are stored in wp_options via a dedicated REST endpoint.
 *
 * Current options:
 *   - media_library_enhanced: makes every Media Library .attachment tile
 *     draggable, with rich DataTransfer types so the drag works in text
 *     fields, rich-text editors, and WP-aware drop zones.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { trackedFetch } from '../../tracked-fetch';
import type { SettingsCtx } from '../types';

interface ExtendedState {
	media_library_enhanced: boolean;
	saving: boolean;
	error: string;
}

export function buildExtendedSection( ctx: SettingsCtx ): HTMLElement {
	const { extendedOptions, extendedOptionsUrl, restNonce } = ctx.config;

	const state: ExtendedState = {
		media_library_enhanced: extendedOptions?.media_library_enhanced === true,
		saving: false,
		error: '',
	};

	const el = document.createElement( 'div' );

	const save = async (): Promise<void> => {
		if ( ! extendedOptionsUrl || ! restNonce || state.saving ) {
			return;
		}
		state.saving = true;
		state.error = '';
		paint();

		try {
			const res = await trackedFetch(
				extendedOptionsUrl,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': restNonce,
					},
					body: JSON.stringify( {
						options: {
							media_library_enhanced: state.media_library_enhanced,
						},
					} ),
				},
				{ source: 'desktop-mode/settings/extended' },
			);

			if ( ! res.ok ) {
				const err = await res.json().catch( () => ( {} ) ) as { message?: string };
				state.error = err.message ?? `Error ${ res.status }`;
			} else {
				const saved = await res.json().catch( () => null );
				if ( saved && typeof saved === 'object' ) {
					ctx.config.extendedOptions = saved as typeof extendedOptions;
				}
			}
		} catch {
			state.error = __( 'Network error — check your connection.' );
		} finally {
			state.saving = false;
			paint();
		}
	};

	const onMediaToggle = ( e: Event ): void => {
		state.media_library_enhanced = ( e as CustomEvent ).detail?.checked === true;
		save();
	};

	const paint = (): void =>
		render(
			html`
				<wpd-section
					heading=${ __( 'Extended options' ) }
					description=${ __(
						'Site-wide enhancements that apply to every user. Toggling requires the affected page to be reloaded for the change to take effect.',
					) }
				>
					<wpd-checkbox-label
						label=${ __( 'Enable drag-and-drop in the Media Library' ) }
						?checked=${ state.media_library_enhanced }
						@wpd-checkbox-change=${ onMediaToggle }
					></wpd-checkbox-label>

					<p class="desktop-mode-ext__hint">
						${ __(
							'Makes every item in the WordPress Media Library draggable. Drop a media item into text fields, rich-text editors, Gutenberg blocks, or any target that accepts images or files. No replacement of the library — just a drag-and-drop layer on top of the one you already know.',
						) }
					</p>

					${ state.error
						? html`<p class="desktop-mode-ext__error">${ state.error }</p>`
						: html`` }
					${ state.saving
						? html`<p class="desktop-mode-ext__saving">${ __( 'Saving…' ) }</p>`
						: html`` }
				</wpd-section>
			`,
			el,
		);

	paint();
	return el;
}
