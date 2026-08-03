import { css } from '../../core';

/**
 * The base defaults read the public tokens INTO private aliases rather
 * than declaring them. A custom property declared on `:host` matches
 * the host element, which outranks anything the host would inherit —
 * and the palette and every desktop theme declare on an ancestor. So
 * `--wpd-spinner-accent: #fff` here did not set a default: it pinned
 * the mark white and made the token the comment below advertises
 * ("configurable via `--wpd-spinner-accent`") unreachable from a
 * theme. Legacy carries all three names and none of them landed.
 *
 * The `color` / `accent` / `size` attributes still win — they reflect
 * onto INLINE custom properties on the host, which the `var()` lookups
 * find first — and so does `[preset='inline']`, which keeps declaring
 * the public token so an inline style still outranks it.
 */
export const styles = css`
	:host {
		display: inline-block;
		--_color: var(
			--wpd-spinner-color,
			var( --wp-admin-theme-color, #21759b )
		);
		--_accent: var( --wpd-spinner-accent, var( --wpd-accent, #fff ) );
		--_size: var( --wpd-spinner-size, 48px );
		width: var( --_size );
		height: var( --_size );
		/* SVG inner elements use currentColor for the primary fill /
		   stroke; inheriting the host's text color makes a single
		   variable drive every ring. */
		color: var( --_color );
		vertical-align: middle;
		line-height: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	/* The inline indicator lives beside a line of text: text-sized by
	   default, and tinted from the text rather than from the admin
	   theme color, so it can't lose contrast against a surface the
	   component knows nothing about. Both are plain defaults — the
	   size / color attributes still win, since those reflect onto
	   inline styles on the host. */
	:host( [ preset='inline' ] ) {
		--wpd-spinner-color: currentColor;
		--wpd-spinner-size: 16px;
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
		fill: var( --_accent );
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
