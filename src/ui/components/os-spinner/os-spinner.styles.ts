import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-block;
		--_color: var(
			--os-ui-spinner-color,
			var( --wp-admin-theme-color, #21759b )
		);

		--_accent: var(
			--os-ui-spinner-accent,
			var( --os-ui-fg-on-accent, #fff )
		);
		--_size: var( --os-ui-spinner-size, 48px );
		width: var( --_size );
		height: var( --_size );

		color: var( --_color );
		vertical-align: middle;
		line-height: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	:host( [ preset='inline' ] ) {
		--os-ui-spinner-color: currentColor;
		--os-ui-spinner-size: 16px;
	}

	.root,
	.root svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.root svg .mark {
		fill: var( --_accent );
	}

	@keyframes os-spinner-spin {
		to {
			transform: rotate( 360deg );
		}
	}
	@keyframes os-spinner-scale {
		0%,
		100% {
			transform: scale( 1 );
		}
		50% {
			transform: scale( 1.045 );
		}
	}
	@keyframes os-spinner-opacity {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		.root svg [ style*='animation' ] {
			animation: none !important;
		}
	}
`;
