import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var( --os-ui-icon-size, 16px );
		height: var( --os-ui-icon-size, 16px );
		color: inherit;
		line-height: 1;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.os-icon__glyph {
		font-size: var( --os-ui-icon-size, 16px );
		width: var( --os-ui-icon-size, 16px );
		height: var( --os-ui-icon-size, 16px );
		line-height: 1;
		color: inherit;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.os-icon__glyph--char {
		font-family: dashicons;
		font-style: normal;
		font-weight: normal;
		font-variant: normal;
		text-transform: none;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		speak: none;
	}

	.os-icon__glyph.dashicons {
		font-family: dashicons;
	}
`;
