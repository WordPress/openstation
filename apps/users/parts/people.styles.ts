import { css } from '../../../src/ui/core';
export const peopleStyles = css`
.desktop-mode-users { container: people / inline-size; color: var( --os-ui-fg, #1d2327 ); background: var( --os-ui-surface-sunken, #f6f7f7 ); }
.desktop-mode-users [hidden] { display: none !important; }
.os-people__hero { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 25px; background: var( --os-ui-surface, #fff ); }
.os-people__hero h2 { color: inherit; margin: 4px 0 8px; font-size: clamp(24px, 3.4cqi, 37px); font-weight: 500; letter-spacing: -.045em; line-height: 1.12; }
.os-people__eyebrow { font-size: 10px; letter-spacing: .15em; color: var( --os-ui-fg-muted, #646970 ); }
.os-people__hero p { margin: 0; font-size: 12px; color: var( --os-ui-fg-muted, #646970 ); }
.os-people__tools { display: flex; gap: 9px; padding: 10px 24px; align-items: center; flex-wrap: wrap; border-block-end: 1px solid var( --os-ui-border, #dcdcde ); background: var( --os-ui-surface, #fff ); }
.os-people__tools os-text-field { flex: 1; min-inline-size: 150px; }
.os-people__tools os-select { inline-size: 140px; }
.os-people__options { display: none; }

.os-people__cards { flex: 1; min-block-size: 0; min-inline-size: 0; overflow: auto; padding: 20px 24px; display: grid; grid-template-columns: repeat(auto-fill,minmax(min(100%,350px),1fr)); gap: 18px; align-content: start; overscroll-behavior: contain; }
.os-people__card { position: relative; isolation: isolate; box-sizing: border-box; display: grid; grid-template-rows: auto 1fr auto auto; gap: 10px; aspect-ratio: 1.586; min-inline-size: 0; border: 1px solid var( --os-ui-border, #dcdcde ); border-radius: 15px; padding: 14px 16px 8px; background: var( --os-ui-surface, #fff ); box-shadow: 0 2px 4px var( --os-ui-surface-subtle, #f0f0f1 ); }
.os-people__card::before { content: ''; position: absolute; z-index: -1; pointer-events: none; inset: 0; border-radius: inherit; background: repeating-radial-gradient(ellipse at 105% 15%, transparent 0 8px, var( --os-ui-surface-subtle, #f0f0f1 ) 9px 10px, transparent 11px 16px); opacity: .55; mask-image: linear-gradient(to left, #000, transparent 70%); }
.os-people__card::after { content: ''; position: absolute; pointer-events: none; inset-block: 28px; inset-inline-start: 0; inline-size: 3px; background: var( --os-ui-accent, #2271b1 ); border-start-end-radius: 3px; border-end-end-radius: 3px; opacity: .65; }
.os-people__card.is-selected { outline: 2px solid var( --os-ui-accent, #2271b1 ); outline-offset: -2px; }
.os-people__id-header { display: flex; align-items: center; gap: 8px; min-block-size: 18px; }
.os-people__issuer { display: inline-flex; align-items: center; gap: 5px; font-size: 9px; font-weight: 600; letter-spacing: .12em; color: var( --os-ui-fg, #1d2327 ); }
.os-people__issuer > span:last-child { font-weight: 400; color: var( --os-ui-fg-muted, #646970 ); }
.os-people__issuer .dashicons { font-size: 17px; inline-size: 17px; block-size: 17px; }
.os-people__you { font-size: 10px; color: var( --os-ui-accent, #2271b1 ); }
.os-people__select { margin-inline-start: auto; inline-size: 18px; block-size: 18px; flex: 0 0 18px; }
.os-people__identity { display: grid; grid-template-columns: 84px minmax(0,1fr); align-items: center; gap: 16px; }
.os-people__portrait { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 10px 4px 7px; border: 1px solid var( --os-ui-border, #dcdcde ); border-radius: 9px; background: var( --os-ui-surface-sunken, #f6f7f7 ); }
.os-people__member-number { font: 9px/1.2 ui-monospace, monospace; letter-spacing: .13em; color: var( --os-ui-fg-muted, #646970 ); }
.os-people__credentials { min-inline-size: 0; }
.os-people__identity h3 { margin: 0; font-size: 20px; line-height: 1.15; color: inherit; }
.os-people__identity h3 os-button { font: inherit; --os-ui-button-padding: 0; }
.os-people__identity h3 os-button::part(button) { font: inherit; text-align: start; border: 0; background: transparent; padding: 0; white-space: normal; overflow-wrap: anywhere; }
.os-people__identity p { margin: 4px 0 0; font-size: 10px; color: var( --os-ui-fg-muted, #646970 ); }
.os-people__handle { overflow-wrap: anywhere; }
.os-people__email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.os-people__joined time { color: var( --os-ui-fg, #1d2327 ); }
.os-people__roles { display: flex; flex-wrap: wrap; gap: 4px; margin-block: 6px; }
.os-people__roles span { border: 1px solid var( --os-ui-border, #dcdcde ); border-radius: 4px; padding: 2px 6px; font-size: 9px; color: var( --os-ui-fg-muted, #646970 ); background: var( --os-ui-surface, #fff ); }
.os-people__stats { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)) 28px; gap: 8px; align-items: center; padding-block: 7px 0; border-block-start: 1px solid var( --os-ui-border, #dcdcde ); --os-ui-stat-padding: 0; --os-ui-stat-border: transparent; --os-ui-stat-value-size: 21px; --os-ui-stat-value-color: var( --os-ui-fg, #1d2327 ); }
.os-people__stats os-stat::part(label) { font-size: 8px; }
.os-people__seal { display: grid; place-items: center; inline-size: 26px; block-size: 26px; border: 1px solid var( --os-ui-border, #dcdcde ); border-radius: 50%; color: var( --os-ui-fg-muted, #646970 ); opacity: .5; }
.os-people__seal .dashicons { font-size: 16px; inline-size: 16px; block-size: 16px; }
.os-people__card > footer { display: flex; align-items: center; gap: 8px; min-inline-size: 0; }
.os-people__last-login { flex: 1; min-inline-size: 0; font-size: 9px; color: var( --os-ui-fg-muted, #646970 ); }
.os-people__card os-action-menu { margin-inline-start: auto; flex: 0 0 auto; }
.os-people__presence { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; color: var( --os-ui-fg-muted, #646970 ); white-space: nowrap; }
.os-people__presence::before { content: ''; inline-size: 5px; block-size: 5px; border-radius: 50%; background: currentColor; }
.os-people__presence[data-presence="online"] { color: var( --os-ui-success-fg, #008a20 ); }
.os-people__presence[data-presence="inactive"] { color: var( --os-ui-warning-fg, #996800 ); }
.os-people__continuation { grid-column: 1 / -1; flex: 0 0 auto; padding: 14px; text-align: center; font-size: 11px; color: var( --os-ui-fg-muted, #646970 ); }
.os-people__empty { grid-column: 1 / -1; padding: 50px 20px; text-align: center; color: var( --os-ui-fg-muted, #646970 ); }
.os-people__scope { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 8px 24px; font-size: 11px; color: var( --os-ui-fg-muted, #646970 ); border-block-end: 1px solid var( --os-ui-border, #dcdcde ); }
.os-people__role-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(250px,1fr)); gap: 20px; padding: 24px; }
.os-people__room { border: 1px solid var( --os-ui-border, #dcdcde ); background: var( --os-ui-surface, #fff ); border-radius: 18px; padding: 24px; text-align: center; min-inline-size: 0; }
.os-people__orbit { position: relative; inline-size: 210px; block-size: 210px; margin: 12px auto 20px; border: 1px solid var( --os-ui-border, #dcdcde ); border-radius: 50%; }
.os-people__orbit::before { content: ''; position: absolute; inset: 25px; border: 1px dashed var( --os-ui-border, #dcdcde ); border-radius: 50%; }
.os-people__orbit-center { position: absolute; inset: 45px; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 50%; background: var( --os-ui-surface-sunken, #f6f7f7 ); gap: 6px; }
.os-people__orbit-center strong { font-size: 36px; font-weight: 500; line-height: 1; }
.os-people__orbit-center span { font-size: 11px; max-inline-size: 95px; overflow-wrap: anywhere; color: var( --os-ui-fg-muted, #646970 ); }
.os-people__satellite { position: absolute; transform: translate(-50%,-50%); background: var( --os-ui-surface, #fff ); padding: 3px; border-radius: 50%; }
.os-people__room > p { font-size: 11px; color: var( --os-ui-fg-muted, #646970 ); min-block-size: 28px; }
.os-people__insights { flex: 1; min-block-size: 0; overflow: auto; }
.desktop-mode-users .os-app-list__toolbar-right.os-app-list__bulk--footer { flex: 0 0 auto; max-block-size: 38%; overflow: auto; align-content: start; }
.desktop-mode-users .os-app-list__bulk--footer .os-app-list__count { flex: 0 0 auto; }
.desktop-mode-users .os-app-list__bulk--footer .os-app-list__bulk-actions { flex: 1; }
@container people (max-width: 640px) {
	.os-people__hero { padding: 10px 12px; gap: 10px; }
	.os-people__hero h2 { font-size: 20px; margin: 0; }
	.os-people__hero p, .os-people__eyebrow { display: none; }
	.os-people__tools { padding: 7px 12px; gap: 7px; }
	.os-people__options { display: block; }
	.os-people__tools:not(.is-expanded) .os-people__extra { display: none; }
	.os-people__cards { display: block; padding: 9px 12px; }
	.os-people__card { aspect-ratio: auto; gap: 7px; padding: 10px 12px 5px; margin-block-end: 10px; }
	.os-people__identity { grid-template-columns: 72px minmax(0,1fr); gap: 12px; }
	.os-people__portrait { padding: 5px 2px; gap: 4px; }
	.os-people__identity h3 { font-size: 17px; }
	.os-people__identity p { font-size: 9px; margin-block-start: 3px; }
	.os-people__roles { margin-block: 4px; }
	.os-people__stats { --os-ui-stat-value-size: 18px; padding-block-start: 5px; }
	.os-people__last-login { font-size: 8px; }
	.os-people__scope { padding: 7px 12px; }
	.os-people__role-grid { padding: 12px; }
}
`;
