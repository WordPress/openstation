import { css } from '../../core';
import { holoTokens } from '../../holo';

export const tabsStyles = css`
	:host {
		display: flex;
		gap: 4px;
		margin-bottom: 10px;
		border-bottom: 1px solid var( --os-ui-border, #dcdcde );
	}

	:host( [ orientation='vertical' ] ) {
		flex-direction: column;
		align-items: stretch;
		gap: 0;
		margin-bottom: 0;
		border-bottom: 0;
	}
`;

export const tabPanelStyles = css`

	:host {
		display: block;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	:host( :focus-visible ) {
		outline: 2px solid var( --os-ui-accent, #2271b1 );
		outline-offset: 4px;
		border-radius: 4px;
	}
`;

export const tabStyles = css`
	${ holoTokens }

	:host {
		display: inline-block;
	}

	:host( [ data-orientation='vertical' ] ) {
		display: block;

		--_tab-edge: var(
			--os-ui-tab-edge,
			linear-gradient(
				var( --os-ui-accent, #f252fc ),
				var( --os-ui-accent, #f252fc )
			)
		);
		--_tab-wash: var(
			--os-ui-tab-wash,
			linear-gradient(
				90deg,
				rgba( 242, 82, 252, 0.16 ) 0%,
				rgba( 255, 251, 255, 0.04 ) 42%,
				transparent 100%
			)
		);
		--_tab-bloom: var(
			--os-ui-tab-bloom,
			linear-gradient( 90deg, rgba( 242, 82, 252, 0.26 ), transparent )
		);

		--_tab-edge-w: var( --os-ui-tab-edge-width, 2px );
		--_tab-bloom-o: var( --os-ui-tab-bloom-opacity, 1 );
		--_tab-fill: var( --os-ui-tab-fill, transparent );
		--_tab-radius: var( --os-ui-tab-radius, 0px );
		--_tab-inset: var( --os-ui-tab-inset, 0px );
	}

	:host( [ data-orientation='vertical' ] ) button {
		display: flex;
		align-items: center;
		gap: 11px;
		isolation: isolate;
		overflow: hidden;
		width: calc( 100% - 2 * var( --_tab-inset ) );
		min-height: 40px;
		padding: 0 14px 0 calc( 20px - var( --_tab-inset ) );
		margin-bottom: 0;
		margin-inline: var( --_tab-inset );
		border-radius: var( --_tab-radius );
		text-align: start;
		font-size: 14px;
		font-weight: 400;
		line-height: 1.5;
		white-space: nowrap;
	}

	:host( [ data-orientation='vertical' ] ) slot::slotted( svg ) {
		flex: 0 0 17px;
		width: 17px;
		height: 17px;
		opacity: 0.8;
		transition: opacity var( --_holo-t ) var( --_holo-ease );
	}
	:host( [ data-orientation='vertical' ] ) button:hover slot::slotted( svg ),
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] )
		slot::slotted( svg ) {
		opacity: 1;
	}

	:host( [ data-orientation='vertical' ] ) button::after {
		inset-inline: 0 auto;
		inset-block: 0;
		z-index: -1;
		width: var( --_tab-edge-w );
		height: auto;
		border-radius: 0;
		background-image: var( --_tab-edge );
		transition: opacity var( --_holo-t ) var( --_holo-ease );
	}

	:host( [ data-orientation='vertical' ] ) button::before {
		content: '';
		position: absolute;
		inset-inline: 0 auto;
		inset-block: 0;
		z-index: -1;
		width: 44px;
		background-image: var( --_tab-bloom );
		filter: blur( 8px );
		opacity: 0;
		pointer-events: none;
		transition: opacity var( --_holo-t ) var( --_holo-ease );
	}

	:host( [ data-orientation='vertical' ] ) button:hover::after {
		inset-inline: 0 auto;
		opacity: 0;
	}
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] ) button {
		background-color: var( --_tab-fill );
		background-image: var( --_tab-wash );

		font-weight: 400;
	}

	:host( [ data-orientation='vertical' ][ aria-selected='true' ] ) button::after,
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] )
		button:hover::after {
		inset-inline: 0 auto;
		opacity: 1;
	}
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] )
		button::before {
		opacity: var( --_tab-bloom-o );
	}
	@media ( prefers-reduced-motion: reduce ) {
		:host( [ data-orientation='vertical' ] ) button::before,
		:host( [ data-orientation='vertical' ] ) slot::slotted( svg ) {
			transition-duration: 1ms;
		}
	}
	button {
		appearance: none;
		position: relative;
		padding: 6px 10px 8px;
		border: none;
		background: transparent;
		color: var( --os-ui-fg-muted, #50575e );
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		margin-bottom: -1px;
		transition: color var( --_holo-t ) ease;
	}
	button::after {
		content: '';
		position: absolute;
		inset-inline: 50%;
		bottom: 0;
		height: 2px;
		border-radius: 2px 2px 0 0;
		background-image: linear-gradient(
			var( --os-ui-accent, #2271b1 ),
			var( --os-ui-accent, #2271b1 )
		);
		background-size: 100% 100%;
		opacity: 0;
		transition: inset-inline var( --_holo-t ) ease, opacity var( --_holo-t ) ease;
	}
	button:hover {
		color: var( --os-ui-fg, #1d2327 );
	}

	button:hover::after {
		inset-inline: 30%;
		opacity: 0.45;
	}
	button:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
		border-radius: 4px;
	}
	:host( [ aria-selected='true' ] ) button {
		color: var( --os-ui-fg, #1d2327 );
		font-weight: 600;
	}
	:host( [ aria-selected='true' ] ) button::after,
	:host( [ aria-selected='true' ] ) button:hover::after {
		inset-inline: 0;
		opacity: 1;
	}
	@media ( prefers-reduced-motion: reduce ) {
		button::after {
			transition-duration: 1ms;
		}
	}

`;
