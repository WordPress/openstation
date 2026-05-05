/**
 * `<wpd-crumb-chain>` — chevron-interlocking breadcrumb chain.
 *
 * Shadow-DOM styles. The chain is a horizontal flex row of pill
 * segments that each carry a `clip-path` polygon for their leading
 * and trailing chevron. Adjacent segments overlap by exactly the
 * chevron width via a negative `margin-inline-end` so the trailing
 * point of one segment slots cleanly into the leading notch of the
 * next — like puzzle pieces clicking together. The visual reads as
 * one merged shape with internal "tear lines" separating each
 * hierarchy level.
 *
 * Each segment's color is set inline via the `--wpd-crumb-bg` /
 * `--wpd-crumb-fg` custom properties so the consumer can vary
 * lightness per depth (root darkest, leaf brightest) while keeping
 * one hashed hue for the whole chain.
 */
import { css } from '../../core';

const CHEVRON_W = '10px';

export const styles = css`
	:host {
		display: inline-flex;
		max-width: 100%;
		align-items: center;
		min-width: 0;
		font-family: var( --wpd-font, system-ui, sans-serif );
		/* Match wpd-chip's defaults so a chain sits at the same
		 * height as a tag chip — when the two render in adjacent
		 * cells the row reads as one consistent control language. */
		font-size: 12px;
		line-height: 1;
		font-weight: 500;
	}

	.wpd-crumb-chain {
		display: inline-flex;
		flex-wrap: nowrap;
		align-items: stretch;
		max-width: 100%;
		min-width: 0;
		min-height: 22px;
		/* Outer rounded pill — clips the first segment's left
		 * edge into a rounded curve and the last segment's right
		 * edge into a rounded curve, while every internal join
		 * keeps the chevron tear-line. The chain reads as ONE
		 * smooth pill with internal segments, not three loose
		 * shapes lined up. */
		border-radius: 999px;
		overflow: hidden;
		filter: drop-shadow( 0 1px 1px rgba( 0, 0, 0, 0.06 ) );
	}

	.wpd-crumb {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-height: 22px;
		padding: 2px 12px;
		background: var( --wpd-crumb-bg, #c3c4c7 );
		color: var( --wpd-crumb-fg, #1d2327 );
		text-align: center;
		min-width: 0;
		max-width: 100%;
		flex-shrink: 1;
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.01em;
		white-space: nowrap;
		transition: filter 0.15s ease, transform 0.15s ease, background-color 0.12s ease;
	}
	.wpd-crumb:hover {
		filter: brightness( 1.06 );
	}

	/*
	 * Chevron geometry. Polygons are written as percentages on Y
	 * so the chevron always points to the vertical centre, and as
	 * pixel offsets on X so the chevron width stays constant
	 * regardless of segment length.
	 *
	 *   chevron-tip    : (100% - 0px, 50%)
	 *   chevron-corners: (100% - 10px, 0)  and  (100% - 10px, 100%)
	 *
	 * The notch on the leading edge is the same shape mirrored
	 * across the segment's left edge.
	 */
	.wpd-crumb--first {
		padding-inline-end: 22px;
		clip-path: polygon(
			0 0,
			calc( 100% - ${ CHEVRON_W } ) 0,
			100% 50%,
			calc( 100% - ${ CHEVRON_W } ) 100%,
			0 100%
		);
	}
	.wpd-crumb--middle {
		padding-inline: 22px;
		margin-inline-start: calc( -1 * ${ CHEVRON_W } );
		clip-path: polygon(
			${ CHEVRON_W } 0,
			calc( 100% - ${ CHEVRON_W } ) 0,
			100% 50%,
			calc( 100% - ${ CHEVRON_W } ) 100%,
			${ CHEVRON_W } 100%,
			0 50%
		);
	}
	.wpd-crumb--last {
		padding-inline-start: 22px;
		padding-inline-end: 14px;
		margin-inline-start: calc( -1 * ${ CHEVRON_W } );
		clip-path: polygon(
			${ CHEVRON_W } 0,
			100% 0,
			100% 100%,
			${ CHEVRON_W } 100%,
			0 50%
		);
	}
	/* Solo shape — used when the chain has only one segment. Pill on both ends. */
	.wpd-crumb--solo {
		padding: 2px 12px;
		border-radius: 999px;
	}

	.wpd-crumb__label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		/* Match wpd-chip's tighter line-height so descenders sit
		 * inside the chip box without forcing extra padding. */
		line-height: 1.4;
	}

	/*
	 * Per-segment remove button. Visible at 0.65 opacity in every
	 * segment (not just the leaf) so the user can prune any branch
	 * point without first hovering — clicking × on a parent
	 * removes the parent AND every selected descendant under it,
	 * matching how taxonomy pruning works mentally ("delete this
	 * branch").
	 */
	.wpd-crumb__remove {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: inherit;
		cursor: pointer;
		opacity: 0.65;
		transition: opacity 0.12s ease, background-color 0.12s ease, transform 0.12s ease;
	}
	.wpd-crumb__remove:hover,
	.wpd-crumb__remove:focus-visible {
		opacity: 1;
		background: rgba( 0, 0, 0, 0.22 );
		outline: none;
		transform: scale( 1.1 );
	}
	.wpd-crumb__remove svg {
		display: block;
		width: 8px;
		height: 8px;
	}

	/* Hover lift — a subtle bump so the chain feels interactive
	 * without screaming for attention. */
	.wpd-crumb-chain:hover {
		filter: drop-shadow( 0 2px 3px rgba( 0, 0, 0, 0.12 ) );
	}

	:host( [ disabled ] ) .wpd-crumb-chain {
		opacity: 0.55;
		pointer-events: none;
	}
`;
