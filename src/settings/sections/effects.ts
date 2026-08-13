/**
 * Effects section — "Unfocused windows" selector bound to
 * `state.unfocusEffect`, plus the "Window links" selectors bound to
 * `state.windowLinkRenderer` / `state.windowLinkVisibility`.
 *
 * Lists every effect registered via `wp.os.registerUnfocusEffect`
 * (the built-in `darken` plus any plugin effects), preceded by a
 * `None` option that maps to the engine's reserved `'none'` sentinel.
 * Subscribes to the effect registry so a plugin activated mid-session
 * surfaces its effect immediately without reopening OS Settings. The
 * window-link renderer picker mirrors the same pattern against the
 * window-link renderer registry.
 *
 * The pickers are `<os-select>` rather than `<os-segmented>` pill
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
import {
	listViewTransitions,
	runViewTransition,
	subscribeViewTransitions,
	supportsViewTransitions,
	VIEW_TRANSITION_NONE as VT_NONE,
	VT_DURATION_AUTO,
} from '../../view-transitions';
import type { ViewTransitionDef } from '../../view-transitions';
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

/**
 * View-transition speed presets, in ms. Same shape and same reasoning
 * as {@link REVEAL_SPEEDS} — `0` keeps each transition's own tuning,
 * which matters more here than it does for reveals because the spread
 * is wider: `crossfade` ships at 260 ms and `nebula` at 760, and one
 * flat number would make one of them wrong.
 */
const VT_SPEEDS = [
	{ value: VT_DURATION_AUTO, label: () => __( 'Default (per transition)' ) },
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

	const onPickTransition = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( id === '' ) {
			return;
		}
		if ( id !== VT_NONE && ! screenTransitions.some( ( t ) => t.id === id ) ) {
			return;
		}
		ctx.state.viewTransition = id;
		ctx.save();
		// No `ctx.apply()` — a transition is read at play time, not
		// written into a custom property, so the apply pass has nothing
		// to do. `save()` already fired the settings subscribers, which
		// is how the shell bundle learns the new id.
		paint();
		// Play it immediately. A transition is the one kind of setting
		// whose value is unreadable from its name — nobody knows what
		// "Shutter" looks like until they have seen it — and the
		// alternative is asking the user to close Preferences, switch
		// desktop, and come back for every one of two dozen options.
		preview( id );
	};

	const onPickWindowTransition = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( id === '' ) {
			return;
		}
		if ( id !== VT_NONE && ! windowTransitions.some( ( t ) => t.id === id ) ) {
			return;
		}
		ctx.state.windowTransition = id;
		ctx.save();
		paint();
		preview( id );
	};

	const onPickTransitionSpeed = ( e: Event ): void => {
		const raw = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( raw === '' ) {
			return;
		}
		const value = Number( raw );
		if ( ! VT_SPEEDS.some( ( s ) => s.value === value ) ) {
			return;
		}
		ctx.state.viewTransitionDuration = value;
		ctx.save();
		paint();
		// Preview whichever of the two the user actually has set, so
		// the speed change is visible without them having to guess
		// which selector it applied to.
		preview(
			ctx.state.viewTransition !== VT_NONE
				? ctx.state.viewTransition
				: ctx.state.windowTransition,
		);
	};

	/**
	 * Play the given transition against the live shell.
	 *
	 * The update callback changes an attribute and nothing else, so the
	 * two snapshots are identical — which is exactly what a preview
	 * wants. Every transition here MOVES its snapshots (slides them,
	 * rotates them, wipes between them), so identical content still
	 * shows the full motion, and the desktop is guaranteed to be in the
	 * same state afterwards as before. A preview that actually switched
	 * desktop would demonstrate the transition and rearrange the user's
	 * workspace to do it.
	 *
	 * A window transition previews against the Preferences window
	 * itself — the one window the user is certainly looking at — using
	 * the same morph pairing the real lifecycle callers use, so what
	 * they see here is what they will get when they open something.
	 *
	 * @param id Transition to play.
	 */
	const preview = ( id: string ): void => {
		if ( id === VT_NONE || ! supportsViewTransitions() ) {
			return;
		}
		const def = allTransitions().find( ( t ) => t.id === id );
		const windowScoped = ( def?.scope ?? 'root' ) === 'element';
		const host = wrapper.closest< HTMLElement >( '.os-window' );
		void runViewTransition( {
			id,
			family: windowScoped ? 'element' : 'root',
			update: () => {
				const root = document.documentElement;
				const n = Number( root.dataset.osVtPreview ?? '0' ) + 1;
				root.dataset.osVtPreview = String( n );
			},
			types: windowScoped
				? [ 'os-vt-window', 'os-vt-preview' ]
				: [ 'os-vt-desktop', 'os-vt-preview' ],
			morph: windowScoped
				? { from: host, to: () => host }
				: undefined,
		} );
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
	// The registry is one list; the two selectors are the two halves of
	// it, split on `scope`. Partitioning at paint time rather than
	// keeping two registries means a plugin registers into the same
	// place either way and simply lands in the right selector.
	let screenTransitions: ViewTransitionDef[] = [];
	let windowTransitions: ViewTransitionDef[] = [];
	const allTransitions = (): ViewTransitionDef[] => [
		...screenTransitions,
		...windowTransitions,
	];
	const refreshTransitions = (): void => {
		const all = listViewTransitions();
		screenTransitions = all.filter( ( t ) => ( t.scope ?? 'root' ) === 'root' );
		windowTransitions = all.filter( ( t ) => t.scope === 'element' );
	};
	refreshTransitions();
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

		const supported = supportsViewTransitions();
		const unsupportedNotice = __(
			'This browser does not support view transitions, so these play as instant changes.',
		);

		const activeTransition = screenTransitions.find(
			( t ) => t.id === ctx.state.viewTransition,
		);
		const vtFallbackDescription = supported
			? __(
				'Animate the whole screen when it changes — switching Space, or changing the desktop’s appearance.',
			)
			: unsupportedNotice;
		const vtDescription =
			ctx.state.viewTransition !== VT_NONE && activeTransition?.description
				? activeTransition.description
				: vtFallbackDescription;

		const activeWindowTransition = windowTransitions.find(
			( t ) => t.id === ctx.state.windowTransition,
		);
		const wtFallbackDescription = supported
			? __(
				'Animate one window as it opens, closes, minimizes or fills the desk — and let it grow out of whatever you clicked to open it.',
			)
			: unsupportedNotice;
		const wtDescription =
			ctx.state.windowTransition !== VT_NONE &&
			activeWindowTransition?.description
				? activeWindowTransition.description
				: wtFallbackDescription;

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
				<os-section
					heading=${ __( 'Unfocused windows' ) }
					description=${ description }
				>
					<os-select
						value=${ ctx.state.unfocusEffect }
						label=${ __( 'Unfocused window effect' ) }
						@os-pick=${ onPick }
					>
						<os-option value=${ NONE }>
							${ __( 'None' ) }
						</os-option>
						${ effects.map(
							( fx ) =>
								html`<os-option value=${ fx.id }
									>${ fx.label }</os-option
								>`,
						) }
					</os-select>
				</os-section>
				<os-section
					heading=${ __( 'Window reveal' ) }
					description=${ revealDescription }
				>
					<os-select
						value=${ ctx.state.windowReveal }
						label=${ __( 'Reveal style' ) }
						@os-pick=${ onPickReveal }
					>
						<os-option value=${ REVEAL_NONE }>
							${ __( 'None' ) }
						</os-option>
						${ reveals.map(
							( r ) =>
								html`<os-option value=${ r.id }
									>${ r.label }</os-option
								>`,
						) }
					</os-select>
					<os-select
						value=${ String( ctx.state.windowRevealDuration ) }
						label=${ __( 'Reveal speed' ) }
						@os-pick=${ onPickRevealSpeed }
					>
						${ REVEAL_SPEEDS.map(
							( s ) =>
								html`<os-option value=${ String( s.value ) }
									>${ s.label() }</os-option
								>`,
						) }
					</os-select>
				</os-section>
				<os-section
					stack
					heading=${ __( 'Screen transitions' ) }
					description=${ vtDescription }
				>
					<os-select
						value=${ ctx.state.viewTransition }
						label=${ __( 'When the screen changes' ) }
						@os-pick=${ onPickTransition }
					>
						<os-option value=${ VT_NONE }>
							${ __( 'None' ) }
						</os-option>
						${ screenTransitions.map(
							( t ) =>
								html`<os-option value=${ t.id }
									>${ t.label }</os-option
								>`,
						) }
					</os-select>
					<os-button
						class="os-settings__vt-play"
						variant="secondary"
						?disabled=${ ctx.state.viewTransition === VT_NONE ||
						! supported }
						@click=${ () => preview( ctx.state.viewTransition ) }
						>${ __( 'Play it again' ) }</os-button
					>
				</os-section>
				<os-section
					stack
					heading=${ __( 'Window transitions' ) }
					description=${ wtDescription }
				>
					<os-select
						value=${ ctx.state.windowTransition }
						label=${ __( 'When a window opens or closes' ) }
						@os-pick=${ onPickWindowTransition }
					>
						<os-option value=${ VT_NONE }>
							${ __( 'None' ) }
						</os-option>
						${ windowTransitions.map(
							( t ) =>
								html`<os-option value=${ t.id }
									>${ t.label }</os-option
								>`,
						) }
					</os-select>
					<os-select
						value=${ String( ctx.state.viewTransitionDuration ) }
						label=${ __( 'Transition speed' ) }
						@os-pick=${ onPickTransitionSpeed }
					>
						${ VT_SPEEDS.map(
							( s ) =>
								html`<os-option value=${ String( s.value ) }
									>${ s.label() }</os-option
								>`,
						) }
					</os-select>
					<os-button
						class="os-settings__vt-play"
						variant="secondary"
						?disabled=${ ctx.state.windowTransition === VT_NONE ||
						! supported }
						@click=${ () => preview( ctx.state.windowTransition ) }
						>${ __( 'Play it again' ) }</os-button
					>
				</os-section>
				<os-section
					heading=${ __( 'Window links' ) }
					description=${ linksDescription }
				>
					<os-select
						value=${ ctx.state.windowLinkRenderer }
						label=${ __( 'Link style' ) }
						@os-pick=${ onPickLinkRenderer }
					>
						<os-option value=${ LINKS_NONE }>
							${ __( 'None' ) }
						</os-option>
						${ linkRenderers.map(
							( r ) =>
								html`<os-option value=${ r.id }
									>${ r.label }</os-option
								>`,
						) }
					</os-select>
					<os-select
						value=${ ctx.state.windowLinkVisibility }
						label=${ __( 'Show links' ) }
						@os-pick=${ onPickLinkVisibility }
					>
						${ LINK_VISIBILITIES.map(
							( v ) =>
								html`<os-option value=${ v.id }
									>${ v.label() }</os-option
								>`,
						) }
					</os-select>
				</os-section>
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
	const unsubscribeTransitions = subscribeViewTransitions( () => {
		refreshTransitions();
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
			unsubscribeTransitions();
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
