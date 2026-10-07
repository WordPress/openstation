import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var( --os-ui-save-status-font-size, 11px );
		line-height: 1;
		color: var( --os-ui-save-status-fg, currentColor );
		vertical-align: middle;
		min-width: 0;
		opacity: 1;
		pointer-events: auto;
	}

	.os-save-status__indicator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var( --os-ui-save-status-size, 12px );
		height: var( --os-ui-save-status-size, 12px );
		border-radius: 50%;
		flex-shrink: 0;
		box-sizing: border-box;
		background: var( --os-ui-save-status-bg, transparent );
		border: 2px solid
			var(
				--os-ui-save-status-idle-color,
				color-mix(
					in srgb,
					var( --wp-admin-theme-color, #2271b1 ) 55%,
					transparent
				)
			);
		color: var( --wp-admin-theme-color, #2271b1 );
		transition:
			background-color 0.2s ease,
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	:host( [ phase='pending' ] ) .os-save-status__indicator,
	:host( [ phase='saving' ] ) .os-save-status__indicator {
		background: var(
			--os-ui-save-status-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		border-color: transparent;
		color: var( --wp-admin-theme-color, #2271b1 );
		animation: os-save-status-pulse 1.2s ease-in-out infinite;
	}

	:host( [ animation='modem' ][ phase='pending' ] ) .os-save-status__indicator,
	:host( [ animation='modem' ][ phase='saving' ] ) .os-save-status__indicator {
		background: var(
			--os-ui-save-status-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		border-color: transparent;
		color: var( --wp-admin-theme-color, #2271b1 );

		animation:
			os-save-status-modem-stutter 1.8s ease-in-out infinite,
			os-save-status-modem-glow    2.4s ease-in-out infinite;
	}

	@keyframes os-save-status-modem-stutter {

		0%, 4%    { opacity: 1; }

		5%, 30%   { opacity: 0.22; }

		31%, 36%  { opacity: 1; }
		37%, 39%  { opacity: 0.22; }
		40%, 44%  { opacity: 1; }

		45%, 67%  { opacity: 0.22; }

		68%, 76%  { opacity: 1; }

		77%, 100% { opacity: 0.22; }
	}

	@keyframes os-save-status-modem-glow {
		0%, 12%   { box-shadow: 0 0 0 0 transparent; }
		13%, 22%  { box-shadow: 0 0 4px 0 currentColor; }
		23%, 50%  { box-shadow: 0 0 0 0 transparent; }
		51%, 58%  { box-shadow: 0 0 4px 0 currentColor; }
		59%, 84%  { box-shadow: 0 0 0 0 transparent; }
		85%, 94%  { box-shadow: 0 0 5px 0 currentColor; }
		95%, 100% { box-shadow: 0 0 0 0 transparent; }
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host( [ phase='pending' ] ) .os-save-status__indicator,
		:host( [ phase='saving' ] ) .os-save-status__indicator,
		:host( [ animation='modem' ][ phase='pending' ] ) .os-save-status__indicator,
		:host( [ animation='modem' ][ phase='saving' ] ) .os-save-status__indicator {
			animation: none;
			opacity: 0.85;
		}
	}

	:host( [ phase='saved' ] ) .os-save-status__indicator {
		background: var( --os-ui-save-status-saved-bg, var( --os-ui-success-fg, #1d6f42 ) );
		border-color: transparent;
		color: var( --os-ui-save-status-saved-bg, var( --os-ui-success-fg, #1d6f42 ) );
	}

	:host( [ phase='failed' ] ) .os-save-status__indicator {
		background: var( --os-ui-save-status-failed-bg, var( --os-ui-danger, #d63638 ) );
		border-color: transparent;
		color: var( --os-ui-save-status-failed-bg, var( --os-ui-danger, #d63638 ) );
		animation: os-save-status-pulse 0.8s ease-in-out 2;
	}

	:host( [ variant='ring' ] ) .os-save-status__indicator {
		background: transparent;
	}

	:host( [ variant='ring' ][ phase='pending' ] ) .os-save-status__indicator,
	:host( [ variant='ring' ][ phase='saving' ] ) .os-save-status__indicator {
		background: transparent;
		border-color: var(
			--os-ui-save-status-ring-color,
			var( --os-ui-save-status-bg, var( --wp-admin-theme-color, #2271b1 ) )
		);
		animation: os-save-status-ring-pulse 1.6s
			var( --os-ui-ease-loop, ease-in-out ) infinite;
	}

	:host( [ variant='ring' ][ phase='failed' ] ) .os-save-status__indicator {
		background: transparent;
		border-color: var(
			--os-ui-save-status-failed-bg,
			var( --os-ui-danger, #d63638 )
		);
		animation: os-save-status-ring-alert 0.62s
			var( --os-ui-ease-out, ease-out ) 1;
	}

	:host( [ variant='ring' ][ phase='failed' ] ) .os-save-status__glyph {
		color: var(
			--os-ui-save-status-failed-bg,
			var( --os-ui-danger, #d63638 )
		);
	}

	:host( [ variant='ring' ][ phase='saved' ] ) .os-save-status__indicator {
		background: var(
			--os-ui-save-status-saved-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		border-color: transparent;
		animation: os-save-status-ring-land 0.42s
			var( --os-ui-ease-out, ease-out ) 1;
	}

	:host( [ variant='ring' ][ phase='saved' ] ) .os-save-status__glyph,
	:host( [ variant='ring' ][ phase='failed' ] ) .os-save-status__glyph {
		animation: os-save-status-glyph-in 0.24s
			var( --os-ui-ease-out, ease-out ) 0.08s 1 backwards;
	}

	@keyframes os-save-status-ring-pulse {
		0%, 100% { opacity: 0.45; scale: 0.9; }
		50%      { opacity: 1;    scale: 1; }
	}

	@keyframes os-save-status-ring-land {
		0%   { scale: 0.82; }
		55%  { scale: 1.06; }
		100% { scale: 1; }
	}

	@keyframes os-save-status-ring-alert {
		0%   { scale: 0.9;  }
		25%  { scale: 1.08; }
		50%  { scale: 0.98; }
		75%  { scale: 1.04; }
		100% { scale: 1;    }
	}

	@keyframes os-save-status-glyph-in {
		0%   { opacity: 0; scale: 0.4; }
		100% { opacity: 1; scale: 1;   }
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host( [ variant='ring' ] ) .os-save-status__indicator,
		:host( [ variant='ring' ] ) .os-save-status__glyph {
			animation: none;
			opacity: 1;
			scale: 1;
		}
	}

	@keyframes os-save-status-pulse {
		0%, 100% { opacity: 0.55; transform: scale( 0.9 ); }
		50%      { opacity: 1;    transform: scale( 1 ); }
	}

	:host( [ mode='pill' ] ) .os-save-status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 10px;
		border-radius: 999px;
		background: var( --os-ui-save-status-pill-bg, transparent );
		font-weight: 500;
		white-space: nowrap;
	}
	:host( [ mode='pill' ][ phase='saving' ] ) .os-save-status,
	:host( [ mode='pill' ][ phase='pending' ] ) .os-save-status {
		background: var( --os-ui-save-status-pill-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.04 ) ) );
		color: var( --os-ui-save-status-pill-fg, var( --os-ui-fg-muted, #50575e ) );
	}
	:host( [ mode='pill' ][ phase='saved' ] ) .os-save-status {
		background: var( --os-ui-save-status-pill-bg, rgba( 30, 132, 73, 0.12 ) );
		color: var( --os-ui-save-status-pill-fg, var( --os-ui-success-fg, #1d6f42 ) );
	}
	:host( [ mode='pill' ][ phase='failed' ] ) .os-save-status {
		background: var( --os-ui-save-status-pill-bg, rgba( 214, 54, 56, 0.12 ) );
		color: var( --os-ui-save-status-pill-fg, var( --os-ui-danger-hover, #a02622 ) );
	}

	.os-save-status__label {
		min-width: 0;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:host( [ phase='saved' ] ) .os-save-status__glyph,
	:host( [ phase='failed' ] ) .os-save-status__glyph {
		display: inline-block;
		color: var( --os-ui-fg-on-accent, #fff );

		width: calc( var( --os-ui-save-status-size, 12px ) * 0.66 );
		height: calc( var( --os-ui-save-status-size, 12px ) * 0.66 );
	}
	.os-save-status__glyph {
		display: none;
	}
	.os-save-status__glyph svg {
		display: block;
		width: 100%;
		height: 100%;
	}
`;
