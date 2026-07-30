/**
 * Effects section — "Unfocused windows" selector bound to
 * `state.unfocusEffect`, plus the "Window links" selectors bound to
 * `state.windowLinkRenderer` / `state.windowLinkVisibility`.
 *
 * Lists every effect registered via `wp.desktop.registerUnfocusEffect`
 * (the built-in `darken` plus any plugin effects), preceded by a
 * `None` option that maps to the engine's reserved `'none'` sentinel.
 * Subscribes to the effect registry so a plugin activated mid-session
 * surfaces its effect immediately without reopening OS Settings. The
 * window-link renderer picker mirrors the same pattern against the
 * window-link renderer registry.
 *
 * The pickers are `<wpd-select>` rather than `<wpd-segmented>` pill
 * bars because both lists are open-ended — plugins append, and a
 * dropdown scales past the shipped choices.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import {
	listUnfocusEffects,
	subscribeUnfocusEffects,
	UNFOCUS_EFFECT_NONE as NONE,
} from '../../effects/registry';
import {
	listWindowLinkRenderers,
	subscribeWindowLinkRenderers,
	WINDOW_LINK_RENDERER_NONE as LINKS_NONE,
} from '../../window-links/renderer-registry';
import {
	listWindowReveals,
	REVEAL_DURATION_AUTO,
	subscribeWindowReveals,
	WINDOW_REVEAL_NONE as REVEAL_NONE,
} from '../../reveals/registry';
import type { UnfocusEffectDef } from '../../effects/types';
import type { WindowRevealDef } from '../../reveals/types';
import type { WindowLinkRendererDef } from '../../window-links/types';
import type { SettingsCtx } from '../types';

/**
 * Reveal-speed presets, in ms. `0` is the "leave each reveal alone"
 * sentinel and is offered first, because the shipped reveals carry
 * durations tuned per shape — Radar's full turn is deliberately slower
 * than Sweep's straight line — and a user who has no opinion about
 * speed should keep that tuning rather than flatten it.
 *
 * Presets rather than a slider: the value is a duration in ms, but the
 * useful range spans one order of magnitude and the interesting
 * choices are coarse. A dropdown of named speeds also matches every
 * other control in this tab.
 */
const REVEAL_SPEEDS = [
	{ value: REVEAL_DURATION_AUTO, label: () => __( 'Default (per reveal)' ) },
	{ value: 200, label: () => __( 'Very fast — 200 ms' ) },
	{ value: 320, label: () => __( 'Fast — 320 ms' ) },
	{ value: 460, label: () => __( 'Normal — 460 ms' ) },
	{ value: 700, label: () => __( 'Slow — 700 ms' ) },
	{ value: 1100, label: () => __( 'Very slow — 1100 ms' ) },
] as const;

const LINK_VISIBILITIES = [
	{ id: 'focus', label: () => __( 'When a related window is focused' ) },
	{ id: 'always', label: () => __( 'Always' ) },
	{ id: 'off', label: () => __( 'Off' ) },
] as const;

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

	const onPickReveal = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( id === '' ) {
			return;
		}
		if ( id !== REVEAL_NONE && ! reveals.some( ( r ) => r.id === id ) ) {
			return;
		}
		ctx.state.windowReveal = id;
		ctx.save();
		// No `ctx.apply()` — reveals are read at window-load time, not
		// written into a custom property, so there is nothing for the
		// apply pass to do. `save()` already fired the OS-settings
		// subscribers, which is how the shell bundle learns the new id.
		paint();
	};

	const onPickRevealSpeed = ( e: Event ): void => {
		const raw = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( raw === '' ) {
			return;
		}
		const value = Number( raw );
		// Guard against a stale option value; the state sanitizer would
		// coerce a NaN back to the default anyway, but writing one into
		// state first would repaint the selector with no selection.
		if ( ! REVEAL_SPEEDS.some( ( s ) => s.value === value ) ) {
			return;
		}
		ctx.state.windowRevealDuration = value;
		ctx.save();
		paint();
	};

	const onPickLinkRenderer = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( id === '' ) {
			return;
		}
		if (
			id !== LINKS_NONE &&
			! linkRenderers.some( ( r ) => r.id === id )
		) {
			return;
		}
		ctx.state.windowLinkRenderer = id;
		ctx.save();
		ctx.apply();
		paint();
	};

	const onPickLinkVisibility = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( id !== 'focus' && id !== 'always' && id !== 'off' ) {
			return;
		}
		ctx.state.windowLinkVisibility = id;
		ctx.save();
		ctx.apply();
		paint();
	};

	let effects: UnfocusEffectDef[] = listUnfocusEffects();
	let reveals: WindowRevealDef[] = listWindowReveals();
	let linkRenderers: WindowLinkRendererDef[] = listWindowLinkRenderers();

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

		const activeReveal = reveals.find(
			( r ) => r.id === ctx.state.windowReveal,
		);
		const revealFallbackDescription = __(
			'Uncover a window’s content when it finishes loading, instead of fading it in.',
		);
		const revealDescription =
			ctx.state.windowReveal !== REVEAL_NONE && activeReveal?.description
				? activeReveal.description
				: revealFallbackDescription;

		const activeLinkRenderer = linkRenderers.find(
			( r ) => r.id === ctx.state.windowLinkRenderer,
		);
		const linksFallbackDescription = __(
			'Draw a visual tie between windows showing related content — a post and its comments or media.',
		);
		const linksDescription =
			ctx.state.windowLinkRenderer !== LINKS_NONE &&
			activeLinkRenderer?.description
				? activeLinkRenderer.description
				: linksFallbackDescription;

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
				<wpd-section
					heading=${ __( 'Window reveal' ) }
					description=${ revealDescription }
				>
					<wpd-select
						value=${ ctx.state.windowReveal }
						label=${ __( 'Reveal style' ) }
						@wpd-pick=${ onPickReveal }
					>
						<wpd-option value=${ REVEAL_NONE }>
							${ __( 'None' ) }
						</wpd-option>
						${ reveals.map(
							( r ) =>
								html`<wpd-option value=${ r.id }
									>${ r.label }</wpd-option
								>`,
						) }
					</wpd-select>
					<wpd-select
						value=${ String( ctx.state.windowRevealDuration ) }
						label=${ __( 'Reveal speed' ) }
						@wpd-pick=${ onPickRevealSpeed }
					>
						${ REVEAL_SPEEDS.map(
							( s ) =>
								html`<wpd-option value=${ String( s.value ) }
									>${ s.label() }</wpd-option
								>`,
						) }
					</wpd-select>
				</wpd-section>
				<wpd-section
					heading=${ __( 'Window links' ) }
					description=${ linksDescription }
				>
					<wpd-select
						value=${ ctx.state.windowLinkRenderer }
						label=${ __( 'Link style' ) }
						@wpd-pick=${ onPickLinkRenderer }
					>
						<wpd-option value=${ LINKS_NONE }>
							${ __( 'None' ) }
						</wpd-option>
						${ linkRenderers.map(
							( r ) =>
								html`<wpd-option value=${ r.id }
									>${ r.label }</wpd-option
								>`,
						) }
					</wpd-select>
					<wpd-select
						value=${ ctx.state.windowLinkVisibility }
						label=${ __( 'Show links' ) }
						@wpd-pick=${ onPickLinkVisibility }
					>
						${ LINK_VISIBILITIES.map(
							( v ) =>
								html`<wpd-option value=${ v.id }
									>${ v.label() }</wpd-option
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
	const unsubscribeReveals = subscribeWindowReveals( () => {
		reveals = listWindowReveals();
		paint();
	} );
	const unsubscribeLinks = subscribeWindowLinkRenderers( () => {
		linkRenderers = listWindowLinkRenderers();
		paint();
	} );

	const observer = new MutationObserver( () => {
		if ( ! wrapper.isConnected ) {
			unsubscribe();
			unsubscribeReveals();
			unsubscribeLinks();
			observer.disconnect();
		}
	} );
	// Note: this watches `wrapper.parentNode` for direct child removals,
	// so it fires when the panel unmounts `wrapper` — the only teardown
	// path in practice (the OS Settings panel always removes the section
	// wrapper directly). If an ancestor higher up were detached without
	// touching the parent's child list, the observer wouldn't fire and
	// the registry listener would leak. Matches the accepted pattern in
	// the sibling settings sections (e.g. `dock-rail-renderer.ts`).
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
