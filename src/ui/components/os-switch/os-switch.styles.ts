import { css } from '../../core';
import { holoTokens } from '../../holo';

/**
 * `<os-switch>` — shadow-DOM styles.
 *
 * ## The geometry
 *
 * Everything derives from one number, `--_h` (the track height). The
 * track is `2 × --_h` wide, the knob is `--_h − 2 × --_pad`, and the
 * "on" travel is the difference between the two. Change `--_h` in a
 * size modifier and the whole control rescales with no other rule
 * touched — which is what makes `size="sm|md|lg"` three declarations
 * instead of three stylesheets.
 *
 * ## The knob is not `left`-animated
 *
 * It is `translate`d. `left` is a layout property: animating it makes
 * the browser re-lay-out the track sixty times a second, and on a
 * settings panel with a dozen switches that is measurable. `translate`
 * is compositor-only. It is also what makes the drag gesture cheap —
 * see `_onPointerMove` in the component, which writes a single
 * `--_drag` custom property while the finger is down and lets this
 * rule do the arithmetic.
 *
 * ## The stretch
 *
 * `:active` widens the knob toward the direction of travel, the way
 * the iOS switch does. It costs one `width` transition on a 20 px box
 * and it is most of why the control feels physical rather than
 * drawn — the knob reads as something being pushed rather than
 * something being redrawn somewhere else.
 *
 * ## No mesh, in either state
 *
 * A switch never wears the holographic fill — the brand reserves the
 * meshes for hero surfaces and a settings page carries a dozen of
 * these. Only `holoTokens` is interpolated, for the `--_holo-*`
 * aliases the track, the focus ring and the timings read.
 *
 * `holoFill` used to be interpolated too, with `.os-holo-fill` on the
 * button, and the OFF state was iridescent for it. The class selector
 * is (0,1,0); the `button` rule that sets `background-image: none` is
 * (0,0,1), so the mesh won every time. The lit rule
 * (`:host( [ checked ] ) button`, (0,2,1)) did outrank it, which is
 * why the bug was visible only while the switch was off — and why the
 * test that guarded this checked the ON state and passed throughout.
 *
 * The `background-image: none` declarations below are kept as a guard
 * rather than a fix: nothing paints an image here now, and if a fill
 * class ever returns they are what keeps it out.
 */
export const styles = css`
	${ holoTokens }

	:host {
		/* Track height. Every other measurement derives from it. */
		--_h: 22px;
		/* Gap between knob and track edge, all round. */
		--_pad: 2px;
		/* Knob diameter and the distance it travels, both derived. */
		--_knob: calc( var( --_h ) - 2 * var( --_pad ) );
		--_travel: calc( var( --_w ) - var( --_knob ) - 2 * var( --_pad ) );
		--_w: calc( var( --_h ) * 1.85 );
		/*
		 * Live drag offset in px, written by the component while a
		 * pointer is down and cleared on release. 0 the rest of the
		 * time, which is why the resting rule below can add it
		 * unconditionally.
		 */
		--_drag: 0px;
		/* Travel sign: 1 in LTR, -1 in RTL. Written by the component. */
		--_dir: 1;

		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		line-height: 1.3;
		color: var( --os-ui-fg, #1d2327 );
		cursor: pointer;
		/*
		 * A switch is a target, not a text run. Selecting the label on
		 * a double-click — which is what a fast double-toggle looks
		 * like to the browser — leaves the row highlighted blue and is
		 * never what anyone meant.
		 */
		-webkit-user-select: none;
		user-select: none;
	}

	:host( [ size='sm' ] ) {
		--_h: 16px;
		--_pad: 2px;
		font-size: 12px;
		gap: 8px;
	}

	:host( [ size='lg' ] ) {
		--_h: 30px;
		--_pad: 3px;
		font-size: 14px;
		gap: 12px;
	}

	/* Full-width settings row: label left, switch hard right. */
	:host( [ block ] ) {
		display: flex;
		width: 100%;
		justify-content: space-between;
	}

	:host( [ label-position='start' ] ) .os-switch__row {
		flex-direction: row-reverse;
	}

	:host( [ disabled ] ) {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.os-switch__row {
		display: inline-flex;
		align-items: center;
		gap: inherit;
		flex: 1 1 auto;
		justify-content: inherit;
	}

	/*
	 * The control. A real button element, so Space and Enter, the
	 * disabled semantics and the focus ring all come from the
	 * platform; role="switch" plus aria-checked are set in the
	 * template, which is the pairing screen readers announce as
	 * "on/off" rather than as "pressed".
	 */
	/*
	 * The track.
	 *
	 * NO BORDER, and that is a fix rather than a style. With a 1px
	 * border and the default border-box background clip, the fill
	 * paints UNDER the border: the off state showed a grey ring over
	 * the fill's outer edge, and the on state (border-color:
	 * transparent) let the mesh through it. The pill's visible outline
	 * therefore moved outward by a pixel on each side as it turned on,
	 * and the control looked like it changed size when it changed
	 * state.
	 *
	 * The off-state edge is an INSET shadow instead. It occupies no
	 * layout, so the box is byte-identical in both states, and it can
	 * be swapped for the glow when lit without anything moving.
	 */
	button {
		appearance: none;
		flex: 0 0 auto;
		position: relative;
		box-sizing: border-box;
		width: var( --_w );
		height: var( --_h );
		padding: 0;
		margin: 0;
		border: 0;
		border-radius: 999px;
		background-color: var( --_holo-track );
		background-image: none;
		/*
		 * The boundary WCAG 1.4.11 asks for. The fill alone is a
		 * ~1.6:1 wash — enough to shape the control, not enough to
		 * prove it is there; --_holo-track-edge is Pewter, the first
		 * step on the Shade ramp that reaches 3:1 on Obsidian.
		 */
		box-shadow: inset 0 0 0 1px var( --_holo-track-edge );
		cursor: inherit;
		outline: none;
		transition: background-color var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease;
	}

	button:disabled {
		cursor: not-allowed;
	}

	/*
	 * ON. Flat accent, not the mesh: toggles arrive a dozen to a
	 * settings page, and the brand reserves meshes for hero surfaces.
	 * The inset edge is dropped with nothing in its place, because a
	 * lit accent track carries its own boundary against the surface.
	 */
	:host( [ checked ] ) button {
		background-image: none;
		background-color: var( --os-ui-accent, #2271b1 );
		box-shadow: none;
	}

	/*
	 * Focused and OFF keeps the inset edge alongside the focus ring:
	 * the ring says where the keyboard is, the edge still says where
	 * the control is, and losing the second while gaining the first is
	 * a trade nothing asked for.
	 */
	button:focus-visible {
		box-shadow: var( --_holo-focus ),
			inset 0 0 0 1px var( --_holo-track-edge );
	}

	:host( [ checked ] ) button:focus-visible {
		box-shadow: var( --_holo-focus );
	}

	/*
	 * Tones, for a switch whose meaning is not "brand" — a
	 * destructive toggle that should read as danger, a confirmation
	 * that should read as success. The accent tone is the default
	 * made explicit, so a caller can state it rather than imply it.
	 *
	 * No backticks in this comment: the file is a JS template
	 * literal, and one here would terminate it. See AGENTS.md.
	 */
	:host( [ tone='accent' ][ checked ] ) button,
	:host( [ tone='danger' ][ checked ] ) button,
	:host( [ tone='success' ][ checked ] ) button {
		background-image: none;
	}

	:host( [ tone='accent' ][ checked ] ) button {
		background-color: var( --os-ui-accent, #2271b1 );
	}

	:host( [ tone='danger' ][ checked ] ) button {
		background-color: var( --os-ui-danger, #d63638 );
		box-shadow: 0 0 0 1px rgba( 255, 90, 90, 0.3 ),
			0 2px 10px rgba( 255, 90, 90, 0.25 );
	}

	:host( [ tone='success' ][ checked ] ) button {
		background-color: var( --os-ui-success-fg, #00a32a );
		box-shadow: 0 0 0 1px rgba( 147, 240, 198, 0.3 ),
			0 2px 10px rgba( 147, 240, 198, 0.25 );
	}

	/*
	 * The knob.
	 *
	 * Starlight, and the hairline around it is what makes that
	 * survivable. Against the lit track it has almost nothing to
	 * contrast with — Holomesh's white glow is #fffdff, so a Starlight
	 * knob sitting on that part of the mesh measures **1.01:1** and is
	 * simply gone. The old ring, Void at 12%, was nowhere near enough
	 * to rescue it.
	 *
	 * At 55% the ring composites to ~#7d7c7f over that glow, which
	 * carries the knob at 3.5:1 there and 6.9:1 over the mesh's
	 * darkest stop — so the knob has an outline everywhere the mesh
	 * can go, and the same ring is what separates it from the unlit
	 * track too. One declaration, both states.
	 */
	.os-switch__knob {
		position: absolute;
		top: var( --_pad );
		inset-inline-start: var( --_pad );
		width: var( --_knob );
		height: var( --_knob );
		border-radius: 999px;
		background: var( --os-ui-switch-knob, #fffbff );
		box-shadow: 0 1px 2px rgba( 12, 11, 15, 0.45 ),
			0 0 0 1px var( --os-ui-switch-knob-edge, rgba( 12, 11, 15, 0.55 ) );
		pointer-events: none;
		transition: transform var( --_holo-t ) var( --_holo-spring ),
			width var( --_holo-t ) ease;
	}

	/*
	 * Resting position. --_drag is 0 unless a finger is down, so one
	 * rule covers both the settled state and the live gesture — the
	 * component never has to swap classes mid-drag.
	 *
	 * RTL travels the other way, and --_dir is how: the component
	 * writes 1 or -1 onto the host from the computed direction, and
	 * every offset below is multiplied by it. :host-context() would
	 * have been the CSS-only way and is not shipped by Firefox; :dir()
	 * is too new to rely on. The knob's resting side is placed with
	 * inset-inline-start, which needs no help.
	 */
	.os-switch__knob {
		transform: translateX( calc( var( --_dir ) * var( --_drag ) ) );
	}

	:host( [ checked ] ) .os-switch__knob {
		transform: translateX(
			calc( var( --_dir ) * ( var( --_travel ) + var( --_drag ) ) )
		);
	}

	/* The squash. Widens toward travel while the control is pressed. */
	:host( :not( [ disabled ] ) ) button:active .os-switch__knob {
		width: calc( var( --_knob ) * 1.28 );
	}

	:host( [ checked ]:not( [ disabled ] ) ) button:active .os-switch__knob {
		width: calc( var( --_knob ) * 1.28 );
		transform: translateX(
			calc(
				var( --_dir ) *
					( var( --_travel ) - var( --_knob ) * 0.28 + var( --_drag ) )
			)
		);
	}

	/*
	 * While dragging, the knob follows the finger with no easing —
	 * a transition here would make it lag behind the pointer, which
	 * reads as a broken control rather than a smooth one. The easing
	 * comes back on release, which is what produces the snap.
	 */
	:host( [ data-dragging ] ) .os-switch__knob {
		transition: width var( --_holo-t ) ease;
	}

	.os-switch__label {
		line-height: 1.3;
	}

	.os-switch__label:empty {
		display: none;
	}

	/*
	 * Optional secondary line. A settings switch almost always wants
	 * one ("Off means the dock hides on scroll"), and without a slot
	 * for it every caller reinvents the two-line row.
	 */
	.os-switch__text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.os-switch__description {
		font-size: 0.92em;
		color: var( --os-ui-fg-muted, #646970 );
	}

	@media ( prefers-reduced-motion: reduce ) {
		.os-switch__knob {
			transition-duration: 1ms;
		}
	}
`;
