import { css } from '../../../src/ui/core';

export const installedTableStyles = css`
	:host { min-inline-size: 0; min-block-size: 0; }
	.scroll { block-size: 100%; box-sizing: border-box; scrollbar-gutter: stable; overscroll-behavior: contain; border-radius: 10px; }
	table { table-layout: fixed; min-inline-size: 880px; }
	thead th { block-size: 42px; box-sizing: border-box; font-size: 11px; }
	tbody td { block-size: 76px; box-sizing: border-box; padding-block: 10px; overflow: hidden; }
	.os-plugins__table-identity { display: flex; align-items: center; gap: 12px; min-inline-size: 0; }
	.os-plugins__table-copy { flex: 1; min-inline-size: 0; overflow: hidden; }
	.os-plugins__table-title { color: var(--os-ui-fg, #1d2327); font-weight: 600; }
	.os-plugins__table-line { display: block; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.6; }
	.os-plugins__table-secondary { color: var(--os-ui-fg-muted, #646970); font-size: 11px; }
	.os-plugins__table-version { font-variant-numeric: tabular-nums; }
	.os-plugins__table-update { color: var(--os-ui-warning-fg, #996800); font-size: 11px; }
	.os-plugins__table-state { display: flex; align-items: center; gap: 7px; min-inline-size: 0; font-size: 12px; }
	.os-plugins__table-state::before { content: ''; flex: 0 0 6px; block-size: 6px; border-radius: 50%; background: var(--os-ui-fg-faint, #a7aaad); }
	.os-plugins__table-state[data-active='true']::before { background: var(--os-ui-success-fg, #008a20); }
	.os-plugins__table-actions { display: flex; align-items: center; justify-content: end; gap: 6px; min-inline-size: 0; }
	.os-plugins__table-actions > os-button { inline-size: 90px; min-inline-size: 0; }
	.os-plugins__table-actions > os-button::part(button) { inline-size: 100%; overflow: hidden; white-space: nowrap; padding-inline: 8px; }
	.os-plugins__table-actions > os-action-menu { flex: 0 0 auto; }
	.os-plugins__module-icon { display: grid; position: relative; place-items: center; flex: 0 0 36px; inline-size: 36px; block-size: 36px; border-radius: 9px; overflow: hidden; background: var(--os-ui-surface-sunken, #f0f0f1); color: var(--os-ui-fg-muted, #646970); }
	.os-plugins__module-icon img { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; object-fit: contain; opacity: 0; background: var(--os-ui-surface, #fff); }
	.os-plugins__module-icon img.is-loaded { opacity: 1; }
	.os-plugins__monogram { font-size: 14px; font-weight: 600; }
`;
