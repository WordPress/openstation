import { css } from '../../core';

/**
 * Styles for `<wpd-avatar>` — image-or-initials user tile with an
 * optional presence dot in the bottom-end corner. Sizes drive both
 * box dimensions and font-size of the initials so the tile scales
 * cleanly between conversation-list rows (32px) and a profile
 * card (64px).
 */
export const avatarStyles = css`
	:host {
		display: inline-flex;
		position: relative;
		width: var( --wpd-avatar-size, 32px );
		height: var( --wpd-avatar-size, 32px );
		flex: 0 0 auto;
		vertical-align: middle;
		line-height: 0;
		/*
		 * 3D perspective lets the tile rotate towards / away from the
		 * pointer. The value is generous (size × 8) so even small
		 * avatars feel responsive without distortion at the edges.
		 */
		perspective: calc( var( --wpd-avatar-size, 32px ) * 8 );
		/*
		 * Pointer-driven CSS custom properties. The TS side updates
		 * these on pointermove; the styles below consume them. With
		 * smooth transitions the result is a parallax-style hover
		 * that "leans" toward the cursor and shines a soft glare
		 * across the surface.
		 */
		--wpd-avatar-tilt-x: 0deg;
		--wpd-avatar-tilt-y: 0deg;
		--wpd-avatar-hover: 0;
		--wpd-avatar-glare-x: 50%;
		--wpd-avatar-glare-y: 50%;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.wpd-avatar__tile {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		overflow: hidden;
		background: var( --desktop-mode-window-bg, #f0f0f1 );
		color: var( --wpd-fg-on-accent, #fff );
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		/*
		 * Slightly larger glyph — 0.42 left initials looking under-
		 * filled inside the tile. 0.48 balances the negative space
		 * without crowding the edge.
		 */
		font-size: calc( var( --wpd-avatar-size, 32px ) * 0.48 );
		line-height: 1;
		/*
		 * Single-character initials have no following glyph to "space
		 * after", so any positive letter-spacing inflates the
		 * bounding box without shifting the visible character — that
		 * made the X look off-centered to the right. Zero out.
		 */
		letter-spacing: 0;
		font-feature-settings: 'tnum' 1;
		user-select: none;
		transform-style: preserve-3d;
		transform:
			rotateX( var( --wpd-avatar-tilt-x ) )
			rotateY( var( --wpd-avatar-tilt-y ) )
			scale( calc( 1 + var( --wpd-avatar-hover ) * 0.07 ) );
		transition:
			transform 220ms cubic-bezier( 0.2, 0.8, 0.2, 1 ),
			box-shadow 220ms cubic-bezier( 0.2, 0.8, 0.2, 1 );
		box-shadow:
			inset 0 0 0 1px rgba( 255, 255, 255, calc( 0.18 + 0.22 * var( --wpd-avatar-hover ) ) ),
			inset 0 0 0 calc( 1px + var( --wpd-avatar-hover ) * 1px )
				rgba( 0, 0, 0, calc( 0.08 + 0.04 * var( --wpd-avatar-hover ) ) ),
			0 calc( 1px + var( --wpd-avatar-hover ) * 8px )
				calc( 6px + var( --wpd-avatar-hover ) * 18px )
				rgba( 0, 0, 0, calc( 0.08 + 0.18 * var( --wpd-avatar-hover ) ) );
		/* Glyph "floats" above the surface — a tiny Z translate
		 * separates it from the glare layer in the 3D scene. */
	}

	/* Cursor-tracking glare — a soft white radial bloom that follows
	 * the pointer. mix-blend-mode overlay lets it warm the underlying
	 * color instead of stamping a flat white on top, so the hue still
	 * reads through. Opacity is driven by hover so it fades in/out
	 * with the tilt. */
	.wpd-avatar__tile::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: radial-gradient(
			circle at var( --wpd-avatar-glare-x ) var( --wpd-avatar-glare-y ),
			var( --wpd-scrim, rgba( 255, 255, 255, 0.55 ) ) 0%,
			var( --wpd-hover, rgba( 255, 255, 255, 0 ) ) 55%
		);
		opacity: var( --wpd-avatar-hover );
		mix-blend-mode: overlay;
		pointer-events: none;
		transition: opacity 220ms cubic-bezier( 0.2, 0.8, 0.2, 1 );
	}

	/* Subtle outer halo — a hue-aware ring that swells with hover.
	 * Sits BEHIND the tile (negative z-index) so the perspective tilt
	 * doesn't clip it. */
	.wpd-avatar__tile::before {
		content: '';
		position: absolute;
		inset: calc( var( --wpd-avatar-hover ) * -3px );
		border-radius: 50%;
		background: radial-gradient(
			circle at var( --wpd-avatar-glare-x ) var( --wpd-avatar-glare-y ),
			rgba( 99, 102, 241, calc( 0.35 * var( --wpd-avatar-hover ) ) ) 0%,
			rgba( 99, 102, 241, 0 ) 70%
		);
		filter: blur( 4px );
		pointer-events: none;
		z-index: -1;
		transition:
			inset 220ms cubic-bezier( 0.2, 0.8, 0.2, 1 ),
			background 220ms;
	}

	.wpd-avatar__tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		/* Lift the image one notch in 3D space so it sits above the
		 * glare layer's radial bloom. */
		transform: translateZ( 1px );
	}

	.wpd-avatar__dot {
		position: absolute;
		bottom: 0;
		inset-inline-end: 0;
		width: calc( var( --wpd-avatar-size, 32px ) * 0.32 );
		height: calc( var( --wpd-avatar-size, 32px ) * 0.32 );
		min-width: 8px;
		min-height: 8px;
		border-radius: 50%;
		box-sizing: border-box;
		border: 2px solid var( --wpd-avatar-dot-ring, var( --desktop-mode-window-bg, #fff ) );
		background: var( --wpd-avatar-dot-color, transparent );
		/* Keep the dot out of the perspective scene so it stays
		 * crisply pinned to the bottom-end corner regardless of tilt. */
		z-index: 2;
	}

	.wpd-avatar__dot--online {
		background: var( --wpd-success-fg, #00a32a );
	}
	.wpd-avatar__dot--inactive {
		background: var( --wpd-warning-fg, #dba617 );
	}
	.wpd-avatar__dot--offline {
		background: var( --wpd-fg-muted, #8c8f94 );
	}

	/* Respect user preference — disable the tilt + glare entirely
	 * for users who opt into reduced motion. The hover lift in
	 * box-shadow is gentle enough to keep; only the heavy motion
	 * channels get muted. */
	@media ( prefers-reduced-motion: reduce ) {
		.wpd-avatar__tile {
			transform: none;
			transition: box-shadow 200ms;
		}
		.wpd-avatar__tile::after,
		.wpd-avatar__tile::before {
			display: none;
		}
	}
`;
