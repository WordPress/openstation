import { css } from '../../core';
import { holoTokens, holoSheen } from '../../holo';

export const segmentedStyles = css`
	${ holoTokens }

	:host {
		display: inline-flex;
		position: relative;
		padding: 3px;
		background: var( --os-ui-segmented-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.05 ) ) );
		border-radius: 8px;
		gap: 2px;
		box-shadow: var( --os-ui-segmented-edge, none );
	}

	.os-segmented__thumb {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 0;
		width: var( --_thumb-w, 0px );
		border-radius: 6px;
		background-color: var(
			--os-ui-segmented-selected-bg,
			color-mix(
				in srgb,
				var( --os-ui-accent, #2271b1 )
					var( --os-ui-segmented-selected-accent, 100% ),
				var(
					--os-ui-segmented-selected-base,
					var( --os-ui-surface, #fff )
				)
			)
		);
		background-image: var( --os-ui-segmented-selected-image, none );
		box-shadow: var( --os-ui-segmented-selected-shadow, none );
		background-size: 220% 220%;
		background-position: 22% 28%;
		background-repeat: no-repeat;
		transform: translateX( var( --_thumb-x, 0px ) );
		pointer-events: none;
		opacity: 0;
	}

	:host( [ data-thumb ] ) .os-segmented__thumb {
		opacity: 1;
	}

	:host( [ data-thumb-ready ] ) .os-segmented__thumb {
		transition: transform var( --_holo-t-slow ) var( --_holo-spring ),
			width var( --_holo-t-slow ) var( --_holo-ease ),
			opacity var( --_holo-t-fast ) linear;
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host( [ data-thumb-ready ] ) .os-segmented__thumb {
			transition-duration: 1ms;
		}
	}
`;

export const segmentStyles = css`
	${ holoTokens }
	${ holoSheen }

	:host {
		flex: 1 1 auto;
		min-width: 0;

		--_holo-sheen: var(
			--os-ui-segmented-hover-sheen,
			var(
				--os-ui-holo-sheen,
				linear-gradient(
					124deg,
					rgba( 159, 214, 255, 0.1 ) 0%,
					rgba( 236, 155, 255, 0.12 ) 34%,
					rgba( 242, 82, 252, 0.1 ) 58%,
					rgba( 147, 240, 198, 0.09 ) 100%
				)
			)
		);
	}
	button {
		appearance: none;
		display: block;
		width: 100%;
		padding: 6px 13px;
		background: transparent;
		border: 0;
		font: inherit;
		font-size: 13px;
		color: var( --os-ui-fg-muted, #646970 );
		cursor: pointer;
		border-radius: 6px;
		transition: background-color var( --_holo-t ) ease, color var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease, background-position var( --_holo-t ) ease;

		white-space: nowrap;
	}

	button:hover {
		color: var( --os-ui-fg, #1d2327 );
	}
	:host( :not( [ aria-checked='true' ] ) ) button:hover {
		background-color: var( --os-ui-segmented-hover-bg, transparent );
	}

	button:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
	}

	:host( [ aria-checked='true' ] ) button {
		color: var(
			--os-ui-segmented-selected-fg,
			color-mix(
				in srgb,
				var( --os-ui-accent-ink, var( --os-ui-fg-on-accent, #fff ) )
					var( --os-ui-segmented-selected-accent, 100% ),
				var( --os-ui-fg, #1d2327 )
			)
		);
		transition-duration: var( --_holo-t-fast );
	}

	:host( [ aria-checked='true' ] ) button::before {
		display: none;
	}
`;
