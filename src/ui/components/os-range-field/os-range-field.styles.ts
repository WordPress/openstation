import { css } from '../../core';
import { holoTokens } from '../../holo';

/**
 * `<os-range-field>` — label, track, readout.
 *
 * ## The elapsed track is the mesh
 *
 * A slider is the one control in the kit that shows a *quantity*, and
 * the filled part of it is the natural place for the brand to live:
 * it is already where the eye goes, it is already bounded, and it
 * grows — so the mesh is revealed rather than merely applied.
 *
 * `accent-color` cannot do this. It takes a colour and the fill here
 * is a gradient, so the track is repainted from scratch with two
 * background layers:
 *
 *   1. an opaque wedge of the unlit track colour covering everything
 *      PAST the current value, and
 *   2. the mesh underneath, showing through where layer 1 is
 *      transparent.
 *
 * The boundary between them is --_fill, a percentage the component
 * writes on every input event. One custom property, no per-frame
 * layout, and the mesh itself never moves — which matters, because a
 * mesh that rescaled with the value would shift hue under the user's
 * thumb while they dragged and read as a bug.
 *
 * RTL flips the wedge by flipping its angle, not its stops:
 * --_range-angle is 90deg in LTR and 270deg in RTL, both written by
 * the component from the computed direction.
 *
 * ## Why every pseudo-element gets its own rule
 *
 * ::-webkit-slider-thumb and ::-moz-range-thumb cannot share a
 * selector list. One unknown pseudo-element invalidates the whole
 * list, so a combined rule applies in NEITHER engine — the classic
 * way a custom range ends up styled in Chrome and native in Firefox.
 * Every rule below is duplicated for that reason. Do not merge them.
 */
export const styles = css`
	${ holoTokens }

	:host {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
	}

	input[ type='range' ] {
		appearance: none;
		-webkit-appearance: none;
		flex: 1;
		min-width: 0;
		height: 18px;
		margin: 0;
		padding: 0;
		background: transparent;
		cursor: pointer;
	}

	input[ type='range' ]:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	/* The track. Two layers, first-on-top: the unfilled wedge, then
	   the mesh. See the file docblock for why it is built this way. */
	input[ type='range' ]::-webkit-slider-runnable-track {
		height: 6px;
		border-radius: 999px;
		background-image: linear-gradient(
				var( --_range-angle, 90deg ),
				transparent var( --_fill, 0% ),
				var( --_holo-track ) var( --_fill, 0% )
			),
			var( --_holo-fill );
		background-size: auto, 260% 260%;
		background-position: center, 30% 50%;
		background-repeat: no-repeat;
		box-shadow: inset 0 0 0 1px var( --_holo-track-edge );
	}

	input[ type='range' ]::-moz-range-track {
		height: 6px;
		border-radius: 999px;
		background-image: linear-gradient(
				var( --_range-angle, 90deg ),
				transparent var( --_fill, 0% ),
				var( --_holo-track ) var( --_fill, 0% )
			),
			var( --_holo-fill );
		background-size: auto, 260% 260%;
		background-position: center, 30% 50%;
		background-repeat: no-repeat;
		box-shadow: inset 0 0 0 1px var( --_holo-track-edge );
	}

	/* The thumb. Starlight, so it grips against both the lit and the
	   unlit half of the track. The negative margin centres it on a
	   6px track, which WebKit will not do once the track has a
	   custom height. */
	input[ type='range' ]::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 16px;
		height: 16px;
		margin-top: -5px;
		border: 0;
		border-radius: 50%;
		background: var( --os-ui-switch-knob, #fffbff );
		box-shadow: 0 1px 3px rgba( 12, 11, 15, 0.5 ),
			0 0 0 1px rgba( 12, 11, 15, 0.14 );
		cursor: inherit;
		transition: transform var( --_holo-t ) ease, box-shadow var( --_holo-t ) ease;
	}

	input[ type='range' ]::-moz-range-thumb {
		width: 16px;
		height: 16px;
		border: 0;
		border-radius: 50%;
		background: var( --os-ui-switch-knob, #fffbff );
		box-shadow: 0 1px 3px rgba( 12, 11, 15, 0.5 ),
			0 0 0 1px rgba( 12, 11, 15, 0.14 );
		cursor: inherit;
		transition: transform var( --_holo-t ) ease, box-shadow var( --_holo-t ) ease;
	}

	/* Grows and picks up the Pulse bloom while it is held. */
	input[ type='range' ]:active::-webkit-slider-thumb {
		transform: scale( 1.15 );
		box-shadow: var( --_holo-glow-strong );
	}

	input[ type='range' ]:active::-moz-range-thumb {
		transform: scale( 1.15 );
		box-shadow: var( --_holo-glow-strong );
	}

	/* Focus lands on the thumb, not on the whole 18px-tall input: a
	   ring around the input traces a box whose edges the user cannot
	   see, while a ring on the thumb points at the thing the arrow
	   keys are about to move. */
	input[ type='range' ]:focus-visible {
		outline: none;
	}

	input[ type='range' ]:focus-visible::-webkit-slider-thumb {
		box-shadow: var( --_holo-focus );
	}

	input[ type='range' ]:focus-visible::-moz-range-thumb {
		box-shadow: var( --_holo-focus );
	}

	.os-range-field__value {
		/* Fixed, not min-width: the readout shares a row with the
		   track, so a box that grows with its contents shoves the
		   slider sideways under the thumb the user is dragging. The
		   width comes from the range's own bounds — see
		   readoutWidth() in the component. */
		width: var( --os-ui-range-readout-width, 3ch );
		flex: none;
		text-align: end;
		font-variant-numeric: tabular-nums;
		color: var( --os-ui-fg, #1d2327 );
	}

	@media ( prefers-reduced-motion: reduce ) {
		input[ type='range' ]::-webkit-slider-thumb {
			transition-duration: 1ms;
		}

		input[ type='range' ]::-moz-range-thumb {
			transition-duration: 1ms;
		}
	}
`;
