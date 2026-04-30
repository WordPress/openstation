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
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.wpd-avatar__tile {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		overflow: hidden;
		background: var( --wp-desktop-window-bg, #f0f0f1 );
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: calc( var( --wpd-avatar-size, 32px ) * 0.42 );
		line-height: 1;
		letter-spacing: 0.02em;
		font-feature-settings: 'tnum' 1;
		user-select: none;
		box-shadow: inset 0 0 0 1px rgba( 0, 0, 0, 0.05 );
	}

	.wpd-avatar__tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
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
		border: 2px solid var( --wpd-avatar-dot-ring, var( --wp-desktop-window-bg, #fff ) );
		background: var( --wpd-avatar-dot-color, transparent );
	}

	.wpd-avatar__dot--online {
		background: var( --wp-desktop-success, #00a32a );
	}
	.wpd-avatar__dot--inactive {
		background: var( --wp-desktop-warning, #dba617 );
	}
	.wpd-avatar__dot--offline {
		background: var( --wp-desktop-muted, #8c8f94 );
	}
`;
