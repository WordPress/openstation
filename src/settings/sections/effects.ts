/**
 * Effects section — "Unfocused windows" selector bound to
 * `state.unfocusEffect`.
 *
 * Lists every effect registered via `wp.desktop.registerUnfocusEffect`
 * (the built-in `darken` plus any plugin effects), preceded by a
 * `None` option that maps to the engine's reserved `'none'` sentinel.
 * Subscribes to the effect registry so a plugin activated mid-session
 * surfaces its effect immediately without reopening OS Settings.
 *
 * The picker is a `<wpd-select>` rather than a `<wpd-segmented>` pill
 * bar because the effect list is open-ended — plugins append, and a
 * dropdown scales past the two shipped choices.
 *
 * @since 0.26.0
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import {
	listUnfocusEffects,
	subscribeUnfocusEffects,
} from '../../effects/registry';
import type { UnfocusEffectDef } from '../../effects/types';
import type { SettingsCtx } from '../types';

/** The reserved value meaning "no effect"; mirrors the engine. */
const NONE = 'none';

export function buildEffectsSection( ctx: SettingsCtx ): HTMLElement {
	const wrapper = document.createElement( 'div' );

	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( id === '' ) {
			return;
		}
		// Accept `none` or any currently-registered effect id. Guard
		// against stale option values (an effect unregistered between
		// paint and pick).
		if ( id !== NONE && ! effects.some( ( fx ) => fx.id === id ) ) {
			return;
		}
		ctx.state.unfocusEffect = id;
		ctx.save();
		ctx.apply();
		paint();
	};

	let effects: UnfocusEffectDef[] = listUnfocusEffects();

	const paint = (): void => {
		const active = effects.find(
			( fx ) => fx.id === ctx.state.unfocusEffect,
		);
		const fallbackDescription = __(
			'Apply a visual treatment to every window except the one you are working in.',
		);
		const description =
			ctx.state.unfocusEffect !== NONE && active?.description
				? active.description
				: fallbackDescription;

		render(
			html`
				<wpd-section
					heading=${ __( 'Unfocused windows' ) }
					description=${ description }
				>
					<wpd-select
						value=${ ctx.state.unfocusEffect }
						label=${ __( 'Unfocused window effect' ) }
						@wpd-pick=${ onPick }
					>
						<wpd-option value=${ NONE }>
							${ __( 'None' ) }
						</wpd-option>
						${ effects.map(
							( fx ) =>
								html`<wpd-option value=${ fx.id }
									>${ fx.label }</wpd-option
								>`,
						) }
					</wpd-select>
				</wpd-section>
			`,
			wrapper,
		);
	};

	const unsubscribe = subscribeUnfocusEffects( () => {
		effects = listUnfocusEffects();
		paint();
	} );

	const observer = new MutationObserver( () => {
		if ( ! wrapper.isConnected ) {
			unsubscribe();
			observer.disconnect();
		}
	} );
	queueMicrotask( () => {
		if ( wrapper.parentNode ) {
			observer.observe( wrapper.parentNode, {
				childList: true,
				subtree: false,
			} );
		}
	} );

	paint();
	return wrapper;
}
