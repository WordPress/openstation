/**
 * Extended Options section — admin-only, platform-wide toggles.
 *
 * Renders at the bottom of the "Features" tab of OS Settings. The panel
 * only builds the section for admin users so the controls can't be seen
 * (let alone toggled) by anyone else. Values are stored in wp_options
 * via a dedicated REST endpoint.
 *
 * Current options:
 *   - media_library_enhanced: makes every Media Library .attachment tile
 *     draggable, with rich DataTransfer types so the drag works in text
 *     fields, rich-text editors, and WP-aware drop zones.
 *   - games: the games framework, off by default (opt-in). While off,
 *     the server loads none of the games module (no window/icon, no
 *     REST routes, no Heartbeat channel) and the shell skips the
 *     challenges client.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { trackedFetch } from '../../tracked-fetch';
import type { SettingsCtx } from '../types';

interface ExtendedState {
	media_library_enhanced: boolean;
	games: boolean;
	agents: boolean;
	saving: boolean;
	error: string;
}

export function buildExtendedSection( ctx: SettingsCtx ): HTMLElement {
	const { extendedOptions, extendedOptionsUrl, restNonce } = ctx.config;

	const state: ExtendedState = {
		media_library_enhanced: extendedOptions?.media_library_enhanced === true,
		games: extendedOptions?.games === true,
		agents: extendedOptions?.agents === true,
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
							games: state.games,
							agents: state.agents,
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

	const onGamesToggle = ( e: Event ): void => {
		state.games = ( e as CustomEvent ).detail?.checked === true;
		save();
	};

	const onAgentsToggle = ( e: Event ): void => {
		state.agents = ( e as CustomEvent ).detail?.checked === true;
		save();
	};

	const paint = (): void =>
		render(
			html`
				<os-section
					heading=${ __( 'Extended options' ) }
					description=${ __(
						'Site-wide enhancements that apply to every user. Toggling requires the affected page to be reloaded for the change to take effect.',
					) }
				>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Enable drag-and-drop in the Media Library' ) }
							?checked=${ state.media_library_enhanced }
							@os-checkbox-change=${ onMediaToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Makes every item in the WordPress Media Library draggable. Drop a media item into text fields, rich-text editors, Gutenberg blocks, or any target that accepts images or files. No replacement of the library — just a drag-and-drop layer on top of the one you already know.',
							) }
						</p>
					</div>

					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Enable games' ) }
							?checked=${ state.games }
							@os-checkbox-change=${ onGamesToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Adds a Games app for every user: built-in games, scoreboards, and player-to-player challenges. Off by default — while off, nothing game-related runs anywhere, on the server or in the browser. Saved scores are kept across a disable and reappear when re-enabled.',
							) }
						</p>
					</div>

					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Enable AI agents' ) }
							?checked=${ state.agents }
							@os-checkbox-change=${ onAgentsToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Adds an Agents section to WP Explorer: durable AI workers that live on the site as login-blocked users, act through the WordPress Abilities API under their own role, and answer in a chat window. Requires a configured AI connector to run. Off by default — while off, nothing agent-related loads. Agent definitions are kept across a disable and reappear when re-enabled.',
							) }
						</p>
					</div>

					${ state.error
						? html`<p class="os-ext__error">${ state.error }</p>`
						: html`` }
					${ state.saving
						? html`<p class="os-ext__saving">${ __( 'Saving…' ) }</p>`
						: html`` }
				</os-section>
			`,
			el,
		);

	paint();
	return el;
}
