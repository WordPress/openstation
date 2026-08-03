import { css } from '../../core';

/**
 * Styles for `<os-avatar>` — image-or-initials user tile with an
 * optional presence dot in the bottom-end corner. Sizes drive both
 * box dimensions and font-size of the initials so the tile scales
 * cleanly between conversation-list rows (32px) and a profile
 * card (64px).
 */
export const avatarStyles = css`
	:host {
		display: inline-flex;
		position: relative;
		width: var( --os-ui-avatar-size, 32px );
		height: var( --os-ui-avatar-size, 32px );
		flex: 0 0 auto;
		vertical-align: middle;
		line-height: 0;
		/*
		 * 3D perspective lets the tile rotate towards / away from the
		 * pointer. The value is generous (size × 8) so even small
		 * avatars feel responsive without distortion at the edges.
		 */
		perspective: calc( var( --os-ui-avatar-size, 32px ) * 8 );
		/*
		 * Pointer-driven CSS custom properties. The TS side updates
		 * these on pointermove; the styles below consume them. With
		 * smooth transitions the result is a parallax-style hover
		 * that "leans" toward the cursor and shines a soft glare
		 * across the surface.
		 */
		--os-ui-avatar-tilt-x: 0deg;
		--os-ui-avatar-tilt-y: 0deg;
		--os-ui-avatar-hover: 0;
		--os-ui-avatar-glare-x: 50%;
		--os-ui-avatar-glare-y: 50%;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.os-avatar__tile {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		overflow: hidden;
		background: var( --os-window-bg, #f0f0f1 );
		color: var( --os-ui-fg-on-accent, #fff );
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		/*
		 * Slightly larger glyph — 0.42 left initials looking under-
		 * filled inside the tile. 0.48 balances the negative space
		 * without crowding the edge.
		 */
		font-size: calc( var( --os-ui-avatar-size, 32px ) * 0.48 );
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
			rotateX( var( --os-ui-avatar-tilt-x ) )
			rotateY( var( --os-ui-avatar-tilt-y ) )
			scale( calc( 1 + var( --os-ui-avatar-hover ) * 0.07 ) );
		transition:
			transform 220ms cubic-bezier( 0.2, 0.8, 0.2, 1 ),
			box-shadow 220ms cubic-bezier( 0.2, 0.8, 0.2, 1 );
		box-shadow:
			inset 0 0 0 1px rgba( 255, 255, 255, calc( 0.18 + 0.22 * var( --os-ui-avatar-hover ) ) ),
			inset 0 0 0 calc( 1px + var( --os-ui-avatar-hover ) * 1px )
				rgba( 0, 0, 0, calc( 0.08 + 0.04 * var( --os-ui-avatar-hover ) ) ),
			0 calc( 1px + var( --os-ui-avatar-hover ) * 8px )
				calc( 6px + var( --os-ui-avatar-hover ) * 18px )
				rgba( 0, 0, 0, calc( 0.08 + 0.18 * var( --os-ui-avatar-hover ) ) );
		/* Glyph "floats" above the surface — a tiny Z translate
		 * separates it from the glare layer in the 3D scene. */
	}

	/* Cursor-tracking glare — a soft white radial bloom that follows
	 * the pointer. mix-blend-mode overlay lets it warm the underlying
	 * color instead of stamping a flat white on top, so the hue still
	 * reads through. Opacity is driven by hover so it fades in/out
	 * with the tilt. */
	.os-avatar__tile::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: radial-gradient(
			circle at var( --os-ui-avatar-glare-x ) var( --os-ui-avatar-glare-y ),
			var( --os-ui-scrim, rgba( 255, 255, 255, 0.55 ) ) 0%,
			var( --os-ui-hover, rgba( 255, 255, 255, 0 ) ) 55%
		);
		opacity: var( --os-ui-avatar-hover );
		mix-blend-mode: overlay;
		pointer-events: none;
		transition: opacity 220ms cubic-bezier( 0.2, 0.8, 0.2, 1 );
	}

	/* Subtle outer halo — a hue-aware ring that swells with hover.
	 * Sits BEHIND the tile (negative z-index) so the perspective tilt
	 * doesn't clip it. */
	.os-avatar__tile::before {
		content: '';
		position: absolute;
		inset: calc( var( --os-ui-avatar-hover ) * -3px );
		border-radius: 50%;
		/* The halo hue was a fixed indigo, which is a colour no palette
		   in the station names — an avatar lit itself in a hue nothing
		   around it used. It follows --os-ui-avatar-halo now, and
		   color-mix carries the hover-driven alpha so the token can
		   stay a plain colour. */
		background: radial-gradient(
			circle at var( --os-ui-avatar-glare-x ) var( --os-ui-avatar-glare-y ),
			color-mix(
				in srgb,
				var( --os-ui-avatar-halo, rgb( 99, 102, 241 ) )
					calc( 35% * var( --os-ui-avatar-hover ) ),
				transparent
			) 0%,
			transparent 70%
		);
		filter: blur( 4px );
		pointer-events: none;
		z-index: -1;
		transition:
			inset 220ms cubic-bezier( 0.2, 0.8, 0.2, 1 ),
			background 220ms;
	}

	.os-avatar__tile img {
		/*
		 * Bleed 1px past the tile on every side. At exactly 100% the
		 * circular clip and the image edge land on the same subpixel
		 * boundary, and the tile's transform (tilt + scale) makes the
		 * rounding disagree — leaving a hairline crescent of the tile
		 * background showing through the rim. Overshooting puts the
		 * seam outside the clip, where overflow:hidden eats it.
		 */
		width: calc( 100% + 2px );
		height: calc( 100% + 2px );
		margin: -1px;
		object-fit: cover;
		display: block;
		/* Lift the image one notch in 3D space so it sits above the
		 * glare layer's radial bloom. */
		transform: translateZ( 1px );
	}

	.os-avatar__dot {
		position: absolute;
		bottom: 0;
		inset-inline-end: 0;
		width: calc( var( --os-ui-avatar-size, 32px ) * 0.32 );
		height: calc( var( --os-ui-avatar-size, 32px ) * 0.32 );
		min-width: 8px;
		min-height: 8px;
		border-radius: 50%;
		box-sizing: border-box;
		border: 2px solid var( --os-ui-avatar-dot-ring, var( --os-window-bg, #fff ) );
		background: var( --os-ui-avatar-dot-color, transparent );
		/* Keep the dot out of the perspective scene so it stays
		 * crisply pinned to the bottom-end corner regardless of tilt. */
		z-index: 2;
	}

	.os-avatar__dot--online {
		background: var( --os-ui-success-fg, #00a32a );
	}
	.os-avatar__dot--inactive {
		background: var( --os-ui-warning-fg, #dba617 );
	}
	.os-avatar__dot--offline {
		background: var( --os-ui-fg-muted, #8c8f94 );
	}

	/* Respect user preference — disable the tilt + glare entirely
	 * for users who opt into reduced motion. The hover lift in
	 * box-shadow is gentle enough to keep; only the heavy motion
	 * channels get muted. */
	@media ( prefers-reduced-motion: reduce ) {
		.os-avatar__tile {
			transform: none;
			transition: box-shadow 200ms;
		}
		.os-avatar__tile::after,
		.os-avatar__tile::before {
			display: none;
		}
	}
`;
