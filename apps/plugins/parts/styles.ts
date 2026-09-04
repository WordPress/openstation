/**
 * Plugins app — the stylesheets that live inside `<os-table>`.
 *
 * Part of the `desktop-mode-plugins` client view. The Installed
 * table's cells and its expandable-row detail panel render inside
 * `<os-table>`'s shadow DOM, which document stylesheets never reach,
 * so their rules ship here and are adopted ONCE onto that shadow root
 * ({@link adoptStyles}) — one sheet for every row instead of a
 * `<style>` per expanded panel. Every selector is namespaced under
 * `.os-plugins__*`; colours resolve through the palette tokens with
 * the literal look as the fallback.
 *
 * @public
 */

import { REVIEW_STYLES } from './reviews';

/** The Installed table's cells. */
const CELL_STYLES = `
.os-plugins__name-cell { display: flex; align-items: center; gap: 12px; min-width: 0; padding-block: 4px; }
.os-plugins__name-icon { flex: 0 0 32px; width: 32px; height: 32px; max-width: 32px; max-height: 32px; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var( --os-ui-surface-sunken, rgba( 0, 0, 0, 0.04 ) ); box-sizing: border-box; }
.os-plugins__name-icon img { width: 100%; height: 100%; max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.os-plugins__name-icon .dashicons { font-size: 18px; width: 18px; height: 18px; line-height: 18px; color: var( --os-ui-fg-muted, #888 ); }
.os-plugins__name-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; line-height: 1.35; }
.os-plugins__name-text > strong { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.os-plugins__name-path { display: block; font-size: 0.78em; color: var( --os-ui-fg-muted, #888 ); font-family: var( --os-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace ); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.os-plugins__version-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.os-plugins__update-badge { font-size: 0.78em; background: var( --os-ui-badge-warning-bg, rgba( 245, 175, 0, 0.18 ) ); color: var( --os-ui-warning-fg, #915f00 ); padding: 1px 7px; border-radius: 999px; font-weight: 600; }
.os-plugins__author-cell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.os-plugins__auto-update { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.os-plugins__auto-update-fixed { color: var( --os-ui-fg-muted, #50575e ); }
.os-plugins__auto-update-none { color: var( --os-ui-fg-faint, #787c82 ); }
.os-plugins__row-actions { display: inline-flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: nowrap; }
.os-plugins__row-actions os-button { flex: 0 0 auto; }
.os-plugins__update-hint { font-size: 0.78em; color: var( --os-ui-fg-muted, #50575e ); }
`;

/** The expandable-row detail panel. */
const PANEL_STYLES = `
.os-plugins__detail { display: block; background: var( --os-ui-surface-subtle, rgba( 0, 0, 0, 0.025 ) ); border-block-start: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ); border-block-end: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ); color: var( --os-ui-fg, inherit ); font-size: 13px; line-height: 1.55; }
.os-plugins__detail-hero { background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.6 ) ); border-block-end: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ); }
.os-plugins__detail-hero-inner { display: flex; align-items: center; gap: 14px; padding: 14px 24px; }
.os-plugins__detail-hero-icon { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 10px; overflow: hidden; background: var( --os-ui-surface, rgba( 0, 0, 0, 0.04 ) ); box-shadow: 0 0 0 1px var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ) inset; display: flex; align-items: center; justify-content: center; }
.os-plugins__detail-hero-icon img { width: 100%; height: 100%; max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.os-plugins__detail-hero-icon .dashicons { font-size: 20px; width: 20px; height: 20px; line-height: 20px; color: var( --os-ui-fg-muted, #888 ); }
.os-plugins__detail-hero-text { flex: 1 1 auto; min-width: 0; }
.os-plugins__detail-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.25; letter-spacing: -0.005em; color: var( --os-ui-fg, inherit ); }
.os-plugins__detail-byline { margin: 0; font-size: 12.5px; color: var( --os-ui-fg-muted, #666 ); }
.os-plugins__detail-byline a { color: inherit; text-decoration: underline; text-decoration-color: var( --os-ui-border-strong, rgba( 0, 0, 0, 0.25 ) ); }
.os-plugins__detail-byline a:hover { color: var( --wp-admin-theme-color, #2271b1 ); }
.os-plugins__detail-tabs-wrap { padding: 0 24px; background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.6 ) ); border-block-end: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ); }
.os-plugins__detail-tabs { display: block; }
.os-plugins__detail-body { padding: 22px 24px 26px; max-width: 100%; }
.os-plugins__detail-chip-strip { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.os-plugins__detail-stars-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; background: var( --os-ui-badge-warning-bg, rgba( 234, 179, 8, 0.12 ) ); color: var( --os-ui-warning-fg, #8a5a00 ); font-size: 12px; font-weight: 600; }
.os-plugins__detail-actions { padding-top: 4px; }
.os-plugins__detail-html { color: var( --os-ui-fg, inherit ); font-size: 14px; line-height: 1.65; max-width: 78ch; }
.os-plugins__detail-html h1, .os-plugins__detail-html h2, .os-plugins__detail-html h3, .os-plugins__detail-html h4 { margin: 16px 0 6px; line-height: 1.3; font-weight: 600; }
.os-plugins__detail-html h1 { font-size: 18px; }
.os-plugins__detail-html h2 { font-size: 16px; }
.os-plugins__detail-html h3 { font-size: 14.5px; }
.os-plugins__detail-html h4 { font-size: 13.5px; }
.os-plugins__detail-html p { margin: 0 0 10px; }
.os-plugins__detail-html ul, .os-plugins__detail-html ol { margin: 0 0 10px; padding-inline-start: 22px; }
.os-plugins__detail-html li { margin-bottom: 4px; }
.os-plugins__detail-html code, .os-plugins__detail-html pre { font-family: var( --os-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace ); font-size: 12px; background: var( --os-ui-surface-sunken, rgba( 0, 0, 0, 0.06 ) ); border-radius: 4px; }
.os-plugins__detail-html code { padding: 1px 6px; }
.os-plugins__detail-html pre { padding: 10px 12px; overflow-x: auto; margin: 0 0 10px; }
.os-plugins__detail-html pre code { background: transparent; padding: 0; }
.os-plugins__detail-html a { color: var( --wp-admin-theme-color, #2271b1 ); }
.os-plugins__detail-html img { display: block; max-width: 100%; max-height: 220px; width: auto; height: auto; object-fit: contain; margin: 8px 0; border-radius: 6px; }
.os-plugins__detail-grid { width: 100%; }
.os-plugins__detail-fact { min-width: 0; }
.os-plugins__detail-fact-head { display: flex; align-items: center; gap: 8px; color: var( --os-ui-fg-muted, #666 ); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.os-plugins__detail-fact-head .dashicons { font-size: 14px; width: 14px; height: 14px; line-height: 14px; }
.os-plugins__detail-fact-value { font-size: 14px; color: var( --os-ui-fg, inherit ); word-break: break-word; overflow-wrap: anywhere; font-weight: 500; }
.os-plugins__detail-fact-value code { font-family: var( --os-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace ); font-size: 12.5px; background: var( --os-ui-surface-sunken, rgba( 0, 0, 0, 0.06 ) ); padding: 2px 7px; border-radius: 4px; font-weight: 400; }
.os-plugins__detail-fact-value a { color: var( --wp-admin-theme-color, #2271b1 ); text-decoration: none; }
.os-plugins__detail-fact-value a:hover { text-decoration: underline; }
.os-plugins__detail-changelog, .os-plugins__detail-changelog-entry { width: 100%; }
.os-plugins__detail-changelog-head { display: flex; align-items: center; gap: 10px; }
.os-plugins__detail-changelog-latest { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var( --os-ui-fg-muted, #666 ); }
.os-plugins__detail-faq { width: 100%; }
.os-plugins__detail-faq-item { background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.7 ) ); border: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ); border-radius: 12px; overflow: hidden; transition: box-shadow 160ms ease, border-color 160ms ease; }
.os-plugins__detail-faq-item[open] { border-color: var( --wp-admin-theme-color, #2271b1 ); box-shadow: var( --os-ui-shadow-sm, 0 4px 14px rgba( 0, 0, 0, 0.06 ) ); }
.os-plugins__detail-faq-q { display: flex; align-items: center; gap: 10px; padding: 14px 16px; cursor: pointer; list-style: none; user-select: none; }
.os-plugins__detail-faq-q::-webkit-details-marker { display: none; }
.os-plugins__detail-faq-q:hover { background: var( --os-ui-hover, rgba( 0, 0, 0, 0.025 ) ); }
.os-plugins__detail-faq-q-text { flex: 1 1 auto; font-size: 14px; font-weight: 600; color: var( --os-ui-fg, inherit ); line-height: 1.4; }
.os-plugins__detail-faq-chevron { flex: 0 0 auto; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var( --os-ui-hover, rgba( 0, 0, 0, 0.05 ) ); color: var( --os-ui-fg-muted, #555 ); transition: transform 200ms cubic-bezier( 0.2, 0.8, 0.2, 1 ), background 160ms ease; }
.os-plugins__detail-faq-item[open] .os-plugins__detail-faq-chevron { transform: rotate( 180deg ); background: var( --wp-admin-theme-color, #2271b1 ); color: var( --os-ui-fg-on-accent, #fff ); }
.os-plugins__detail-faq-a { padding: 4px 16px 16px; border-block-start: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.06 ) ); background: var( --os-ui-surface-subtle, rgba( 0, 0, 0, 0.012 ) ); }
@media ( prefers-reduced-motion: reduce ) { .os-plugins__detail-faq-chevron, .os-plugins__detail-faq-item { transition: none; } }
@media ( max-width: 720px ) { .os-plugins__reviews-grid, .os-plugins__detail-grid { grid-template-columns: 1fr !important; } }
`;

/** Everything the table's shadow tree needs: cells, the panel, the reviews. */
export const TABLE_STYLES = CELL_STYLES + PANEL_STYLES + REVIEW_STYLES;

const adopted = new WeakMap< ShadowRoot, Set< string > >();

/**
 * Adopt a stylesheet onto a shadow root once. Constructable
 * stylesheets when the engine has them (one parsed sheet shared by
 * every row), a single `<style>` otherwise.
 */
export function adoptStyles( root: ShadowRoot, key: string, css: string ): void {
	let keys = adopted.get( root );
	if ( ! keys ) {
		keys = new Set();
		adopted.set( root, keys );
	}
	if ( keys.has( key ) ) {
		return;
	}
	keys.add( key );
	if ( 'adoptedStyleSheets' in root && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype ) {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync( css );
		root.adoptedStyleSheets = [ ...root.adoptedStyleSheets, sheet ];
		return;
	}
	const style = document.createElement( 'style' );
	style.setAttribute( 'data-os-plugins-styles', key );
	style.textContent = css;
	root.appendChild( style );
}
