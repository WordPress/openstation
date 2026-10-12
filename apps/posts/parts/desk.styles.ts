import { css } from '../../../src/ui/core';

/** Layout styles travel with the versioned app bundle. */
export const deskStyles = css`
/* Content workspaces adapt to the window, including a narrow floating window. */
.desktop-mode-posts {
	container: content-desk / inline-size;
	color: var( --os-ui-fg, #1d2327 );
	background: var( --os-ui-surface-sunken, #f6f7f7 );
}

.desktop-mode-posts [hidden] {
	display: none !important;
}

.os-posts-desk__hero {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 20px;
	padding: 24px 26px 20px;
	background: var( --os-ui-surface, #fff );
}

.os-posts-desk__eyebrow,
.os-posts-desk__inspector-head {
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.14em;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-posts-desk__hero h2 {
	margin: 7px 0;
	font-size: clamp( 24px, 3.4cqi, 38px );
	font-weight: 500;
	letter-spacing: -0.045em;
	line-height: 1.1;
	color: inherit;
}

.os-posts-desk__hero p {
	margin: 0;
	font-size: 12px;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-posts-desk__hero > os-button {
	flex-shrink: 0;
}

.desktop-mode-posts .os-app-list__toolbar {
	padding: 12px 24px;
	background: var( --os-ui-surface, #fff );
	flex-wrap: wrap;
}

.desktop-mode-posts .os-app-list__toolbar-left {
	flex-wrap: wrap;
	min-inline-size: 0;
}

.desktop-mode-posts .os-app-list__search {
	min-inline-size: 150px;
	flex: 1 1 190px;
}

.os-posts-desk__tools {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 9px 24px;
	border-block-end: 1px solid var( --os-ui-border, #dcdcde );
	background: var( --os-ui-surface, #fff );
	flex-shrink: 0;
}

.os-posts-desk__tools > os-checkbox {
	margin-inline-end: auto;
	font-size: 11px;
}

.os-posts-desk__tools os-select {
	inline-size: 155px;
}

.os-posts-desk__workspace {
	display: flex;
	flex: 1;
	min-block-size: 0;
	min-inline-size: 0;
	overflow: hidden;
}

.os-posts-desk__feed {
	flex: 1;
	min-inline-size: 0;
	overflow: auto;
	overscroll-behavior: contain;
	scrollbar-gutter: stable;
	padding: 20px 24px 32px;
}

.os-posts-desk__story {
	padding: 20px;
	border: 1px solid var( --os-ui-border, #dcdcde );
	border-radius: 12px;
	background: var( --os-ui-surface, #fff );
	margin-block-end: 12px;
	min-inline-size: 0;
	transition: border-color 140ms ease, box-shadow 140ms ease;
}

.os-posts-desk__story:hover {
	border-color: var( --os-ui-accent-dim, #2271b1 );
}

.os-posts-desk__story.is-current {
	border-inline-start: 3px solid var( --os-ui-accent, #2271b1 );
	padding-inline-start: 18px;
}

.os-posts-desk__story-top {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-block-end: 13px;
	min-block-size: 22px;
}

.os-posts-desk__id {
	margin-inline-start: auto;
	flex: 0 0 auto;
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	--os-ui-button-padding: 3px 5px;
}
.os-posts-desk__id::part(button) { color: var( --os-ui-fg-muted, #646970 ); gap: 5px; min-block-size: 24px; }
.os-posts-desk__id .dashicons { font-size: 12px; inline-size: 12px; block-size: 12px; }
.os-posts-desk__id + .os-posts-desk__select { margin-inline-start: 0; }

.os-posts-desk__select {
	margin-inline-start: auto;
	flex: 0 0 20px;
	inline-size: 20px;
	block-size: 20px;
}

.os-posts-desk__status,
.os-posts-desk__role {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: 10px;
	font-weight: 600;
	line-height: 1.6;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-posts-desk__status::before {
	content: "";
	inline-size: 6px;
	block-size: 6px;
	border-radius: 50%;
	background: currentColor;
}

.os-posts-desk__status[data-status="publish"] {
	color: var( --os-ui-success-fg, #008a20 );
}

.os-posts-desk__status[data-status="draft"],
.os-posts-desk__status[data-status="pending"] {
	color: var( --os-ui-warning, #996800 );
}

.os-posts-desk__status[data-status="future"],
.os-posts-desk__role {
	color: var( --os-ui-accent, #2271b1 );
}

.os-posts-desk__role {
	border-inline-start: 1px solid var( --os-ui-border, #dcdcde );
	padding-inline-start: 8px;
}

.os-posts-desk__story-content {
	display: flex;
	gap: 18px;
	align-items: flex-start;
}

.os-posts-desk__story-copy {
	min-inline-size: 0;
	flex: 1;
}

.os-posts-desk__thumbnail {
	inline-size: 104px;
	block-size: 104px;
	object-fit: cover;
	border-radius: 7px;
	flex: 0 0 auto;
}

.os-posts-desk__kicker {
	font-size: 10px;
	letter-spacing: 0.06em;
	color: var( --os-ui-fg-muted, #646970 );
	margin-block-end: 5px;
	overflow-wrap: anywhere;
}

.os-posts-desk__story h3 {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 23px;
	font-weight: 400;
	line-height: 1.18;
	letter-spacing: -0.025em;
	margin: 0 0 8px;
	color: inherit;
	overflow-wrap: anywhere;
}

.os-posts-desk__story h3 a {
	color: inherit;
	text-decoration: none;
}

.os-posts-desk__story h3 a:hover {
	text-decoration: underline;
	text-underline-offset: 3px;
}

.os-posts-desk__excerpt {
	font-size: 12px;
	line-height: 1.65;
	margin: 0;
	color: var( --os-ui-fg-muted, #646970 );
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	overflow-wrap: anywhere;
}

.os-posts-desk__story-foot {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 6px;
	margin-block-start: 16px;
}

.os-posts-desk__byline {
	font-size: 11px;
	line-height: 1.5;
	color: var( --os-ui-fg-muted, #646970 );
	margin-inline-end: auto;
	overflow-wrap: anywhere;
}

.os-posts-desk__story-foot > .os-posts-desk__byline {
	flex: 1 1 100px;
}

/* A plugin column on the card: value over label, the os-stat silhouette at
   the strip's scale, so Provenance or any other registered cell sits beside
   Words / Comments / Tags without pretending to be a number. */
.os-posts-desk__plugin-stat {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}

.os-posts-desk__plugin-stat-value {
	display: flex;
	align-items: center;
	min-height: 22px;
}

.os-posts-desk__plugin-stat-label {
	font-size: 10px;
	line-height: 1.2;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-posts-desk__lock {
	font-size: 11px;
	color: var( --os-ui-warning, #996800 );
}

.os-posts-desk__inspector {
	flex: 0 0 330px;
	max-inline-size: 40%;
	min-inline-size: 0;
	display: flex;
	flex-direction: column;
	border-inline-start: 1px solid var( --os-ui-border, #dcdcde );
	background: var( --os-ui-surface, #fff );
}

.os-posts-desk__inspector-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 12px 18px;
	border-block-end: 1px solid var( --os-ui-border, #dcdcde );
}

.os-posts-desk__inspector-head os-button {
	letter-spacing: normal;
}

.os-posts-desk__inspector-scroll {
	flex: 1;
	min-block-size: 0;
	overflow: auto;
	padding: 20px;
	overscroll-behavior: contain;
}

.os-posts-desk__cover {
	inline-size: 100%;
	max-block-size: 180px;
	object-fit: cover;
	border-radius: 8px;
	margin-block-end: 20px;
}

.os-posts-desk__inspector h2 {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 27px;
	font-weight: 400;
	line-height: 1.2;
	letter-spacing: -0.03em;
	margin: 10px 0;
	color: inherit;
	overflow-wrap: anywhere;
}

.os-posts-desk__preview {
	font-size: 13px;
	line-height: 1.8;
	color: var( --os-ui-fg-muted, #646970 );
	overflow-wrap: anywhere;
}

.os-posts-desk__dates {
	padding-block: 16px;
	border-block: 1px solid var( --os-ui-border, #dcdcde );

	/* The band's own rhythm: tighter and smaller than a facts list
	   in a detail pane, which is what the kit's defaults are sized
	   for. The layout itself is the component's. */
	--os-ui-facts-font-size: 11px;
	--os-ui-facts-row-gap: 4px;
	--os-ui-facts-column-gap: 10px;
}

.os-posts-desk__fields section {
	padding-block: 8px;
	font-size: 12px;
	overflow-wrap: anywhere;
}

.os-posts-desk__fields h3 {
	font-size: 11px;
	font-weight: 600;
	margin: 0 0 8px;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-posts-desk__inspector-actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 12px;
	padding: 16px 20px;
	border-block-start: 1px solid var( --os-ui-border, #dcdcde );
	font-size: 11px;
}

.os-posts-desk__inspector-actions a {
	color: var( --os-ui-accent, #2271b1 );
}

.os-posts-desk__empty {
	padding: 48px 20px;
	text-align: center;
	color: var( --os-ui-fg-muted, #646970 );
}

.os-posts-desk__empty > .dashicons {
	font-size: 40px;
	inline-size: 40px;
	block-size: 40px;
}

.desktop-mode-posts .os-app-list__bulk--footer {
	padding: 10px 24px;
}

.desktop-mode-posts .os-app-list__bulk--footer .os-app-list__count,
.desktop-mode-posts .os-app-list__bulk--footer .os-app-list__bulk-actions {
	flex: 0 1 auto;
}

/* Pages are documents in a directory, with their location above the title. */
.desktop-mode-pages .os-posts-desk__feed {
	display: grid;
	grid-template-columns: repeat( auto-fill, minmax( 230px, 1fr ) );
	align-content: start;
	gap: 16px;
}

.desktop-mode-pages .os-posts-desk__story {
	margin: 0;
	display: flex;
	flex-direction: column;
}

.desktop-mode-pages .os-posts-desk__story-content {
	flex-direction: column;
	flex: 1;
}

.desktop-mode-pages .os-posts-desk__story h3,
.desktop-mode-pages .os-posts-desk__inspector h2 {
	font-family: inherit;
	font-weight: 600;
	font-size: 21px;
}

.os-posts-desk__page-mark {
	border: 1px solid var( --os-ui-border, #dcdcde );
	border-radius: 5px;
	inline-size: 42px;
	block-size: 50px;
	padding: 8px;
	color: var( --os-ui-accent, #2271b1 );
	background: var( --os-ui-surface-sunken, #f6f7f7 );
}

.os-posts-desk__page-mark i {
	display: block;
	block-size: 2px;
	margin-block-start: 4px;
	background: var( --os-ui-border, #dcdcde );
}

.os-posts-desk__page-mark i:last-child {
	inline-size: 60%;
}

@container content-desk (max-width: 850px) {
	.os-posts-desk__inspector {
		display: none;
	}

	.os-posts-desk__inspector.is-open {
		display: flex;
		flex: 1;
		max-inline-size: none;
		border-inline-start: 0;
	}

	.os-posts-desk__workspace.has-detail .os-posts-desk__feed {
		display: none;
	}

	.os-posts-desk__hero {
		padding: 20px;
	}
}

@container content-desk (max-width: 540px) {
	.os-posts-desk__hero {
		padding: 16px;
		gap: 12px;
	}

	.os-posts-desk__hero p,
	.os-posts-desk__eyebrow {
		display: none;
	}

	.os-posts-desk__hero h2 {
		font-size: 23px;
	}

	.desktop-mode-posts .os-app-list__toolbar,
	.os-posts-desk__tools {
		padding: 8px 12px;
	}

	.os-posts-desk__tools {
		flex-wrap: wrap;
	}

	.os-posts-desk__tools > os-checkbox {
		flex-basis: 100%;
	}

	.os-posts-desk__tools os-select {
		flex: 1;
		inline-size: 130px;
	}

	.os-posts-desk__feed {
		padding: 12px;
	}

	.os-posts-desk__story {
		padding: 16px;
	}

	.os-posts-desk__story.is-current {
		padding-inline-start: 14px;
	}

	.os-posts-desk__thumbnail {
		inline-size: 64px;
		block-size: 64px;
	}

	.os-posts-desk__story h3 {
		font-size: 21px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.os-posts-desk__story {
		transition: none;
	}
}

.os-posts-desk__tools .os-app-list__search {
	flex: 1 1 170px;
	min-inline-size: 130px;
}

.os-posts-desk__tools > os-checkbox {
	flex-shrink: 0;
}

@container content-desk (max-width: 700px) {
	.os-posts-desk__tools {
		flex-wrap: wrap;
	}

	.os-posts-desk__tools .os-app-list__search {
		flex-basis: calc( 100% - 145px );
	}

	.os-posts-desk__tools > os-checkbox {
		flex-basis: auto;
	}

	.os-posts-desk__tools os-select {
		flex: 1 1 130px;
		min-inline-size: 130px;
	}
}

.desktop-mode-pages .os-posts-desk__story-foot > .os-posts-desk__byline {
	flex-basis: 100%;
	margin-block-end: 4px;
}

html[data-os-mode="mobile"] .desktop-mode-posts .os-app-list__toolbar-left {
	flex: 1 1 140px;
}

html[data-os-mode="mobile"] .desktop-mode-posts .os-app-list__toolbar-trailing {
	flex: 0 0 auto;
}
`;
