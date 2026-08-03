/**
 * os-ui — the holographic layer.
 *
 * The brand ships five mesh gradients and one instruction about them:
 * *"meshes reserved for hero surfaces."* This module is how a control
 * gets to be one, without every component reinventing what
 * "holographic" means and drifting from the others.
 *
 * ## What holographic means here
 *
 * Not a skin. A **moment**. A control paints the mesh when it is on,
 * selected, primary or filled — the one instant it speaks for the
 * brand — and wears ordinary Obsidian the rest of the time. A panel
 * where every surface is iridescent has no identity moments left to
 * spend, which is the failure mode this module is shaped to avoid.
 *
 * Three surface treatments, in ascending loudness:
 *
 * 1. **Edge** ({@link holoEdge}) — an iridescent hairline around an
 *    otherwise ordinary control. Costs nothing at rest, lights up on
 *    hover and focus. This is the one most controls get.
 * 2. **Sheen** ({@link holoSheen}) — a 10%-alpha film of the mesh's
 *    own hues laid over the existing surface. The hover state for
 *    something that is not yet lit.
 * 3. **Fill** ({@link holoFill}) — the mesh itself, at full strength,
 *    with Void ink on top. Reserved for the on/selected/primary state.
 *
 * …and four motions, which are what make the surfaces read as foil
 * rather than as paint:
 *
 * - **Glint** ({@link holoGlint}) — a specular band crossing once on
 *   hover. The single most "holographic" thing here.
 * - **Ring** ({@link holoRing}) — a press response that expands and
 *   fades, so a click reads as received before its result paints.
 * - **Shimmer** ({@link holoShimmer}) — the mesh travelling, for waits
 *   of unknown length.
 * - **Enter** ({@link holoEnter}) — scale-and-fade arrival for menus,
 *   toasts and dialogs.
 *
 * Every one of them stops under `prefers-reduced-motion`, and the
 * timings all come from `--os-ui-motion-*` / `--os-ui-ease-*` so a
 * panel of controls moves as one surface.
 *
 * ## Why the mesh is a gradient stack and not an SVG
 *
 * `background-position` can slide a gradient. That slide *is* the
 * holographic effect — a foil card shifting hue as you tilt it — and
 * it is why {@link holoFill} oversizes the mesh to 220% and moves it
 * under the pointer. A `url()` to the brand's SVG could not do that,
 * would rasterise one flat corner of a 1440×960 artboard onto a 44 px
 * switch track, and would cost a request. The meshes are transcribed
 * stop-for-stop into `--os-mesh-*` in `assets/css/variables.css`.
 *
 * ## The alias discipline
 *
 * Every fragment here reads its public token into a private `--_holo-*`
 * alias on `:host`, never declaring the public name. A custom property
 * declared on `:host` matches the host ELEMENT and beats anything the
 * element would INHERIT — so declaring `--os-ui-holo-fill` there would
 * make the palette's and every desktop theme's declaration of that name
 * dead on arrival. See `AGENTS.md`, "Never declare a themeable token on
 * a component's `:host`", and its guard in
 * `tests/vitest/component-token-reachability.test.ts`.
 *
 * ## Using it
 *
 * ```ts
 * import { css } from '../../core';
 * import { holoTokens, holoEdge, holoFill } from '../../holo';
 *
 * export const styles = css`
 *   ${ holoTokens }
 *   ${ holoEdge }
 *   ${ holoFill }
 *   button { ... }
 *   button:focus-visible { box-shadow: var( --_holo-focus ); }
 * `;
 * ```
 *
 * `holoTokens` is a prerequisite for the others — it declares the
 * aliases they read. Include it once per component.
 */

import { css } from './core';

/**
 * Fallback Holomesh, for the moment `variables.css` has not loaded.
 *
 * Three stops rather than the nine-layer transcription: this is a
 * floor, not the artwork, and it is inlined into every component that
 * takes a holographic fill. The full mesh is one declaration away in
 * `--os-mesh-holo`; what matters here is that a control with no
 * stylesheet is still recognisably lit rather than transparent.
 */
const HOLO_FALLBACK =
	'linear-gradient( 124deg, #afa2e8 0%, #f5a8ea 46%, #8ee9f7 100% )';

/**
 * Private aliases the rest of this module reads.
 *
 * Include this in every component that uses any other fragment here.
 * It declares nothing themeable — only `--_holo-*` names, which are
 * component-private by convention and invisible to the palette.
 */
export const holoTokens = css`
	:host {
		--_holo-fill: var( --os-ui-holo-fill, ${ HOLO_FALLBACK } );
		--_holo-ink: var( --os-ui-holo-ink, #0c0b0f );
		--_holo-sheen: var(
			--os-ui-holo-sheen,
			linear-gradient(
				124deg,
				rgba( 159, 214, 255, 0.1 ) 0%,
				rgba( 236, 155, 255, 0.12 ) 34%,
				rgba( 242, 82, 252, 0.1 ) 58%,
				rgba( 147, 240, 198, 0.09 ) 100%
			)
		);
		--_holo-edge: var(
			--os-ui-holo-edge,
			linear-gradient(
				124deg,
				rgba( 154, 242, 255, 0.7 ) 0%,
				rgba( 236, 155, 255, 0.85 ) 38%,
				rgba( 242, 82, 252, 0.7 ) 62%,
				rgba( 159, 152, 255, 0.6 ) 100%
			)
		);
		--_holo-edge-quiet: var(
			--os-ui-holo-edge-quiet,
			linear-gradient(
				124deg,
				rgba( 154, 242, 255, 0.22 ) 0%,
				rgba( 236, 155, 255, 0.28 ) 38%,
				rgba( 242, 82, 252, 0.22 ) 62%,
				rgba( 159, 152, 255, 0.2 ) 100%
			)
		);
		--_holo-glow: var(
			--os-ui-holo-glow,
			0 0 0 1px rgba( 242, 82, 252, 0.28 ), 0 2px 10px rgba( 242, 82, 252, 0.22 )
		);
		--_holo-glow-strong: var(
			--os-ui-holo-glow-strong,
			0 0 0 1px rgba( 242, 82, 252, 0.42 ), 0 4px 18px rgba( 242, 82, 252, 0.38 ),
				0 1px 3px rgba( 12, 11, 15, 0.6 )
		);
		--_holo-track: var( --os-ui-holo-track, rgba( 255, 251, 255, 0.16 ) );
		--_holo-track-edge: var( --os-ui-holo-track-edge, #8c8f94 );
		/*
		 * The press ring's colour. The DIM Pulse, not Pulse: this one
		 * expands to ten pixels past the control and is on screen for
		 * a third of a second, which is exactly the "spread rather
		 * than stated" case the dim exists for.
		 */
		--_holo-ring-color: var( --os-ui-accent-dim, #2271b1 );
		/*
		 * One focus ring for the whole kit. Three layers, and each
		 * earns its place: a Void spacer so the ring never touches the
		 * control it is describing, the Pulse ring itself, and a soft
		 * bloom so the ring survives landing on a bright mesh — where a
		 * flat 2 px line would simply vanish into the pink.
		 */
		--_holo-focus: var(
			--os-ui-focus-ring,
			0 0 0 2px rgba( 12, 11, 15, 0.9 ), 0 0 0 4px #f252fc,
				0 0 12px 2px rgba( 242, 82, 252, 0.45 )
		);
		/*
		 * The field ring. A text input already has a border to
		 * thicken and it lives in a column of siblings, so the target
		 * ring above — built to survive a bright mesh — reads as an
		 * alarm on a settings form. This one tightens the field's own
		 * edge to Pulse and adds a soft halo outside it.
		 */
		--_holo-focus-field: var(
			--os-ui-focus-ring-field,
			0 0 0 1px #f252fc, 0 0 0 4px rgba( 242, 82, 252, 0.18 )
		);
		--_holo-t: var( --os-ui-holo-transition, 220ms );
		--_holo-t-fast: var( --os-ui-motion-fast, 140ms );
		--_holo-t-slow: var( --os-ui-motion-slow, 340ms );
		--_holo-t-ambient: var( --os-ui-motion-ambient, 12s );
		--_holo-spring: var(
			--os-ui-ease-spring,
			cubic-bezier( 0.32, 1.5, 0.55, 1 )
		);
		--_holo-ease: var( --os-ui-ease-out, cubic-bezier( 0.22, 0.9, 0.28, 1 ) );
		--_holo-loop: var( --os-ui-ease-loop, cubic-bezier( 0.45, 0, 0.55, 1 ) );
	}
`;

/**
 * `.os-holo-fill` — the mesh itself.
 *
 * The surface an "on" control paints. Oversized to 220% and parked
 * off-centre so there is somewhere to travel to: `:hover` slides the
 * mesh across the box, `:active` pushes it further, and the eye reads
 * the hue shift as a tilt rather than as a colour change.
 *
 * Text and glyphs inside inherit `--_holo-ink` (Void) — see the note
 * on that token; every mesh in the brand is a light surface and
 * Starlight on it is unreadable.
 */
export const holoFill = css`
	.os-holo-fill {
		background-color: transparent;
		background-image: var( --_holo-fill );
		background-size: 220% 220%;
		background-position: 22% 28%;
		background-repeat: no-repeat;
		color: var( --_holo-ink );
		transition: background-position var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease, filter var( --_holo-t ) ease;
	}

	.os-holo-fill:hover {
		background-position: 74% 66%;
	}

	.os-holo-fill:active {
		background-position: 88% 82%;
		filter: brightness( 0.94 );
	}

	/*
	 * The tilt is the whole effect, so when motion is unwelcome the
	 * mesh simply stops moving — it does not stop being a mesh. A
	 * control that lost its fill under reduced-motion would lose its
	 * state, not just its animation.
	 */
	@media ( prefers-reduced-motion: reduce ) {
		.os-holo-fill {
			transition-duration: 1ms;
		}

		.os-holo-fill:hover,
		.os-holo-fill:active {
			background-position: 22% 28%;
		}
	}
`;

/**
 * `.os-holo-sheen` — the hover film for a control that is NOT lit.
 *
 * Paints `--_holo-sheen` in a `::before` above the surface and below
 * the content, so it tints whatever background the control already
 * has instead of replacing it. Fades in on `:hover` and on
 * `:focus-visible`, and drifts a little while it is there.
 *
 * The host needs `position: relative` (or any non-`static` position)
 * and content that establishes its own stacking above `::before`;
 * every consumer in the kit already does.
 */
export const holoSheen = css`
	.os-holo-sheen {
		position: relative;
		isolation: isolate;
	}

	.os-holo-sheen::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		background-image: var( --_holo-sheen );
		background-size: 200% 200%;
		background-position: 20% 30%;
		opacity: 0;
		pointer-events: none;
		transition: opacity var( --_holo-t ) ease,
			background-position var( --_holo-t ) ease;
	}

	.os-holo-sheen:hover::before,
	.os-holo-sheen:focus-visible::before {
		opacity: 1;
		background-position: 76% 68%;
	}

	@media ( prefers-reduced-motion: reduce ) {
		.os-holo-sheen::before {
			transition-duration: 1ms;
		}

		.os-holo-sheen:hover::before,
		.os-holo-sheen:focus-visible::before {
			background-position: 20% 30%;
		}
	}
`;

/**
 * `.os-holo-edge` — the iridescent hairline.
 *
 * A gradient border, which CSS has no direct way to draw: `border-color`
 * takes a colour and `border-image` throws away `border-radius`. The
 * standard workaround, and the one used here, is a `::after` filled
 * with the gradient and masked to just its own padding ring — two
 * mask layers composited with `exclude`, so the middle is punched out
 * and only a 1 px frame survives, corners included.
 *
 * At rest the edge is `--_holo-edge-quiet` at ~40% and reads as a
 * slightly livelier border. On hover and focus it goes to the full
 * `--_holo-edge`. Add `.is-lit` to hold it at full strength for a
 * control that is permanently in its holographic state.
 */
export const holoEdge = css`
	.os-holo-edge {
		position: relative;
	}

	.os-holo-edge::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 1px;
		background-image: var( --_holo-edge-quiet );
		opacity: 0;
		pointer-events: none;
		/*
		 * Two masks: one clipped to the content box, one covering the
		 * whole element. "exclude" keeps the difference — the 1 px
		 * padding ring — which is the border. The -webkit- pair comes
		 * first for Safari, which still ships the prefixed property and
		 * spells the operation "xor" rather than "exclude".
		 */
		-webkit-mask: linear-gradient( #000 0 0 ) content-box,
			linear-gradient( #000 0 0 );
		-webkit-mask-composite: xor;
		mask: linear-gradient( #000 0 0 ) content-box, linear-gradient( #000 0 0 );
		mask-composite: exclude;
		transition: opacity var( --_holo-t ) ease;
	}

	.os-holo-edge:hover::after,
	.os-holo-edge:focus-visible::after {
		background-image: var( --_holo-edge );
		opacity: 1;
	}

	.os-holo-edge.is-lit::after {
		background-image: var( --_holo-edge );
		opacity: 1;
	}

	@media ( prefers-reduced-motion: reduce ) {
		.os-holo-edge::after {
			transition-duration: 1ms;
		}
	}
`;

/**
 * ## A note on the pseudo-element budget
 *
 * An element has exactly two of these to spend, and this module wants
 * four effects. {@link holoSheen} takes `::before` and {@link holoEdge}
 * takes `::after`, which is already the whole budget for a control
 * wearing both — as `<os-button>` does.
 *
 * So the two motion fragments below are **element-based** instead: the
 * component stamps a `<span>` and the fragment styles it. That costs
 * one node and buys free composition — a button can carry the film,
 * the hairline, the glint and the press ring at once, and no future
 * fragment has to negotiate for a pseudo that is already taken.
 *
 * Both are driven from the PARENT's state via the child combinator
 * (`:active > .os-holo-ring`). The combinator is load-bearing: `:active`
 * matches an activated element *and every ancestor of it*, so
 * `:active .os-holo-ring` would fire every ring on the page the moment
 * anything inside the panel was pressed.
 */

/**
 * `.os-holo-glint` — the specular pass.
 *
 * A narrow band of light that crosses the surface once, on hover. This
 * is the gesture people mean by "holographic" far more than any static
 * gradient is: real foil does not glow, it *catches* — a highlight
 * travels across it as the angle changes, and is gone.
 *
 * Deliberately once-per-hover rather than looping. A loop is a progress
 * indicator; this is a response. The difference is whether the surface
 * is telling you something is happening or acknowledging that you
 * arrived.
 *
 * Stamp it as a child of the control:
 *
 * ```html
 * <button class="os-holo-edge"><span class="os-holo-glint"></span>…</button>
 * ```
 */
export const holoGlint = css`
	.os-holo-glint {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		/* Clips the band to the control's shape. On the span rather
		   than the control, so the control keeps its own overflow. */
		overflow: hidden;
		pointer-events: none;
	}

	.os-holo-glint::before {
		content: '';
		position: absolute;
		/*
		 * Oversized and rotated, so the band is a plain rectangle that
		 * happens to cross the box diagonally. Translating a clipped
		 * rectangle is a composited move; animating gradient stops
		 * would repaint every frame.
		 */
		top: -60%;
		bottom: -60%;
		width: 45%;
		inset-inline-start: -60%;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba( 255, 251, 255, 0.14 ) 45%,
			rgba( 255, 251, 255, 0.22 ) 50%,
			rgba( 255, 251, 255, 0.14 ) 55%,
			transparent 100%
		);
		transform: rotate( 18deg ) translateX( 0 );
		opacity: 0;
	}

	/*
	 * Two forms, because the glint is stamped in two places.
	 *
	 * Inside a control (a button, a key) it is a child of that
	 * element, and the "hover >" form reaches it. Directly in a
	 * component's shadow root (a card, a tile) its parent is the
	 * shadow ROOT, which no selector matches — that form finds nothing
	 * there. The :host( :hover ) > form is the one that does, and the
	 * two are mutually exclusive in practice, so both can always be
	 * present.
	 */
	:hover > .os-holo-glint::before,
	:focus-visible > .os-holo-glint::before,
	:host( :hover ) > .os-holo-glint::before,
	:host( :focus-visible ) > .os-holo-glint::before {
		animation: os-holo-glint var( --_holo-t-slow ) var( --_holo-ease );
	}

	@keyframes os-holo-glint {
		0% {
			opacity: 0;
			transform: rotate( 18deg ) translateX( 0 );
		}

		15% {
			opacity: 1;
		}

		85% {
			opacity: 1;
		}

		100% {
			opacity: 0;
			/*
			 * Far enough that the band has cleared a very wide box.
			 * Viewport units rather than a percentage of the element:
			 * a percentage translate on a 45%-wide band means one thing
			 * on a 40px chip and another on a 900px row, and the chip's
			 * glint would finish before it was visible.
			 */
			transform: rotate( 18deg ) translateX( 240vw );
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		:hover > .os-holo-glint::before,
		:focus-visible > .os-holo-glint::before,
		:host( :hover ) > .os-holo-glint::before,
		:host( :focus-visible ) > .os-holo-glint::before {
			animation: none;
		}
	}
`;

/**
 * `.os-holo-ring` — the press response.
 *
 * A ring that expands out of the control and fades, on `:active`.
 * Centred rather than pointer-anchored: anchoring needs a JS listener
 * on every control, and at the ~40px targets in this kit nobody can
 * see where it started anyway.
 *
 * The point is latency, not decoration. A press that only changes
 * colour reads as either instant or broken; a press that *moves* reads
 * as received, which is worth the ~100ms before whatever it triggered
 * actually paints.
 */
export const holoRing = css`
	.os-holo-ring {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: 0 0 0 0 var( --_holo-ring-color );
		opacity: 0;
		pointer-events: none;
	}

	/* Both forms, for the same reason as the glint above. */
	:active:not( :disabled ) > .os-holo-ring,
	:host( :active:not( [ disabled ] ) ) > .os-holo-ring {
		animation: os-holo-ring var( --_holo-t-slow ) var( --_holo-ease );
	}

	@keyframes os-holo-ring {
		0% {
			opacity: 0.45;
			box-shadow: 0 0 0 0 var( --_holo-ring-color );
		}

		100% {
			opacity: 0;
			box-shadow: 0 0 0 10px transparent;
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		:active:not( :disabled ) > .os-holo-ring,
		:host( :active:not( [ disabled ] ) ) > .os-holo-ring {
			animation: none;
		}
	}
`;

/**
 * `.os-holo-shimmer` — the loading pass.
 *
 * The mesh, oversized and travelling, for anything whose duration is
 * unknown: an indeterminate progress bar, a skeleton row, a table
 * still fetching. It replaces the usual grey-bar-sliding-right-forever,
 * and it earns the swap by carrying information the grey bar does not
 * — the station's own colour, so "waiting" looks like part of the
 * product rather than like a gap in it.
 *
 * `--os-ui-motion-ambient` slow by default. Fast shimmer reads as
 * urgency, and the thing about an indeterminate wait is that nobody
 * knows whether it is urgent.
 */
export const holoShimmer = css`
	.os-holo-shimmer {
		background-image: var( --_holo-fill );
		background-size: 300% 300%;
		background-repeat: no-repeat;
		animation: os-holo-shimmer 2.4s var( --_holo-loop ) infinite;
	}

	@keyframes os-holo-shimmer {
		0% {
			background-position: 0% 50%;
		}

		100% {
			background-position: 100% 50%;
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		.os-holo-shimmer {
			animation: none;
			background-position: 30% 50%;
		}
	}
`;

/**
 * `.os-holo-enter` — the arrival.
 *
 * Scale-and-fade from 96%, for anything that appears rather than
 * changes: a menu, a flyout, a toast, a dialog. Short and on the
 * spring curve, so it lands rather than drifts.
 *
 * `transform-origin` is left to the consumer — an anchored popover
 * should grow from its anchor, and only the component positioning it
 * knows where that is. The default is `center`, which is right for a
 * dialog and wrong for a flyout.
 */
export const holoEnter = css`
	.os-holo-enter {
		animation: os-holo-enter var( --_holo-t ) var( --_holo-spring );
	}

	@keyframes os-holo-enter {
		from {
			opacity: 0;
			transform: scale( 0.96 );
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		.os-holo-enter {
			animation: none;
		}
	}
`;

/**
 * Field chrome — the interaction layer every text-like control shares.
 *
 * Bare element selectors, which would be reckless in a global
 * stylesheet and are exactly right inside a shadow root: the only
 * `input`, `select` or `textarea` this can reach is the component's
 * own. That is what lets one fragment give the whole form family a
 * single hover, a single focus ring and a single transition duration
 * without every component re-deciding them.
 *
 * It deliberately sets no padding, radius, background or font. Those
 * are each component's own shape — a `<os-textarea>` is not a
 * `<os-select>` — and a shared fragment that reached for them would
 * turn every future tweak into a negotiation.
 *
 * Checkboxes and radios are excluded throughout: they are painted by
 * {@link holoCheck}, which gives them the target ring rather than the
 * field one, and a hover that moves their border instead of their
 * background.
 *
 * ## Why the exclusions are wrapped in `:where()`
 *
 * `:not()` carries the specificity of its argument, so the honest
 * spelling — `input:not([type='checkbox']):not([type='radio']):focus`
 * — weighs (0,3,1). That is heavier than
 * `input[aria-invalid='true']:focus` at (0,2,1), which means a shared
 * fragment would quietly outrank every component's own error ring and
 * an invalid field would focus in Pulse instead of red. `:where()`
 * contributes nothing, so the same selector lands at (0,1,1) and every
 * component keeps the last word about its own states.
 */
export const holoField = css`
	input:where( :not( [ type='checkbox' ] ):not( [ type='radio' ] ) ),
	select,
	textarea {
		transition: background-color var( --_holo-t ) ease,
			border-color var( --_holo-t ) ease, box-shadow var( --_holo-t ) ease;
	}

	input:where( :not( [ type='checkbox' ] ):not( [ type='radio' ] ) ):hover:not(
			:disabled
		),
	select:hover:not( :disabled ),
	textarea:hover:not( :disabled ) {
		border-color: var( --os-ui-border-strong, #8c8f94 );
	}

	input:where( :not( [ type='checkbox' ] ):not( [ type='radio' ] ) ):focus,
	input:where( :not( [ type='checkbox' ] ):not( [ type='radio' ] ) ):focus-visible,
	select:focus,
	select:focus-visible,
	textarea:focus,
	textarea:focus-visible {
		outline: none;
		border-color: var( --os-ui-accent, #2271b1 );
		box-shadow: var( --_holo-focus-field );
	}

	/*
	 * Placeholders go one step further down the Shade ramp than muted
	 * body text. At the same value they compete with a real entry and
	 * the field reads as filled when it is empty.
	 */
	input::placeholder,
	textarea::placeholder {
		color: var( --os-ui-fg-faint, #8c8f94 );
		opacity: 1;
	}

	/*
	 * Selection inside a field.
	 *
	 * A shadow root does not inherit the document's ::selection rule,
	 * so the shell-wide one in desktop.css cannot reach in here — this
	 * has to be restated, and it reads the same two tokens so the two
	 * cannot drift.
	 *
	 * It used to read --os-ui-accent-soft, which is a 14% wash meant
	 * for a hover tint. As a selection it was ~1.2:1 against the field
	 * behind it: technically present, effectively invisible. Both
	 * halves are set, because leaving the text colour to the UA is how
	 * a selection ends up as black-on-violet.
	 */
	input::selection,
	textarea::selection {
		background: var( --os-ui-selection-bg, rgba( 159, 152, 255, 0.6 ) );
		color: var( --os-ui-selection-fg, #fffbff );
	}

	@media ( prefers-reduced-motion: reduce ) {
		input:where( :not( [ type='checkbox' ] ):not( [ type='radio' ] ) ),
		select,
		textarea {
			transition-duration: 1ms;
		}
	}
`;

/**
 * The checkbox and radio paint.
 *
 * Shared because two components already draw this box —
 * `<os-checkbox>` and `<os-checkbox-label>` — and every picker in the
 * kit that grows a multi-select row will draw a third. One fragment
 * means the tick is the same tick everywhere.
 *
 * ## Why `accent-color` had to go
 *
 * `accent-color` is the right answer for a native checkbox and the
 * wrong one here: it takes a *colour*, and the checked state in this
 * kit is a *mesh*. There is no way to hand a gradient to the native
 * control, so the box is repainted from scratch — `appearance: none`,
 * a border, the mesh as a background, and the tick drawn as two
 * borders of a rotated box.
 *
 * The tick is CSS rather than an inline SVG on purpose: it inherits
 * `--_holo-ink`, so it stays Void on the mesh and follows a theme that
 * re-points the ink without anyone having to re-encode a data URI.
 *
 * `:indeterminate` is styled too, even though no component in the kit
 * sets it yet — it is one line, it is what a "select all" header
 * checkbox will need, and an unstyled indeterminate box under
 * `appearance: none` renders as an empty one, which is a silent lie
 * about the state.
 */
export const holoCheck = css`
	input[ type='checkbox' ],
	input[ type='radio' ] {
		appearance: none;
		-webkit-appearance: none;
		position: relative;
		flex: 0 0 auto;
		box-sizing: border-box;
		width: 16px;
		height: 16px;
		margin: 0;
		padding: 0;
		/*
		 * The unchecked box's boundary carries the whole control: an
		 * empty checkbox IS its outline. --_holo-track-edge rather
		 * than --os-ui-border-strong because the latter is Silver, at
		 * 2.03:1 against Obsidian — under the 3:1 WCAG 1.4.11 asks of
		 * a control boundary, and visibly so on a dark panel.
		 */
		border: 1px solid var( --_holo-track-edge );
		border-radius: 4px;
		background-color: var( --_holo-track );
		background-image: none;
		background-repeat: no-repeat;
		cursor: inherit;
		transition: background-position var( --_holo-t ) ease,
			border-color var( --_holo-t ) ease, box-shadow var( --_holo-t ) ease;
	}

	input[ type='radio' ] {
		border-radius: 50%;
	}

	input[ type='checkbox' ]:hover:not( :disabled ),
	input[ type='radio' ]:hover:not( :disabled ) {
		border-color: var( --os-ui-accent, #2271b1 );
	}

	input[ type='checkbox' ]:focus-visible,
	input[ type='radio' ]:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
	}

	/* Checked is the identity moment: the box fills with the mesh. */
	input[ type='checkbox' ]:checked,
	input[ type='checkbox' ]:indeterminate,
	input[ type='radio' ]:checked {
		border-color: transparent;
		background-image: var( --_holo-fill );
		background-size: 220% 220%;
		background-position: 22% 28%;
		box-shadow: var( --_holo-glow );
	}

	input[ type='checkbox' ]:checked:hover:not( :disabled ),
	input[ type='radio' ]:checked:hover:not( :disabled ) {
		background-position: 74% 66%;
	}

	input[ type='checkbox' ]:checked:focus-visible,
	input[ type='radio' ]:checked:focus-visible {
		box-shadow: var( --_holo-focus );
	}

	/*
	 * The tick. Two borders of a box, rotated — the oldest trick in
	 * CSS and still the only one that scales with the font and takes
	 * its colour from a custom property.
	 */
	input[ type='checkbox' ]:checked::after {
		content: '';
		position: absolute;
		inset-inline-start: 50%;
		top: 46%;
		width: 3.5px;
		height: 7.5px;
		border: solid var( --_holo-ink );
		border-width: 0 2px 2px 0;
		transform: translate( -50%, -50% ) rotate( 45deg );
		animation: os-holo-tick 180ms cubic-bezier( 0.3, 1.4, 0.6, 1 );
	}

	/* Indeterminate: a bar, not a tick. Same ink, same box. */
	input[ type='checkbox' ]:indeterminate::after {
		content: '';
		position: absolute;
		inset-inline-start: 50%;
		top: 50%;
		width: 8px;
		height: 2px;
		border: 0;
		border-radius: 1px;
		background: var( --_holo-ink );
		transform: translate( -50%, -50% );
	}

	input[ type='radio' ]:checked::after {
		content: '';
		position: absolute;
		inset-inline-start: 50%;
		top: 50%;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var( --_holo-ink );
		transform: translate( -50%, -50% );
		animation: os-holo-tick 180ms cubic-bezier( 0.3, 1.4, 0.6, 1 );
	}

	input[ type='checkbox' ]:disabled,
	input[ type='radio' ]:disabled {
		cursor: not-allowed;
	}

	/*
	 * The tick lands rather than appears. 180ms with a slight
	 * overshoot, which is short enough to feel like a response to the
	 * click and not like an animation being played at you.
	 */
	@keyframes os-holo-tick {
		from {
			opacity: 0;
			transform: translate( -50%, -50% ) rotate( 45deg ) scale( 0.4 );
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		input[ type='checkbox' ]:checked::after,
		input[ type='radio' ]:checked::after {
			animation: none;
		}
	}
`;

/**
 * `@keyframes os-holo-drift` plus the `.os-holo-alive` opt-in.
 *
 * A slow, always-running traverse of the mesh, for the handful of surfaces
 * that should look powered rather than merely painted: a busy button,
 * an indeterminate progress bar, a spinner. Twelve seconds, so it
 * reads as ambient rather than as an animation demanding attention,
 * and off entirely under `prefers-reduced-motion`.
 */
export const holoDrift = css`
	@keyframes os-holo-drift {
		0% {
			background-position: 16% 26%;
		}

		50% {
			background-position: 84% 74%;
		}

		100% {
			background-position: 16% 26%;
		}
	}

	.os-holo-alive {
		animation: os-holo-drift var( --_holo-t-ambient ) var( --_holo-loop ) infinite;
	}

	@media ( prefers-reduced-motion: reduce ) {
		.os-holo-alive {
			animation: none;
		}
	}
`;

/**
 * Every fragment above, in dependency order.
 *
 * Convenience for a component that wants the whole vocabulary. The
 * cost of an unused fragment is a few hundred bytes of text in one
 * constructable stylesheet, shared by every instance of that
 * component — cheap enough that reaching for this instead of picking
 * fragments is fine unless the component is a hot path.
 */
export const holo = css`
	${ holoTokens }
	${ holoFill }
	${ holoSheen }
	${ holoEdge }
	${ holoGlint }
	${ holoRing }
	${ holoShimmer }
	${ holoEnter }
	${ holoField }
	${ holoCheck }
	${ holoDrift }
`;
