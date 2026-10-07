import { css } from './core';

const HOLO_FALLBACK =
	'linear-gradient( 124deg, #afa2e8 0%, #f5a8ea 46%, #8ee9f7 100% )';

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

		--_holo-ring-color: var( --os-ui-accent-dim, #2271b1 );

		--_holo-focus: var(
			--os-ui-focus-ring,
			0 0 0 2px rgba( 12, 11, 15, 0.9 ), 0 0 0 4px #f252fc,
				0 0 12px 2px rgba( 242, 82, 252, 0.45 )
		);

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

export const holoGlint = css`
	.os-holo-glint {
		position: absolute;
		inset: 0;
		border-radius: inherit;

		overflow: hidden;
		pointer-events: none;
	}

	.os-holo-glint::before {
		content: '';
		position: absolute;

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

export const holoRing = css`
	.os-holo-ring {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: 0 0 0 0 var( --_holo-ring-color );
		opacity: 0;
		pointer-events: none;
	}

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

	input::placeholder,
	textarea::placeholder {
		color: var( --os-ui-fg-faint, #8c8f94 );
		opacity: 1;
	}

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

		border: 1px solid var( --_holo-track-edge );
		border-radius: 4px;
		background-color: var( --_holo-track );
		background-image: none;
		background-repeat: no-repeat;
		cursor: inherit;
		transition: background-color var( --_holo-t ) ease,
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

	input[ type='checkbox' ]:checked,
	input[ type='checkbox' ]:indeterminate,
	input[ type='radio' ]:checked {
		border-color: transparent;
		background-color: var( --os-ui-accent, #2271b1 );
	}

	input[ type='checkbox' ]:checked:focus-visible,
	input[ type='radio' ]:checked:focus-visible {
		box-shadow: var( --_holo-focus );
	}

	input[ type='checkbox' ]:checked::after {
		content: '';
		position: absolute;
		inset-inline-start: 50%;
		top: 46%;
		width: 3.5px;
		height: 7.5px;
		border: solid var( --os-ui-accent-ink, var( --os-ui-fg-on-accent, #fff ) );
		border-width: 0 2px 2px 0;
		transform: translate( -50%, -50% ) rotate( 45deg );
		animation: os-holo-tick 180ms cubic-bezier( 0.3, 1.4, 0.6, 1 );
	}

	input[ type='checkbox' ]:indeterminate::after {
		content: '';
		position: absolute;
		inset-inline-start: 50%;
		top: 50%;
		width: 8px;
		height: 2px;
		border: 0;
		border-radius: 1px;
		background: var( --os-ui-accent-ink, var( --os-ui-fg-on-accent, #fff ) );
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
		background: var( --os-ui-accent-ink, var( --os-ui-fg-on-accent, #fff ) );
		transform: translate( -50%, -50% );
		animation: os-holo-tick 180ms cubic-bezier( 0.3, 1.4, 0.6, 1 );
	}

	input[ type='checkbox' ]:disabled,
	input[ type='radio' ]:disabled {
		cursor: not-allowed;
	}

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
