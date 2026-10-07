import { css } from '../../core';
import { holoTokens } from '../../holo';

export const styles = css`
	${ holoTokens }

	:host {

		--_h: 22px;

		--_pad: 2px;

		--_knob: calc( var( --_h ) - 2 * var( --_pad ) );
		--_travel: calc( var( --_w ) - var( --_knob ) - 2 * var( --_pad ) );
		--_w: calc( var( --_h ) * 1.85 );

		--_drag: 0px;

		--_dir: 1;

		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		line-height: 1.3;
		color: var( --os-ui-fg, #1d2327 );
		cursor: pointer;

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

		box-shadow: inset 0 0 0 1px var( --_holo-track-edge );
		cursor: inherit;
		outline: none;
		transition: background-color var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease;
	}

	button:disabled {
		cursor: not-allowed;
	}

	:host( [ checked ] ) button {
		background-image: none;
		background-color: var( --os-ui-accent, #2271b1 );
		box-shadow: none;
	}

	button:focus-visible {
		box-shadow: var( --_holo-focus ),
			inset 0 0 0 1px var( --_holo-track-edge );
	}

	:host( [ checked ] ) button:focus-visible {
		box-shadow: var( --_holo-focus );
	}

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

	.os-switch__knob {
		transform: translateX( calc( var( --_dir ) * var( --_drag ) ) );
	}

	:host( [ checked ] ) .os-switch__knob {
		transform: translateX(
			calc( var( --_dir ) * ( var( --_travel ) + var( --_drag ) ) )
		);
	}

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

	:host( [ data-dragging ] ) .os-switch__knob {
		transition: width var( --_holo-t ) ease;
	}

	.os-switch__label {
		line-height: 1.3;
	}

	.os-switch__label:empty {
		display: none;
	}

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
