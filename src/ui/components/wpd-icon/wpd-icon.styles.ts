import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var( --wpd-icon-size, 16px );
		height: var( --wpd-icon-size, 16px );
		color: inherit;
		line-height: 1;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.wpd-icon__glyph {
		font-size: var( --wpd-icon-size, 16px );
		width: var( --wpd-icon-size, 16px );
		height: var( --wpd-icon-size, 16px );
		line-height: 1;
		color: inherit;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	/*
	 * char-rendering path. The @font-face for "dashicons" is
	 * registered globally by WordPress core, so it's reachable
	 * from inside any shadow tree — only the
	 * .dashicons-foo:before content rule fails to pierce, which
	 * is what we work around by emitting the glyph as text content.
	 */
	.wpd-icon__glyph--char {
		font-family: dashicons;
		font-style: normal;
		font-weight: normal;
		font-variant: normal;
		text-transform: none;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		speak: none;
	}
	/*
	 * Class-only fallback. font-family belt-and-braces in case
	 * the document's .dashicons rule is scoped to selectors the
	 * shadow span doesn't match.
	 */
	.wpd-icon__glyph.dashicons {
		font-family: dashicons;
	}
`;
