import { css } from '../../../../src/ui/core';

export const directoryStyles = css`
.os-term-canvas__intro {
	padding: 22px 24px 18px;
	background: var( --os-ui-surface, #fff );
	flex-shrink: 0;
}

.os-term-canvas__intro h2 {
	font-size: 28px;
	font-weight: 500;
	letter-spacing: -0.035em;
	margin: 0 0 6px;
	color: var( --os-ui-fg, #1d2327 );
}

.os-term-canvas__intro p {
	font-size: 12px;
	margin: 0;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-term-directory {
	position: absolute;
	inset-block: 12px;
	inset-inline-start: 12px;
	inline-size: min( 300px, calc( 100% - 24px ) );
	z-index: 5;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 16px;
	border: 1px solid var( --os-ui-border, #dcdcde );
	border-radius: 12px;
	background: var( --os-ui-surface, #fff );
	color: var( --os-ui-fg, #1d2327 );
	box-shadow: var( --os-ui-shadow-sheet, 0 6px 24px rgba( 0, 0, 0, 0.12 ) );
}

.os-term-directory header {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.os-term-directory h3 {
	font-size: 17px;
	margin: 0;
	color: inherit;
}

.os-term-directory__count {
	font-size: 11px;
	margin: 0;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-term-directory__items {
	overflow: auto;
	min-block-size: 0;
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.os-term-directory__items os-button {
	flex-shrink: 0;
}

.os-term-directory__items os-button::part( button ) {
	inline-size: 100%;
	justify-content: space-between;
	text-align: start;
	white-space: normal;
}

.os-term-directory__items small {
	color: var( --os-ui-fg-muted, #646970 );
	white-space: nowrap;
	font-size: 10px;
}

@container content-desk (max-width: 540px) {
	.os-term-canvas__intro {
		padding: 14px;
	}

	.os-term-canvas__intro h2 {
		font-size: 23px;
	}

	.os-term-canvas__intro p {
		display: none;
	}
}

.os-term-canvas__toolbar {
	flex-wrap: wrap;
	padding: 12px 20px;
}

.os-term-canvas__toolbar > button,
.os-term-directory__toggle {
	flex-shrink: 0;
	white-space: nowrap;
}

.os-term-canvas__toolbar .os-term-canvas__hint {
	flex-basis: 100%;
	font-size: 11px;
}

.os-term-canvas__search-input {
	border-radius: 8px;
	border: 1px solid var( --os-ui-border, #dcdcde );
	padding: 8px 10px;
	background: var( --os-ui-surface, #fff );
	color: var( --os-ui-fg, #1d2327 );
}
`;
