/**
 * `<os-save-status>` — shadow-DOM styles. The host renders one of
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
		font-size: var( --os-ui-save-status-font-size, 11px );
		line-height: 1;
		color: var( --os-ui-save-status-fg, currentColor );
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
	 * The ring honours --os-ui-save-status-idle-color first; falls
	 * back to a translucent admin-theme accent (color-mix blends
	 * the live --wp-admin-theme-color toward transparent at ~55%
	 * opacity) so the dot always picks up the active accent
	 * automatically.
	 */
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

	/* Phase: pending / saving — primary-tinted blinking dot.
	 * Default cadence is a smooth pulse; animation="modem" swaps in
	 * the burst-style activity blink that mimics a 1990s data modem
	 * — short bursts of stutters with quiet pauses between, never
	 * the same shape twice in a row. */
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

	/* Modem-light animation — chaotic on/off bursts that mimic a
	 * 1990s modem's TX/RX LED while data flows. Two cycles ride
	 * over each other (a fast "stutter" track + a slower "burst"
	 * track) so the pattern never repeats cleanly within a few
	 * seconds. The eye reads it as data, not a metronome. */
	:host( [ animation='modem' ][ phase='pending' ] ) .os-save-status__indicator,
	:host( [ animation='modem' ][ phase='saving' ] ) .os-save-status__indicator {
		background: var(
			--os-ui-save-status-bg,
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
			os-save-status-modem-stutter 1.8s ease-in-out infinite,
			os-save-status-modem-glow    2.4s ease-in-out infinite;
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
	@keyframes os-save-status-modem-stutter {
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
	@keyframes os-save-status-modem-glow {
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
		:host( [ phase='pending' ] ) .os-save-status__indicator,
		:host( [ phase='saving' ] ) .os-save-status__indicator,
		:host( [ animation='modem' ][ phase='pending' ] ) .os-save-status__indicator,
		:host( [ animation='modem' ][ phase='saving' ] ) .os-save-status__indicator {
			animation: none;
			opacity: 0.85;
		}
	}

	/* Phase: saved — solid green, no pulse. The hollow ring
	 * "fills in" momentarily before auto-clearing back to idle.
	 *
	 * The second fallback is the SEMANTIC colour, not --os-ui-surface
	 * — routing it through the surface token was the classic
	 * fallback-chain collapse: the palette declares --os-ui-surface
	 * (Obsidian), so the green dot resolved to the same near-black as
	 * the panel behind it and vanished. */
	:host( [ phase='saved' ] ) .os-save-status__indicator {
		background: var( --os-ui-save-status-saved-bg, var( --os-ui-success-fg, #1d6f42 ) );
		border-color: transparent;
		color: var( --os-ui-save-status-saved-bg, var( --os-ui-success-fg, #1d6f42 ) );
	}

	/* Phase: failed — solid red, gentle attention pulse. */
	:host( [ phase='failed' ] ) .os-save-status__indicator {
		background: var( --os-ui-save-status-failed-bg, var( --os-ui-danger, #d63638 ) );
		border-color: transparent;
		color: var( --os-ui-save-status-failed-bg, var( --os-ui-danger, #d63638 ) );
		animation: os-save-status-pulse 0.8s ease-in-out 2;
	}

	/*
	 * Variant: 'ring' — the outline IS the indicator.
	 *
	 * The default treatment fills the dot for every phase that isn't
	 * idle, which makes three of the five states the same shape in
	 * three colours. The ring keeps the outline and moves the COLOUR
	 * through it, spending the filled state on exactly one thing:
	 * success. That's what makes "it worked" the only phase that
	 * reads at a glance, which is the phase users are actually
	 * waiting for.
	 *
	 * Built for the window title bar, where the ring replaced the app
	 * icon — a duplicate of the dock tile below it — so the only mark
	 * in that corner is one that means something.
	 */
	/*
	 * The ring carries NO resting fill, and this rule is what
	 * guarantees it.
	 *
	 * --os-ui-save-status-bg is the dot's background — the base rule
	 * reads it as the background, defaulting to transparent. A
	 * consumer setting it to colour the ring's in-flight outline
	 * therefore painted that colour as a solid idle fill: one token
	 * meaning two different things one rule apart, which is why the
	 * ring wants a name of its own (--os-ui-save-status-ring-color,
	 * below) and why the fill is pinned off here regardless of what
	 * anyone sets. Only saved reinstates a background, at higher
	 * specificity.
	 */
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

	/*
	 * Failure keeps the ring open and tints the glyph rather than
	 * the fill. A filled red disc and a filled accent disc are the
	 * same silhouette, and colour alone is not a distinction every
	 * user can make.
	 */
	/*
	 * Failure keeps the ring open and tints the glyph rather than
	 * the fill, and arrives with two quick swells — an alert, not a
	 * heartbeat, so it stops rather than continuing.
	 */
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

	/*
	 * Success is the one state that fills, so it is also the one that
	 * gets a gesture: the ring overshoots slightly and settles, the
	 * way a thing does when it lands. The colours cross-fade under it
	 * on the base rule's own transition — border to transparent, fill
	 * to the accent — so the outline doesn't blink out and reappear as
	 * a disc.
	 */
	:host( [ variant='ring' ][ phase='saved' ] ) .os-save-status__indicator {
		background: var(
			--os-ui-save-status-saved-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		border-color: transparent;
		animation: os-save-status-ring-land 0.42s
			var( --os-ui-ease-out, ease-out ) 1;
	}

	/*
	 * The glyph arrives after the shape it sits in — a check that
	 * fades up into a ring already filling reads as one event, where
	 * both appearing together reads as a swap. The backwards fill-mode
	 * holds the 0% frame during the delay, so the glyph can't flash at
	 * full size before the animation starts.
	 */
	:host( [ variant='ring' ][ phase='saved' ] ) .os-save-status__glyph,
	:host( [ variant='ring' ][ phase='failed' ] ) .os-save-status__glyph {
		animation: os-save-status-glyph-in 0.24s
			var( --os-ui-ease-out, ease-out ) 0.08s 1 backwards;
	}

	/*
	 * The pulse breathes the ring rather than blinking it — opacity
	 * and scale only, both compositor properties, and neither
	 * reaching zero. A ring that disappears between beats reads as a
	 * fault; one that breathes reads as work continuing.
	 */
	@keyframes os-save-status-ring-pulse {
		0%, 100% { opacity: 0.45; scale: 0.9; }
		50%      { opacity: 1;    scale: 1; }
	}

	/* Overshoot and settle. Small — 6% — because the ring is 16px in
	 * a title bar, and at that size a big bounce reads as a wobble. */
	@keyframes os-save-status-ring-land {
		0%   { scale: 0.82; }
		55%  { scale: 1.06; }
		100% { scale: 1; }
	}

	/* Two swells, decaying. Never past 1.08 for the same reason. */
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

	/*
	 * Reduced motion: every phase still changes colour and fill, and
	 * none of them move. The ring holds lit instead of breathing, and
	 * the outcomes arrive without their gesture — the gesture is
	 * emphasis, the fill and the glyph are the information.
	 */
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

	/* Mode: 'pill' shows a label next to the dot. Defaults to 'dot'
	 * (no label, indicator only) for the smallest footprint. */
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

	/* Mode: 'icon' renders a glyph (check / cross) inside the dot
	 * for the saved / failed phases. The svg inherits color from the
	 * indicator's foreground. */
	:host( [ phase='saved' ] ) .os-save-status__glyph,
	:host( [ phase='failed' ] ) .os-save-status__glyph {
		display: inline-block;
		color: var( --os-ui-fg-on-accent, #fff );
		/* Proportional to the indicator so a resized ring keeps its
		 * glyph in the same relationship to the stroke. */
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
