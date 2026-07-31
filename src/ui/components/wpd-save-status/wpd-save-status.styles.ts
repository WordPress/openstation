/**
 * `<wpd-save-status>` — shadow-DOM styles. The host renders one of
 * three layouts (dot / icon / pill) and a state-driven color that
 * pulses for in-flight saves and brief-flash-fades on settle. Every
 * paintable property reads from a CSS custom property first so a
 * theme can retune one indicator or every indicator.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var( --wpd-save-status-font-size, 11px );
		line-height: 1;
		color: var( --wpd-save-status-fg, currentColor );
		vertical-align: middle;
		min-width: 0;
		opacity: 1;
		pointer-events: auto;
	}

	/*
	 * Indicator is ALWAYS visible — like a real modem's "ready" LED.
	 * Idle state shows a hollow ring tinted by the user's accent
	 * (so the title bar always reads "alive, ready"); activity
	 * phases swap to a solid fill plus the chaotic modem-blink with
	 * a soft glow. The accent ring keeps idle calm; the blink reads
	 * as data flowing.
	 *
	 * The ring honours --wpd-save-status-idle-color first; falls
	 * back to a translucent admin-theme accent (color-mix blends
	 * the live --wp-admin-theme-color toward transparent at ~55%
	 * opacity) so the dot always picks up the active accent
	 * automatically.
	 */
	.wpd-save-status__indicator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
		box-sizing: border-box;
		background: var( --wpd-save-status-bg, transparent );
		border: 2px solid
			var(
				--wpd-save-status-idle-color,
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

	/* Phase: pending / saving — primary-tinted blinking dot.
	 * Default cadence is a smooth pulse; animation="modem" swaps in
	 * the burst-style activity blink that mimics a 1990s data modem
	 * — short bursts of stutters with quiet pauses between, never
	 * the same shape twice in a row. */
	:host( [ phase='pending' ] ) .wpd-save-status__indicator,
	:host( [ phase='saving' ] ) .wpd-save-status__indicator {
		background: var(
			--wpd-save-status-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		border-color: transparent;
		color: var( --wp-admin-theme-color, #2271b1 );
		animation: wpd-save-status-pulse 1.2s ease-in-out infinite;
	}

	/* Modem-light animation — chaotic on/off bursts that mimic a
	 * 1990s modem's TX/RX LED while data flows. Two cycles ride
	 * over each other (a fast "stutter" track + a slower "burst"
	 * track) so the pattern never repeats cleanly within a few
	 * seconds. The eye reads it as data, not a metronome. */
	:host( [ animation='modem' ][ phase='pending' ] ) .wpd-save-status__indicator,
	:host( [ animation='modem' ][ phase='saving' ] ) .wpd-save-status__indicator {
		background: var(
			--wpd-save-status-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		border-color: transparent;
		color: var( --wp-admin-theme-color, #2271b1 );
		/* Slow, sparse cadence — a real modem's data LED isn't a
		 * strobe. Two tracks at slightly-different periods drift
		 * against each other so the pattern never reads as
		 * metronomic; the combined pattern only truly repeats every
		 * 7.2s (the LCM of the 1.8s and 2.4s periods). */
		animation:
			wpd-save-status-modem-stutter 1.8s ease-in-out infinite,
			wpd-save-status-modem-glow    2.4s ease-in-out infinite;
	}

	/*
	 * Stutter track — controls the dot opacity. Sparse, irregular
	 * pattern: a single quick flash, a long quiet, a doublet, more
	 * quiet, a longer flash, fade. Fewer blinks per cycle than the
	 * previous "burst" design — the eye reads it as a calm,
	 * intermittent activity LED rather than a strobe.
	 *
	 * Off-cycle opacity is 0.2 (not 0) so the dot stays present as
	 * a "dim glow" between flashes — closer to how a real LED looks
	 * dimming/brightening than a hard binary cut.
	 */
	@keyframes wpd-save-status-modem-stutter {
		/* Quick flash. */
		0%, 4%    { opacity: 1; }

		/* Long quiet. */
		5%, 30%   { opacity: 0.22; }

		/* Doublet — two short on-pulses with a beat between. */
		31%, 36%  { opacity: 1; }
		37%, 39%  { opacity: 0.22; }
		40%, 44%  { opacity: 1; }

		/* Quiet. */
		45%, 67%  { opacity: 0.22; }

		/* Single longer flash — the "burst" of the cycle. */
		68%, 76%  { opacity: 1; }

		/* Long quiet through the end. */
		77%, 100% { opacity: 0.22; }
	}

	/*
	 * Glow track — small halo timed to the brighter peaks. Lower
	 * blur radius (4px) and zero spread so the halo decorates the
	 * dot without dominating the title bar. Three soft pulses per
	 * cycle, drifting against the stutter.
	 */
	@keyframes wpd-save-status-modem-glow {
		0%, 12%   { box-shadow: 0 0 0 0 transparent; }
		13%, 22%  { box-shadow: 0 0 4px 0 currentColor; }
		23%, 50%  { box-shadow: 0 0 0 0 transparent; }
		51%, 58%  { box-shadow: 0 0 4px 0 currentColor; }
		59%, 84%  { box-shadow: 0 0 0 0 transparent; }
		85%, 94%  { box-shadow: 0 0 5px 0 currentColor; }
		95%, 100% { box-shadow: 0 0 0 0 transparent; }
	}

	/* Reduced-motion: disable the chaotic blink. Keep a solid lit
	 * dot so the user still sees "something is happening" — same
	 * affordance, calmer animation. */
	@media ( prefers-reduced-motion: reduce ) {
		:host( [ phase='pending' ] ) .wpd-save-status__indicator,
		:host( [ phase='saving' ] ) .wpd-save-status__indicator,
		:host( [ animation='modem' ][ phase='pending' ] ) .wpd-save-status__indicator,
		:host( [ animation='modem' ][ phase='saving' ] ) .wpd-save-status__indicator {
			animation: none;
			opacity: 0.85;
		}
	}

	/* Phase: saved — solid green, no pulse. The hollow ring
	 * "fills in" momentarily before auto-clearing back to idle. */
	:host( [ phase='saved' ] ) .wpd-save-status__indicator {
		background: var( --wpd-save-status-saved-bg, var( --wpd-surface, #1d6f42 ) );
		border-color: transparent;
		color: var( --wpd-save-status-saved-bg, var( --wpd-success-fg, #1d6f42 ) );
	}

	/* Phase: failed — solid red, gentle attention pulse. */
	:host( [ phase='failed' ] ) .wpd-save-status__indicator {
		background: var( --wpd-save-status-failed-bg, var( --wpd-surface, #d63638 ) );
		border-color: transparent;
		color: var( --wpd-save-status-failed-bg, var( --wpd-danger, #d63638 ) );
		animation: wpd-save-status-pulse 0.8s ease-in-out 2;
	}

	@keyframes wpd-save-status-pulse {
		0%, 100% { opacity: 0.55; transform: scale( 0.9 ); }
		50%      { opacity: 1;    transform: scale( 1 ); }
	}

	/* Mode: 'pill' shows a label next to the dot. Defaults to 'dot'
	 * (no label, indicator only) for the smallest footprint. */
	:host( [ mode='pill' ] ) .wpd-save-status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 10px;
		border-radius: 999px;
		background: var( --wpd-save-status-pill-bg, transparent );
		font-weight: 500;
		white-space: nowrap;
	}
	:host( [ mode='pill' ][ phase='saving' ] ) .wpd-save-status,
	:host( [ mode='pill' ][ phase='pending' ] ) .wpd-save-status {
		background: var( --wpd-save-status-pill-bg, var( --wpd-hover, rgba( 0, 0, 0, 0.04 ) ) );
		color: var( --wpd-save-status-pill-fg, var( --wpd-fg-muted, #50575e ) );
	}
	:host( [ mode='pill' ][ phase='saved' ] ) .wpd-save-status {
		background: var( --wpd-save-status-pill-bg, rgba( 30, 132, 73, 0.12 ) );
		color: var( --wpd-save-status-pill-fg, var( --wpd-success-fg, #1d6f42 ) );
	}
	:host( [ mode='pill' ][ phase='failed' ] ) .wpd-save-status {
		background: var( --wpd-save-status-pill-bg, rgba( 214, 54, 56, 0.12 ) );
		color: var( --wpd-save-status-pill-fg, var( --wpd-danger-hover, #a02622 ) );
	}

	.wpd-save-status__label {
		min-width: 0;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Mode: 'icon' renders a glyph (check / cross) inside the dot
	 * for the saved / failed phases. The svg inherits color from the
	 * indicator's foreground. */
	:host( [ phase='saved' ] ) .wpd-save-status__glyph,
	:host( [ phase='failed' ] ) .wpd-save-status__glyph {
		display: inline-block;
		color: var( --wpd-fg-on-accent, #fff );
		width: 8px;
		height: 8px;
	}
	.wpd-save-status__glyph {
		display: none;
	}
	.wpd-save-status__glyph svg {
		display: block;
		width: 100%;
		height: 100%;
	}
`;
