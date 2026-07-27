import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-block;
		--wpd-spinner-color: var(
			--wp-admin-theme-color,
			#21759b
		);
		--wpd-spinner-accent: #fff;
		--wpd-spinner-size: 48px;
		width: var( --wpd-spinner-size );
		height: var( --wpd-spinner-size );
		/* SVG inner elements use currentColor for the primary fill /
		   stroke; inheriting the host's text color makes a single
		   variable drive every ring. */
		color: var( --wpd-spinner-color );
		vertical-align: middle;
		line-height: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.root,
	.root svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* The W mark inside the disc — accent color, defaults to white,
	   configurable via the host's --wpd-spinner-accent (or the
	   shorthand "accent" attribute). */
	.root svg .mark {
		fill: var( --wpd-spinner-accent, var( --wpd-accent, #fff ) );
	}

	@keyframes wpd-spinner-spin {
		to {
			transform: rotate( 360deg );
		}
	}
	@keyframes wpd-spinner-scale {
		0%,
		100% {
			transform: scale( 1 );
		}
		50% {
			transform: scale( 1.045 );
		}
	}
	@keyframes wpd-spinner-opacity {
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
