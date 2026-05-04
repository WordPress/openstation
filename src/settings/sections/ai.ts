/**
 * AI Settings section.
 *
 * Two sub-sections:
 *
 *   1. Personal — per-user toggle + provider + API key, stored in OS
 *      settings user meta via ctx.save(). Always visible. When a platform
 *      key is already configured, this acts as an optional personal override.
 *
 *   2. Global settings (admin only) — platform-wide toggle + provider +
 *      API key, stored in wp_options via a dedicated REST endpoint.
 *      Only rendered when ctx.config.isAdmin is true. Applies to all
 *      users and to background jobs (cron, WP-CLI, anonymous comments).
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { AI_TRANSPORTS, getAiProviders } from '../constants';
import type { AiTransportId, SettingsCtx } from '../types';

// ---------------------------------------------------------------------------
// Personal settings
// ---------------------------------------------------------------------------

export function buildAiSection( ctx: SettingsCtx ): HTMLElement {
	const wrapper = document.createElement( 'div' );

	const onToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.ai = { ...ctx.state.ai, enabled: checked };
		ctx.save();
		paint();
	};

	const onProvider = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! getAiProviders().some( ( p ) => p.id === id ) ) {
			return;
		}
		// Stash the current key under the previous provider before switching
		// so each provider keeps its own key even if the user toggles back.
		const prev = ctx.state.ai.provider;
		const apiKeys = { ...( ctx.state.ai.apiKeys ?? {} ) };
		if ( ctx.state.ai.apiKey ) {
			apiKeys[ prev ] = ctx.state.ai.apiKey;
		}
		ctx.state.ai = {
			...ctx.state.ai,
			provider: id,
			apiKeys,
			apiKey: apiKeys[ id ] ?? '',
		};
		ctx.save();
		paint();
	};

	const onApiKey = ( e: Event ): void => {
		const value = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		const apiKeys = { ...( ctx.state.ai.apiKeys ?? {} ) };
		apiKeys[ ctx.state.ai.provider ] = value;
		ctx.state.ai = { ...ctx.state.ai, apiKey: value, apiKeys };
		ctx.save();
	};

	const onTransport = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! AI_TRANSPORTS.some( ( t ) => t.id === id ) ) {
			return;
		}
		ctx.state.ai = { ...ctx.state.ai, transport: id as AiTransportId };
		ctx.save();
	};

	const paint = (): void => {
		const platformEnabled =
			ctx.config.aiPlatformSettings?.enabled === true &&
			!! ctx.config.aiPlatformSettings?.apiKey;
		const activeProvider =
			getAiProviders().find( ( p ) => p.id === ctx.state.ai.provider ) ?? getAiProviders()[ 0 ];
		const apiKeyLabel = activeProvider?.apiKeyLabel ?? __( 'API key' );

		render(
			html`
				<wpd-section
					heading=${ __( 'AI integration' ) }
					description=${ platformEnabled
						? __( 'A platform-wide AI key is configured. You can optionally set a personal key below to override it.' )
						: __( 'Connect an AI provider to power assistive features across the desktop.' ) }
				>
					<wpd-checkbox-label
						label=${ __( 'Enable AI features' ) }
						?checked=${ ctx.state.ai.enabled }
						@wpd-checkbox-change=${ onToggle }
					></wpd-checkbox-label>

					<wpd-select
						label=${ __( 'Provider' ) }
						value=${ ctx.state.ai.provider }
						?disabled=${ ! ctx.state.ai.enabled }
						@wpd-pick=${ onProvider }
					>
						${ getAiProviders().map(
							( p ) => html`<wpd-option value=${ p.id }>${ p.label }</wpd-option>`,
						) }
					</wpd-select>

					<wpd-text-field
						label=${ apiKeyLabel }
						type="password"
						reveal
						autocomplete="off"
						placeholder=${ platformEnabled
							? __( 'Using platform key — enter to override' )
							: __( 'sk-…' ) }
						value=${ ctx.state.ai.apiKey }
						?disabled=${ ! ctx.state.ai.enabled }
						@wpd-input-change=${ onApiKey }
					></wpd-text-field>

					<wpd-select
						label=${ __( 'Live progress updates' ) }
						value=${ ctx.state.ai.transport }
						?disabled=${ ! ctx.state.ai.enabled }
						@wpd-pick=${ onTransport }
					>
						${ AI_TRANSPORTS.map(
							( t ) => html`<wpd-option value=${ t.id }>${ t.label }</wpd-option>`,
						) }
					</wpd-select>
					<p class="desktop-mode-ext__hint">
						${ __( 'How the assistant streams progress while it works. Pick Off if your host blocks long-lived connections (e.g. you see "Lost connection to the assistant" errors).' ) }
					</p>
				</wpd-section>

				${ ctx.config.isAdmin ? _buildGlobalSection( ctx ) : html`` }
			`,
			wrapper,
		);
	};

	paint();
	return wrapper;
}

// ---------------------------------------------------------------------------
// Global (platform) settings — admin only
// ---------------------------------------------------------------------------

interface PlatformState {
	enabled: boolean;
	provider: string;
	apiKey: string;
	saving: boolean;
	error: string;
}

function _buildGlobalSection( ctx: SettingsCtx ): HTMLElement {
	const { aiPlatformSettingsUrl: url, restNonce: nonce, aiPlatformSettings: initial } =
		ctx.config;

	const state: PlatformState = {
		enabled: initial?.enabled ?? false,
		provider: initial?.provider ?? 'openai',
		apiKey: initial?.apiKey ?? '',
		saving: false,
		error: '',
	};

	const el = document.createElement( 'div' );

	const save = async (): Promise<void> => {
		if ( ! url || ! nonce || state.saving ) {
			return;
		}
		state.saving = true;
		state.error = '';
		paint();

		try {
			const res = await fetch( url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': nonce,
				},
				body: JSON.stringify( {
					settings: {
						enabled: state.enabled,
						provider: state.provider,
						apiKey: state.apiKey,
					},
				} ),
			} );

			if ( ! res.ok ) {
				const err = await res.json().catch( () => ( {} ) ) as { message?: string };
				state.error = err.message ?? `Error ${ res.status }`;
			} else {
				// Reflect saved values back into ctx.config so the
				// personal section description updates immediately.
				const saved = await res.json().catch( () => null );
				if ( saved && typeof saved === 'object' ) {
					ctx.config.aiPlatformSettings = saved as typeof initial;
				}
			}
		} catch {
			state.error = __( 'Network error — check your connection.' );
		} finally {
			state.saving = false;
			paint();
		}
	};

	const onToggle = ( e: Event ): void => {
		state.enabled = ( e as CustomEvent ).detail?.checked === true;
		save();
	};

	const onProvider = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! getAiProviders().some( ( p ) => p.id === id ) ) {
			return;
		}
		state.provider = id;
		save();
	};

	const onApiKey = ( e: Event ): void => {
		state.apiKey = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
	};

	const onApiKeyCommit = (): void => {
		save();
	};

	const paint = (): void =>
		render(
			html`
				<wpd-section
					heading=${ __( 'Global settings' ) }
					description=${ __( 'Platform-wide AI configuration. Applies to all users and to background jobs (cron, WP-CLI, anonymous comments). Individual users can override with their own key above.' ) }
				>
					<wpd-checkbox-label
						label=${ __( 'Enable AI for all users' ) }
						?checked=${ state.enabled }
						@wpd-checkbox-change=${ onToggle }
					></wpd-checkbox-label>

					<wpd-select
						label=${ __( 'Provider' ) }
						value=${ state.provider }
						?disabled=${ ! state.enabled || state.saving }
						@wpd-pick=${ onProvider }
					>
						${ getAiProviders().map(
							( p ) => html`<wpd-option value=${ p.id }>${ p.label }</wpd-option>`,
						) }
					</wpd-select>

					<wpd-text-field
						label=${ __( 'Platform API key' ) }
						type="password"
						reveal
						autocomplete="off"
						placeholder=${ __( 'sk-…' ) }
						value=${ state.apiKey }
						?disabled=${ ! state.enabled || state.saving }
						@wpd-input-change=${ onApiKey }
						@wpd-input-commit=${ onApiKeyCommit }
						@wpd-submit=${ onApiKeyCommit }
					></wpd-text-field>

					${ state.error
						? html`<p class="desktop-mode-ai-settings__error">${ state.error }</p>`
						: html`` }
					${ state.saving
						? html`<p class="desktop-mode-ai-settings__saving">${ __( 'Saving…' ) }</p>`
						: html`` }
				</wpd-section>
			`,
			el,
		);

	paint();
	return el;
}
