import { css } from '../../../src/ui/core';

export const paperStyles = css`
.desktop-mode-posts .os-app-list__toolbar-right.os-app-list__bulk--footer {
	flex: 0 0 auto;
	align-content: start;
	gap: 8px;
	padding: 8px 12px;
}
.os-posts-desk__continuation { grid-column: 1 / -1; padding: 14px 8px; text-align: center; font-size: 11px; color: var( --os-ui-fg-muted, #646970 ); }
.os-posts-desk__filter-toggle { display: none; }
.os-posts-desk__metrics {
	display: flex;
	gap: 22px;
	margin-block: 18px 0;
	--os-ui-stat-padding: 0;
	--os-ui-stat-border: transparent;
	--os-ui-stat-value-size: 24px;
	--os-ui-stat-value-color: var( --os-ui-fg, #1d2327 );
}
.os-posts-desk__metrics os-stat { min-inline-size: 62px; }
.desktop-mode-posts:not(.desktop-mode-pages) .os-posts-desk__story {
	position: relative;
	border-radius: 3px 12px 12px 3px;
	padding-inline-start: 34px;
	background-image: repeating-linear-gradient(transparent 0 27px, var( --os-ui-surface-subtle, #f0f0f1 ) 27px 28px);
	background-position: 0 10px;
}
.desktop-mode-posts:not(.desktop-mode-pages) .os-posts-desk__story::before {
	content: '';
	position: absolute;
	inset-block: 0;
	inset-inline-start: 22px;
	border-inline-start: 1px solid var( --os-ui-accent-dim, #c3c4c7 );
	opacity: .3;
}
.desktop-mode-pages .os-posts-desk__story {
	position: relative;
	border-radius: 3px 22px 3px 3px;
	box-shadow: 3px 4px 0 -1px var( --os-ui-surface, #fff ), 3px 4px 0 0 var( --os-ui-border, #dcdcde );
}
.desktop-mode-pages .os-posts-desk__story::after {
	content: '';
	position: absolute;
	inset-block-start: 0;
	inset-inline-end: 0;
	inline-size: 16px;
	block-size: 16px;
	border-end-start-radius: 3px;
	border-inline-start: 1px solid var( --os-ui-border, #dcdcde );
	border-block-end: 1px solid var( --os-ui-border, #dcdcde );
	background: var( --os-ui-surface-sunken, #f6f7f7 );
	pointer-events: none;
}
.desktop-mode-pages .os-posts-desk__select { margin-inline-end: 6px; }
.os-pages-atlas-host { flex: 1; min-block-size: 0; display: flex; position: relative; }
@container content-desk (max-width: 600px) {
	.os-posts-desk__hero { padding: 8px 12px; min-block-size: 36px; gap: 8px; }
	.os-posts-desk__hero h2 { font-size: 17px; margin: 0; letter-spacing: -.03em; }
	.os-posts-desk__hero p, .os-posts-desk__eyebrow { display: none; }
	.desktop-mode-posts .os-app-list__toolbar { display: none; }
	.desktop-mode-posts[data-desk-options="true"] .os-app-list__toolbar { display: flex; padding: 6px 12px; }
	.os-posts-desk__tools { padding: 6px 12px; gap: 8px; }
	.os-posts-desk__tools .os-app-list__search { flex: 1; min-inline-size: 0; }
	.os-posts-desk__filter-toggle { display: block; flex: 0 0 auto; }
	.os-posts-desk__tools:not(.is-expanded) > os-select,
	.os-posts-desk__tools:not(.is-expanded) > os-checkbox { display: none; }
	.os-posts-desk__tools.is-expanded > os-checkbox { flex-basis: 100%; }
	.os-posts-desk__feed, .desktop-mode-pages .os-posts-desk__feed { display: block; padding: 8px 12px 14px; }
	.os-posts-desk__story, .desktop-mode-pages .os-posts-desk__story,
	.os-posts-desk__story.is-current { padding: 9px 12px; margin-block-end: 9px; }
	.desktop-mode-posts:not(.desktop-mode-pages) .os-posts-desk__story { padding-inline-start: 24px; }
	.desktop-mode-posts:not(.desktop-mode-pages) .os-posts-desk__story::before { inset-inline-start: 14px; }
	.os-posts-desk__story-top { margin-block-end: 3px; min-block-size: 18px; }
	.os-posts-desk__story-content, .desktop-mode-pages .os-posts-desk__story-content { flex-direction: row; gap: 10px; }
	.os-posts-desk__page-mark, .os-posts-desk__kicker { display: none; }
	.os-posts-desk__story h3, .desktop-mode-pages .os-posts-desk__story h3 { font-size: 18px; margin-block-end: 2px; line-height: 1.2; }
	.os-posts-desk__thumbnail { inline-size: 46px; block-size: 46px; }
	.os-posts-desk__excerpt { -webkit-line-clamp: 1; line-clamp: 1; font-size: 11px; line-height: 1.4; }
	.desktop-mode-pages .os-posts-desk__excerpt { display: none; }
	.os-posts-desk__metrics { gap: 14px; margin-block-start: 7px; --os-ui-stat-value-size: 14px; }
	.os-posts-desk__metrics os-stat { min-inline-size: 0; flex-direction: row; align-items: baseline; }
	.os-posts-desk__metrics os-stat::part(value), .os-posts-desk__metrics os-stat::part(label) { display: inline; }
	.os-posts-desk__metrics os-stat::part(label) { font-size: 9px; margin-inline-start: 4px; letter-spacing: 0; text-transform: none; }
	.os-posts-desk__story-foot { margin-block-start: 4px; gap: 4px; flex-wrap: nowrap; }
	.desktop-mode-pages .os-posts-desk__story-foot > .os-posts-desk__byline,
	.os-posts-desk__story-foot > .os-posts-desk__byline { flex: 1; margin: 0; font-size: 10px; min-inline-size: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.os-posts-desk__story-foot os-button { --os-ui-button-padding: 5px 9px; font-size: 11px; }
	.desktop-mode-posts .os-app-list__pager { padding: 6px 12px; gap: 4px; flex-wrap: nowrap; }
	.desktop-mode-posts .os-app-list__pager-meta { font-size: 10px; flex: 1; }
	.desktop-mode-posts .os-app-list__pager-perpage { display: none; }
	.desktop-mode-posts .os-app-list__pager-nav { flex: 0 0 auto; }
	.desktop-mode-posts .os-app-list__pager-nav os-button { font-size: 10px; }
}
`;
