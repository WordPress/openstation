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
import type { UnfocusEffectDef } from '../../effects/types';
import type { WindowLinkRendererDef } from '../../window-links/types';
import type { SettingsCtx } from '../types';

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
	const unsubscribeLinks = subscribeWindowLinkRenderers( () => {
		linkRenderers = listWindowLinkRenderers();
		paint();
	} );

	const observer = new MutationObserver( () => {
		if ( ! wrapper.isConnected ) {
			unsubscribe();
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
