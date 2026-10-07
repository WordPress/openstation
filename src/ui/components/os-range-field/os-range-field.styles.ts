import { css } from '../../core';
import { holoTokens } from '../../holo';

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

	input[ type='range' ]::-webkit-slider-runnable-track {
		height: 6px;
		border-radius: 999px;
		background-image: linear-gradient(
				var( --_range-angle, 90deg ),
				transparent var( --_fill, 0% ),
				var( --_holo-track ) var( --_fill, 0% )
			),
			linear-gradient(
				var( --os-ui-accent, #2271b1 ),
				var( --os-ui-accent, #2271b1 )
			);
		background-size: auto, auto;
		background-position: center, center;
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
			linear-gradient(
				var( --os-ui-accent, #2271b1 ),
				var( --os-ui-accent, #2271b1 )
			);
		background-size: auto, auto;
		background-position: center, center;
		background-repeat: no-repeat;
		box-shadow: inset 0 0 0 1px var( --_holo-track-edge );
	}

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

	input[ type='range' ]:active::-webkit-slider-thumb {
		transform: scale( 1.15 );
		box-shadow: var( --_holo-glow-strong );
	}

	input[ type='range' ]:active::-moz-range-thumb {
		transform: scale( 1.15 );
		box-shadow: var( --_holo-glow-strong );
	}

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
