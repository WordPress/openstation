import { css } from '../../core';
import { holoTokens, holoShimmer } from '../../holo';

/**
 * Why every default is a `--_alias` and not a `--os-ui-progress-*`
 * declaration.
 *
 * A custom property declared on `:host` matches the host element
 * itself, so it OUTRANKS anything the element would otherwise inherit.
 * The palette (`body.os-active`) and every desktop theme
 * (`body.os-desktop-theme-<slug>`) both declare on an
 * ancestor — so a `--os-ui-progress-track-bg: …` on `:host` does not
 * merely set a default, it makes the public token unreachable and the
 * theme's declaration dead. Legacy carries all seven of these names,
 * and none of them reached the bar.
 *
 * Reading the public token into a private alias inverts that: the
 * `var()` lookup has no declaration on the host to find, so it
 * resolves the inherited value — theme first, palette next, the
 * pre-brand literal last. Same defaults, same override surface, one
 * less blocked layer. (Mirrors `<os-rating-summary>`.)
 */
export const styles = css`
	${ holoTokens }
	${ holoShimmer }

	:host {
		display: block;
		--_track-bg: var(
			--os-ui-progress-track-bg,
			var( --os-ui-surface-sunken, rgba( 0, 0, 0, 0.08 ) )
		);
		--_fill: var(
			--os-ui-progress-fill,
			var( --wp-admin-theme-color, #2271b1 )
		);
		--_height: var( --os-ui-progress-height, 6px );
		--_radius: var( --os-ui-progress-radius, 999px );
		--_label-color: var( --os-ui-progress-label-color, inherit );
		--_label-size: var( --os-ui-progress-label-size, 12px );
		--_label-gap: var( --os-ui-progress-label-gap, 4px );
		width: 100%;
		font: inherit;
		color: var( --_label-color );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: var( --_label-gap );
		font-size: var( --_label-size );
		line-height: 1.3;
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.percent {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
		flex-shrink: 0;
	}

	.track {
		position: relative;
		width: 100%;
		height: var( --_height );
		background: var( --_track-bg );
		border-radius: var( --_radius );
		overflow: hidden;
	}

	.fill {
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: 0;
		background: var( --_fill );
		border-radius: inherit;
		transition: width 0.18s ease-out;
	}

	/* Tone modifiers — same custom-property surface. These keep
	   declaring the PUBLIC token, not the alias: the alias reads it off
	   the host, so a tone still overrides the default, and a consumer
	   rule in the document tree setting --os-ui-progress-fill on
	   os-progress-bar[tone='danger'] still outranks the tone the way
	   it always did. Only the base default moved. */
	:host( [ tone='success' ] ) {
		--os-ui-progress-fill: var( --os-ui-success-fg, #3a8a3a );
	}
	:host( [ tone='warning' ] ) {
		--os-ui-progress-fill: var( --os-ui-warning-fg, #dba617 );
	}
	:host( [ tone='danger' ] ) {
		--os-ui-progress-fill: var( --os-ui-danger, #d63638 );
	}

	/*
	 * Indeterminate — the full track, with the mesh travelling through
	 * it.
	 *
	 * The old shape was a 33% block sliding left to right forever, and
	 * it has one real problem: a block moving in one direction looks
	 * like it is measuring something. It is not. An indeterminate bar
	 * knows nothing about how far along the work is, and the honest
	 * picture of that is a surface that is *alive* without advancing —
	 * which is exactly what the shimmer is.
	 *
	 * The block is still there for a tone modifier, though: a flat
	 * --os-ui-progress-fill (success / warning / danger, or any
	 * caller's colour) has no mesh to travel, so it keeps sliding. See
	 * the rule below.
	 */
	:host( [ indeterminate ] ) .fill {
		width: 100%;
		transition: none;
		background-image: var( --_fill );
		background-size: 300% 300%;
		background-repeat: no-repeat;
		animation: os-holo-shimmer 2.4s var( --_holo-loop ) infinite;
	}

	/*
	 * A tone means a flat colour, and a flat colour cannot shimmer —
	 * it would sit there at 100% looking like a finished job. Those
	 * fall back to the travelling block.
	 */
	:host( [ indeterminate ][ tone ] ) .fill {
		width: 33%;
		background-image: none;
		animation: os-progress-sweep 1.1s linear infinite;
	}

	@keyframes os-progress-sweep {
		0% {
			transform: translateX( -120% );
		}
		100% {
			transform: translateX( 320% );
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		.fill {
			transition: none;
		}
		:host( [ indeterminate ] ) .fill,
		:host( [ indeterminate ][ tone ] ) .fill {
			animation: none;
			width: 100%;
			opacity: 0.6;
		}
	}
`;
