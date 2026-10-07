import { css } from '../../core';

export const avatarStyles = css`
	:host {
		display: inline-flex;
		position: relative;
		width: var( --os-ui-avatar-size, 32px );
		height: var( --os-ui-avatar-size, 32px );
		flex: 0 0 auto;
		vertical-align: middle;
		line-height: 0;

		perspective: calc( var( --os-ui-avatar-size, 32px ) * 8 );

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

		font-size: calc( var( --os-ui-avatar-size, 32px ) * 0.48 );
		line-height: 1;

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

	}

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

	.os-avatar__tile::before {
		content: '';
		position: absolute;
		inset: calc( var( --os-ui-avatar-hover ) * -3px );
		border-radius: 50%;

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

		width: calc( 100% + 2px );
		height: calc( 100% + 2px );
		margin: -1px;
		object-fit: cover;
		display: block;

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

		z-index: 2;
	}

	.os-avatar__dot--online {
		background: var( --os-ui-success-fg, #00a32a );
	}

	.os-avatar__dot--online::after {
		content: '';
		position: absolute;
		inset: -2px;
		border-radius: 50%;
		border: 1px solid var( --os-ui-success-fg, #00a32a );
		animation: os-avatar-presence 6s
			var( --os-ui-ease-out, cubic-bezier( 0.22, 0.9, 0.28, 1 ) ) infinite;
		pointer-events: none;
	}

	@keyframes os-avatar-presence {
		0% {
			opacity: 0.6;
			transform: scale( 1 );
		}

		20% {
			opacity: 0;
			transform: scale( 2.2 );
		}

		100% {
			opacity: 0;
			transform: scale( 2.2 );
		}
	}
	.os-avatar__dot--inactive {
		background: var( --os-ui-warning-fg, #dba617 );
	}
	.os-avatar__dot--offline {
		background: var( --os-ui-fg-muted, #8c8f94 );
	}

	@media ( prefers-reduced-motion: reduce ) {

		.os-avatar__dot--online::after {
			animation: none;
			opacity: 0.6;
		}

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
