/**
 * `<os-stat>` — one stat tile.
 *
 * A bordered box: big value, small uppercase label, optional
 * footnote. Every colour and size resolves through a public token
 * read into a private alias, so desktop themes and host stylesheets
 * can restyle a stat without forking the component (and the palette
 * stays reachable — see the token-reachability rule).
 */
import { css } from '../../core';

export const styles = css`
	:host {
		--_border: var( --os-ui-stat-border, var( --os-ui-border, #dcdcde ) );
		--_bg: var( --os-ui-stat-bg, transparent );
		--_value-color: var( --os-ui-stat-value-color, var( --wp-admin-theme-color, #2271b1 ) );
		--_value-size: var( --os-ui-stat-value-size, 20px );
		--_label-color: var( --os-ui-stat-label-color, var( --os-ui-fg-muted, #646970 ) );
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var( --os-ui-stat-padding, 10px 12px );
		border: 1px solid var( --_border );
		border-radius: var( --os-ui-stat-radius, 8px );
		background: var( --_bg );
		min-inline-size: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.value {
		font-size: var( --_value-size );
		font-weight: 700;
		line-height: 1.1;
		color: var( --_value-color );
		font-variant-numeric: tabular-nums;
	}

	.label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var( --_label-color );
	}

	.caption {
		font-size: 11px;
		color: var( --_label-color );
	}

	/* The severity swatch reads the app runtime's tone contract: the
	   host sits in the light DOM, where data-tone on it resolves
	   --os-app-tone, and the value inherits in here. */
	.swatch {
		display: inline-block;
		inline-size: 10px;
		block-size: 10px;
		border-radius: 3px;
		flex: none;
		background: var( --os-app-tone, var( --os-ui-fg-muted, #646970 ) );
	}
`;
