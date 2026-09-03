/**
 * Plugins app — the detail panel's stylesheet.
 *
 * Part of the `desktop-mode-plugins` client view. `<os-table>` renders
 * the expandable-row panel inside its own shadow DOM, which document
 * stylesheets never reach, so `installed-detail.ts` ships these rules
 * as a `<style>` element in the same shadow tree. Every selector is
 * namespaced under `.os-plugins__detail*` so nothing bleeds into the
 * other rows.
 *
 * @public
 */

export const PANEL_STYLES = `
.os-plugins__detail {
	display: block;
	background: var( --os-ui-surface-subtle, rgba( 0, 0, 0, 0.025 ) );
	border-block-start: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
	border-block-end: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
	color: var( --os-ui-fg, inherit );
	font-size: 13px;
	line-height: 1.55;
}
.os-plugins__detail-hero {
	background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.6 ) );
	border-block-end: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
}
.os-plugins__detail-hero-inner {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 14px 24px;
}
.os-plugins__detail-hero-icon {
	flex: 0 0 44px;
	width: 44px;
	height: 44px;
	border-radius: 10px;
	overflow: hidden;
	background: var( --os-ui-surface, rgba( 0, 0, 0, 0.04 ) );
	box-shadow: 0 0 0 1px var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ) inset;
	display: flex;
	align-items: center;
	justify-content: center;
}
.os-plugins__detail-hero-icon img {
	width: 100%;
	height: 100%;
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
	display: block;
}
.os-plugins__detail-hero-icon .dashicons {
	font-size: 20px;
	width: 20px;
	height: 20px;
	line-height: 20px;
	color: var( --os-ui-fg-muted, #888 );
}
.os-plugins__detail-hero-text {
	flex: 1 1 auto;
	min-width: 0;
}
.os-plugins__detail-title {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
	line-height: 1.25;
	letter-spacing: -0.005em;
	color: var( --os-ui-fg, inherit );
}
.os-plugins__detail-byline {
	margin: 0;
	font-size: 12.5px;
	color: var( --os-ui-fg-muted, #666 );
}
.os-plugins__detail-byline a {
	color: inherit;
	text-decoration: underline;
	text-decoration-color: var( --os-ui-border-strong, rgba( 0, 0, 0, 0.25 ) );
}
.os-plugins__detail-byline a:hover {
	color: var( --wp-admin-theme-color, #2271b1 );
}
.os-plugins__detail-tabs-wrap {
	padding: 0 24px;
	background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.6 ) );
	border-block-end: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
}
.os-plugins__detail-tabs {
	display: block;
}
.os-plugins__detail-body {
	padding: 22px 24px 26px;
	max-width: 100%;
}
.os-plugins__detail-chip-strip {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}
.os-plugins__detail-stars-pill {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 4px 12px;
	border-radius: 999px;
	background: rgba( 234, 179, 8, 0.12 );
	color: #8a5a00;
	font-size: 12px;
	font-weight: 600;
}
.os-plugins__detail-actions {
	padding-top: 4px;
}
.os-plugins__detail-html {
	color: var( --os-ui-fg, inherit );
	font-size: 14px;
	line-height: 1.65;
	max-width: 78ch;
}
.os-plugins__detail-html h1,
.os-plugins__detail-html h2,
.os-plugins__detail-html h3,
.os-plugins__detail-html h4 {
	margin: 16px 0 6px;
	line-height: 1.3;
	font-weight: 600;
}
.os-plugins__detail-html h1 { font-size: 18px; }
.os-plugins__detail-html h2 { font-size: 16px; }
.os-plugins__detail-html h3 { font-size: 14.5px; }
.os-plugins__detail-html h4 { font-size: 13.5px; }
.os-plugins__detail-html p {
	margin: 0 0 10px;
}
.os-plugins__detail-html ul,
.os-plugins__detail-html ol {
	margin: 0 0 10px;
	padding-inline-start: 22px;
}
.os-plugins__detail-html li { margin-bottom: 4px; }
.os-plugins__detail-html code,
.os-plugins__detail-html pre {
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 12px;
	background: rgba( 0, 0, 0, 0.06 );
	border-radius: 4px;
}
.os-plugins__detail-html code { padding: 1px 6px; }
.os-plugins__detail-html pre {
	padding: 10px 12px;
	overflow-x: auto;
	margin: 0 0 10px;
}
.os-plugins__detail-html pre code {
	background: transparent;
	padding: 0;
}
.os-plugins__detail-html a {
	color: var( --wp-admin-theme-color, #2271b1 );
}
.os-plugins__detail-html img {
	display: block;
	max-width: 100%;
	max-height: 220px;
	width: auto;
	height: auto;
	object-fit: contain;
	margin: 8px 0;
	border-radius: 6px;
}
.os-plugins__detail-grid {
	width: 100%;
}
.os-plugins__detail-fact {
	min-width: 0;
}
.os-plugins__detail-fact-head {
	display: flex;
	align-items: center;
	gap: 8px;
	color: var( --os-ui-fg-muted, #666 );
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}
.os-plugins__detail-fact-head .dashicons {
	font-size: 14px;
	width: 14px;
	height: 14px;
	line-height: 14px;
}
.os-plugins__detail-fact-value {
	font-size: 14px;
	color: var( --os-ui-fg, inherit );
	word-break: break-word;
	overflow-wrap: anywhere;
	font-weight: 500;
}
.os-plugins__detail-fact-value code {
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 12.5px;
	background: rgba( 0, 0, 0, 0.06 );
	padding: 2px 7px;
	border-radius: 4px;
	font-weight: 400;
}
.os-plugins__detail-fact-value a {
	color: var( --wp-admin-theme-color, #2271b1 );
	text-decoration: none;
}
.os-plugins__detail-fact-value a:hover {
	text-decoration: underline;
}
.os-plugins__detail-changelog,
.os-plugins__detail-changelog-entry {
	width: 100%;
}
.os-plugins__detail-changelog-head {
	display: flex;
	align-items: center;
	gap: 10px;
}
.os-plugins__detail-changelog-latest {
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var( --os-ui-fg-muted, #666 );
}
.os-plugins__detail-faq {
	width: 100%;
}
.os-plugins__detail-faq-item {
	background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.7 ) );
	border: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
	border-radius: 12px;
	overflow: hidden;
	transition: box-shadow 160ms ease, border-color 160ms ease;
}
.os-plugins__detail-faq-item[open] {
	border-color: var( --wp-admin-theme-color, #2271b1 );
	box-shadow: 0 4px 14px rgba( 0, 0, 0, 0.06 );
}
.os-plugins__detail-faq-q {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 14px 16px;
	cursor: pointer;
	list-style: none;
	user-select: none;
}
.os-plugins__detail-faq-q::-webkit-details-marker {
	display: none;
}
.os-plugins__detail-faq-q:hover {
	background: rgba( 0, 0, 0, 0.025 );
}
.os-plugins__detail-faq-q-text {
	flex: 1 1 auto;
	font-size: 14px;
	font-weight: 600;
	color: var( --os-ui-fg, inherit );
	line-height: 1.4;
}
.os-plugins__detail-faq-chevron {
	flex: 0 0 auto;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: rgba( 0, 0, 0, 0.05 );
	color: var( --os-ui-fg-muted, #555 );
	transition: transform 200ms cubic-bezier( 0.2, 0.8, 0.2, 1 ), background 160ms ease;
}
.os-plugins__detail-faq-item[open] .os-plugins__detail-faq-chevron {
	transform: rotate( 180deg );
	background: var( --wp-admin-theme-color, #2271b1 );
	color: #fff;
}
.os-plugins__detail-faq-a {
	padding: 4px 16px 16px;
	border-block-start: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.06 ) );
	background: rgba( 0, 0, 0, 0.012 );
}
@media ( prefers-reduced-motion: reduce ) {
	.os-plugins__detail-faq-chevron,
	.os-plugins__detail-faq-item {
		transition: none;
	}
}
.os-plugins__detail-reviews,
.os-plugins__detail-reviews-grid {
	width: 100%;
}
.os-plugins__detail-reviews-more,
.os-plugins__detail-reviews-cta {
	display: flex;
	justify-content: center;
	padding-top: 12px;
}
.os-plugins__detail-review {
	width: 100%;
	height: 100%;
	box-sizing: border-box;
}
.os-plugins__detail-review-head {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
}
.os-plugins__detail-review-date {
	margin-inline-start: auto;
	font-size: 11.5px;
	color: var( --os-ui-fg-muted, #888 );
}
.os-plugins__detail-review-body {
	margin: 0;
	font-size: 13px;
	color: var( --os-ui-fg, inherit );
	line-height: 1.55;
	display: -webkit-box;
	-webkit-line-clamp: 4;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.os-plugins__detail-review-link {
	font-size: 12px;
	font-weight: 600;
	color: var( --wp-admin-theme-color, #2271b1 );
	text-decoration: none;
}
.os-plugins__detail-review-link:hover {
	text-decoration: underline;
}
.os-plugins__detail-loading-block {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	padding: 12px 14px;
	border-radius: 10px;
	background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.7 ) );
	border: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
	color: var( --os-ui-fg-muted, #666 );
	font-size: 13px;
}
@media ( max-width: 720px ) {
	.os-plugins__detail-reviews-grid,
	.os-plugins__detail-grid {
		grid-template-columns: 1fr !important;
	}
}
`;
