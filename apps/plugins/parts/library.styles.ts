import { css } from '../../../src/ui/core';

/** Layout styles travel with the versioned app bundle. */
export const libraryStyles = css`
/* Installed plugins: collections, shelves and a focused inspector. */
.desktop-mode-plugins [hidden] {
	display: none !important;
}


.os-plugins__workspace {
	display: flex;
	flex: 1;
	min-block-size: 0;
	min-inline-size: 0;
	overflow: hidden;
}

.os-plugins__library {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-block-size: 0;
	min-inline-size: 0;
	container: plugin-library / inline-size;
	background: var( --os-ui-surface-sunken, #f6f7f7 );
}

.os-plugins__library-head {
	padding: 24px 24px 0;
	flex: 0 0 auto;
}

.os-plugins__library-intro {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.os-plugins__eyebrow {
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.13em;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-plugins__library-intro h2 {
	font-size: clamp( 20px, 3cqi, 28px );
	font-weight: 600;
	letter-spacing: -0.035em;
	line-height: 1.2;
	margin: 7px 0 20px;
	color: var( --os-ui-fg, #1d2327 );
}

.os-plugins__collections {
	display: grid;
	grid-template-columns: repeat( 4, minmax( 0, 1fr ) );
	gap: 8px;
}

.os-plugins__collection {
	min-inline-size: 0;
	border-radius: 12px;
	border: 1px solid var( --os-ui-border, #dcdcde );
	background: var( --os-ui-surface, #fff );
}

.os-plugins__collection::part( button ) {
	inline-size: 100%;
	padding: 13px 14px;
	justify-content: start;
	gap: 8px;
	border-radius: 12px;
}

.os-plugins__collection strong {
	font-size: 20px;
	font-weight: 600;
	margin-inline-start: auto;
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.03em;
}

.os-plugins__collection .dashicons {
	font-size: 17px;
	inline-size: 17px;
	block-size: 17px;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-plugins__collection[aria-pressed="true"] {
	border-color: var( --os-ui-accent, #2271b1 );
	background: var( --os-ui-accent-soft, #f0f6fc );
}

.os-plugins__collection[aria-pressed="true"] .dashicons {
	color: var( --os-ui-accent, #2271b1 );
}

.os-plugins__library-tools {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 18px 24px 14px;
	flex: 0 0 auto;
}

.os-plugins__library-tools .os-app-list__search {
	flex: 1;
	min-inline-size: 100px;
	max-inline-size: none;
}

.os-plugins__library-tools os-select {
	flex: 0 0 152px;
	min-inline-size: 0;
}

.os-plugins__view-switch {
	display: flex; flex: 0 0 auto; gap: 2px; padding: 3px;
	border: 1px solid var(--os-ui-border, #dcdcde); border-radius: 8px;
	background: var(--os-ui-surface, #fff);
}
.os-plugins__view-switch .dashicons { font-size: 16px; inline-size: 16px; block-size: 16px; }

.os-plugins__library-scroll {
	overflow: auto;
	scrollbar-gutter: stable;
	flex: 1;
	min-block-size: 0;
	padding: 0 24px 28px;
	overscroll-behavior: contain;
}

.os-plugins__workspace[data-view="table"] .os-plugins__library-scroll {
	display: flex;
	flex-direction: column;
	overflow: hidden;
	padding-block-end: 16px;
}

.os-plugins__library-scroll > os-table {
	flex: 1;
	min-block-size: 0;
	min-inline-size: 0;
	--os-ui-table-font-size: 12px;
}

.os-plugins__inspector-bar > span {
	min-inline-size: 0;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.os-plugins__shelf + .os-plugins__shelf {
	margin-block-start: 30px;
}

.os-plugins__shelf-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	margin-block: 14px;
}

.os-plugins__shelf-heading h3 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
	letter-spacing: -0.015em;
}

.os-plugins__shelf-heading h3 > span {
	margin-inline-start: 6px;
	font-size: 12px;
	color: var( --os-ui-fg-muted, #646970 );
	font-weight: 400;
}

.os-plugins__shelf-heading p {
	margin: 4px 0 0;
	font-size: 12px;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-plugins__module {
	min-inline-size: 0;
	--os-ui-card-padding: 18px;
	--os-ui-card-radius: 14px;
	--os-ui-card-gap: 14px;
}

.os-plugins__module[data-lane="update"] {
	border-block-start: 2px solid var( --os-ui-warning-fg, #dba617 );
}

.os-plugins__module-top {
	display: flex;
	align-items: center;
	gap: 12px;
	min-inline-size: 0;
}

.os-plugins__module-icon {
	display: grid;
	flex: 0 0 44px;
	inline-size: 44px;
	block-size: 44px;
	position: relative;
	place-items: center;
	overflow: hidden;
	border-radius: 11px;
	background: var( --os-ui-surface-sunken, #f0f0f1 );
	color: var( --os-ui-fg-muted, #646970 );
}

.os-plugins__module-icon img {
	position: absolute;
	inset: 0;
	inline-size: 100%;
	block-size: 100%;
	object-fit: contain;
	z-index: 1;
	opacity: 0;
	background: var( --os-ui-surface, #fff );
}

.os-plugins__module-icon img.is-loaded {
	opacity: 1;
}

.os-plugins__monogram {
	font-size: 16px;
	font-weight: 600;
	letter-spacing: -0.04em;
}

.os-plugins__module-identity {
	min-inline-size: 0;
	flex: 1;
}

.os-plugins__module-identity h3 {
	font-size: 14px;
	line-height: 1.35;
	margin: 0 0 3px;
	font-weight: 600;
	overflow-wrap: anywhere;
	color: var( --os-ui-fg, #1d2327 );
}

.os-plugins__module-identity > span {
	display: block;
	color: var( --os-ui-fg-muted, #646970 );
	font-size: 11px;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.os-plugins__pick {
	flex: 0 0 auto;
	max-inline-size: 22px;
	overflow: hidden;
}

.os-plugins__module-description {
	margin: 0;
	color: var( --os-ui-fg-muted, #646970 );
	font-size: 12px;
	line-height: 1.6;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	min-block-size: 3.2em;
	overflow-wrap: anywhere;
}

.os-plugins__module-meta {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 6px;
	color: var( --os-ui-fg-muted, #646970 );
	font-size: 11px;
	margin-block-start: auto;
}

.os-plugins__state {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.os-plugins__state::before {
	content: '';
	inline-size: 6px;
	block-size: 6px;
	border-radius: 50%;
	background: var( --os-ui-fg-faint, #a7aaad );
}

.os-plugins__state[data-active="true"]::before {
	background: var( --os-ui-success-fg, #008a20 );
}

.os-plugins__next-version {
	color: var( --os-ui-warning-fg, #996800 );
	font-weight: 600;
}

.os-plugins__module-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 6px;
	padding-block-start: 12px;
	border-block-start: 1px solid var( --os-ui-border, #dcdcde );
}

.os-plugins__module-actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 6px;
	min-inline-size: 0;
}

.os-plugins__module-actions os-button {
	max-inline-size: 100%;
}

.os-plugins__module-actions os-button::part( button ) {
	white-space: normal;
	overflow-wrap: anywhere;
}

.os-plugins__update-hint {
	font-size: 11px;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-plugins__selection {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
	padding: 12px 20px;
	border-block-start: 1px solid var( --os-ui-border, #dcdcde );
	background: var( --os-ui-surface, #fff );
}

.os-plugins__selection-count {
	font-size: 12px;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-plugins__selection-actions {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
	margin-inline-start: auto;
}

.os-plugins__inspector {
	display: flex;
	flex-direction: column;
	flex: 0 0 43%;
	min-inline-size: 340px;
	max-inline-size: 540px;
	min-block-size: 0;
	border-inline-start: 1px solid var( --os-ui-border, #dcdcde );
	background: var( --os-ui-surface, #fff );
}

.os-plugins__inspector-bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px;
	border-block-end: 1px solid var( --os-ui-border, #dcdcde );
}

.os-plugins__inspector-bar > span {
	font-size: 11px;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-plugins__inspector-updates {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 10px 16px;
	font-size: 11px;
	flex-wrap: wrap;
}

.os-plugins__inspector > .os-plugins__module-actions {
	padding: 12px 16px;
	border-block-end: 1px solid var( --os-ui-border, #dcdcde );
}

.os-plugins__inspector-scroll {
	flex: 1;
	min-block-size: 0;
	overflow: auto;
	overscroll-behavior: contain;
}

.os-plugins__auto-update-fixed, .os-plugins__auto-update-none {
	color: var( --os-ui-fg-muted, #646970 );
}

.os-plugins__library-empty {
	padding: 48px 12px;
	text-align: center;
}

.os-plugins__library-empty > .dashicons {
	font-size: 32px;
	inline-size: 32px;
	block-size: 32px;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-plugins__library-empty h3 {
	font-size: 18px;
	font-weight: 500;
}

.os-plugins__library-empty p {
	color: var( --os-ui-fg-muted, #646970 );
	margin-block-end: 20px;
}

.os-plugins__loading {
	display: grid;
	gap: 16px;
	padding: 36px 12px;
	color: var( --os-ui-fg-muted, #646970 );
}


@container plugin-library ( max-width: 660px ) {
	.os-plugins__library-tools { flex-wrap: wrap; }
	.os-plugins__library-tools .os-app-list__search { flex-basis: 100%; }
	.os-plugins__library-tools os-select { flex: 1; }

	.os-plugins__library-head {
		padding: 16px 16px 0;
	}

	.os-plugins__library-tools {
		padding: 14px 16px 10px;
	}

	.os-plugins__library-scroll {
		padding-inline: 16px;
	}

	.os-plugins__collection::part( button ) {
		padding: 10px 8px;
		flex-wrap: wrap;
		gap: 4px;
		font-size: 11px;
	}

	.os-plugins__collection .dashicons {
		display: none;
	}

	.os-plugins__collection strong {
		font-size: 17px;
	}

	.os-plugins__collections {
		gap: 5px;
	}

}

@container ( max-width: 760px ) {
	.os-plugins__workspace[data-detail-open="true"] > .os-plugins__library {
		display: none;
	}

	.os-plugins__inspector {
		flex: 1;
		min-inline-size: 0;
		max-inline-size: none;
		border-inline-start: 0;
	}

}

@container plugin-library ( max-width: 420px ) {
	.os-plugins__library-intro h2 {
		font-size: 21px;
		margin-block-end: 14px;
	}

	.os-plugins__eyebrow {
		font-size: 9px;
	}

	.os-plugins__library-tools {
		flex-wrap: wrap;
		gap: 8px;
	}

	.os-plugins__library-tools .os-app-list__search {
		flex-basis: 100%;
	}

	.os-plugins__library-tools os-select {
		flex: 1;
	}

	.os-plugins__collection::part( button ) {
		flex-direction: column-reverse;
		padding: 8px 4px;
	}

	.os-plugins__collection strong {
		margin-inline-start: 0;
	}

	.os-plugins__shelf-heading p {
		display: none;
	}

	.os-plugins__selection {
		gap: 8px;
		padding: 10px 12px;
	}

	.os-plugins__selection-actions {
		order: 1;
		flex-basis: 100%;
	}

}
`;
