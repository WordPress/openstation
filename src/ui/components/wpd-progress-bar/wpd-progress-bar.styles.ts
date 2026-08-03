import { css } from '../../core';

/**
 * Why every default is a `--_alias` and not a `--wpd-progress-*`
 * declaration.
 *
 * A custom property declared on `:host` matches the host element
 * itself, so it OUTRANKS anything the element would otherwise inherit.
 * The palette (`body.desktop-mode-active`) and every desktop theme
 * (`body.desktop-mode-desktop-theme-<slug>`) both declare on an
 * ancestor — so a `--wpd-progress-track-bg: …` on `:host` does not
 * merely set a default, it makes the public token unreachable and the
 * theme's declaration dead. Legacy carries all seven of these names,
 * and none of them reached the bar.
 *
 * Reading the public token into a private alias inverts that: the
 * `var()` lookup has no declaration on the host to find, so it
 * resolves the inherited value — theme first, palette next, the
 * pre-brand literal last. Same defaults, same override surface, one
 * less blocked layer. (Mirrors `<wpd-rating-summary>`.)
 */
export const styles = css`
	:host {
		display: block;
		--_track-bg: var(
			--wpd-progress-track-bg,
			var( --wpd-surface-sunken, rgba( 0, 0, 0, 0.08 ) )
		);
		--_fill: var(
			--wpd-progress-fill,
			var( --wp-admin-theme-color, #2271b1 )
		);
		--_height: var( --wpd-progress-height, 6px );
		--_radius: var( --wpd-progress-radius, 999px );
		--_label-color: var( --wpd-progress-label-color, inherit );
		--_label-size: var( --wpd-progress-label-size, 12px );
		--_label-gap: var( --wpd-progress-label-gap, 4px );
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
	   rule in the document tree setting --wpd-progress-fill on
	   wpd-progress-bar[tone='danger'] still outranks the tone the way
	   it always did. Only the base default moved. */
	:host( [ tone='success' ] ) {
		--wpd-progress-fill: var( --wpd-success-fg, #3a8a3a );
	}
	:host( [ tone='warning' ] ) {
		--wpd-progress-fill: var( --wpd-warning-fg, #dba617 );
	}
	:host( [ tone='danger' ] ) {
		--wpd-progress-fill: var( --wpd-danger, #d63638 );
	}

	/* Indeterminate — sweeping bar across the track. */
	:host( [ indeterminate ] ) .fill {
		width: 33%;
		animation: wpd-progress-sweep 1.1s linear infinite;
		transition: none;
	}

	@keyframes wpd-progress-sweep {
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
		:host( [ indeterminate ] ) .fill {
			animation: none;
			width: 100%;
			opacity: 0.6;
		}
	}
`;
