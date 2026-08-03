import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var( --os-ui-card-gap, 12px );
		padding: var( --os-ui-card-padding, 16px );
		border: 1px solid var( --os-ui-card-border, var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ) );
		border-radius: var( --os-ui-card-radius, 12px );
		background: var( --os-ui-card-bg, var( --os-ui-surface, #fff ) );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-panel-bg-image, none );
		background-repeat: var( --os-ui-panel-bg-image-repeat, repeat );
		background-size: var( --os-ui-panel-bg-image-size, auto );
		background-position: var( --os-ui-panel-bg-image-position, center );
		color: var( --os-ui-card-fg, inherit );
		box-sizing: border-box;
		min-width: 0;
		transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	:host( [ compact ] ) {
		padding: var( --os-ui-card-padding-compact, 10px );
		gap: var( --os-ui-card-gap-compact, 6px );
		border-radius: var( --os-ui-card-radius-compact, 8px );
	}

	:host( [ interactive ] ) {
		cursor: pointer;
		outline-offset: 2px;
	}

	/* Hover lift only when the card is interactive — non-clickable
	 * cards (e.g. read-only tile in a digest list) shouldn't grow on
	 * mouseover. */
	:host( [ interactive ]:hover ),
	:host( [ interactive ]:focus-visible ) {
		transform: translateY( -2px );
		box-shadow: var(
			--os-ui-card-shadow-hover,
			0 4px 16px rgba( 0, 0, 0, 0.08 )
		);
		border-color: var(
			--os-ui-card-border-hover,
			var( --os-ui-border-strong, rgba( 0, 0, 0, 0.16 ) )
		);
	}

	:host( [ selected ] ) {
		border-color: var(
			--os-ui-card-border-selected,
			var( --wp-admin-theme-color, #2271b1 )
		);
		box-shadow: var(
			--os-ui-card-shadow-selected,
			0 0 0 1px var( --wp-admin-theme-color, #2271b1 ) inset
		);
	}

	:host( [ disabled ] ) {
		opacity: 0.55;
		pointer-events: none;
		cursor: not-allowed;
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host {
			transition: none;
		}
		:host( [ interactive ]:hover ),
		:host( [ interactive ]:focus-visible ) {
			transform: none;
		}
	}

	/* Slotted header / footer rhythm — pure CSS so consumers don't
	 * need separate os-card-header / os-card-footer tags to get
	 * the standard layout. */
	::slotted( header ) {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}

	::slotted( footer ) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: auto;
	}
`;
