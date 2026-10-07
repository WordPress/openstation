import { css } from '../../core';
import { holoTokens } from '../../holo';

export const styles = css`
	${ holoTokens }

	:host {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
	}
	:host( [ size='small' ] ) {
		display: inline-block;
		width: 32px;
		height: 32px;
		aspect-ratio: 1 / 1;
		flex: 0 0 auto;
	}

	:host( [ variant='accent' ] ) {
		display: inline-block;
		width: 28px;
		height: 28px;
		aspect-ratio: 1 / 1;
		flex: 0 0 auto;
	}

	:host( [ size='small' ][ variant='accent' ] ) button {
		border-radius: 8px;
	}

	:host( [ size='small' ][ variant='accent' ] )
		button[ aria-pressed='true' ] {
		box-shadow: 0 0 0 2px var( --os-ui-surface-sunken, #f0f0f1 ),
			0 0 0 4px var( --os-ui-accent, #2271b1 );
	}

	:host( [ size='small' ][ variant='accent' ] )
		button[ aria-pressed='true' ]:focus-visible {
		box-shadow: var( --_holo-focus );
	}

	:host( [ variant='wallpaper' ] ) {
		aspect-ratio: 16 / 10;
	}
	:host( [ variant='wallpaper' ] ) button {
		display: flex;
		align-items: flex-end;
		justify-content: flex-start;
		padding: 8px;
		overflow: hidden;
	}
	button {
		appearance: none;

		position: relative;
		width: 100%;
		height: 100%;
		padding: 0;
		border-radius: 10px;
		border: 2px solid transparent;
		cursor: pointer;

		background-color: var( --os-ui-surface-sunken, #eee );
		background-size: cover;
		background-position: center;
		transition: transform 0.15s ease, border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	:host( [ size='small' ] ) button {
		border-radius: 50%;
	}
	button:hover {
		transform: scale( 1.04 );
	}
	button:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
	}

	button[ aria-pressed='true' ] {
		border-color: transparent;
		box-shadow: 0 0 0 var( --os-ui-swatch-ring-width, 2px ) var( --os-ui-accent, #2271b1 ),
			var( --os-ui-swatch-lift, 0 0 0 0 transparent );
	}

	:host( :not( [ variant='accent' ] ) ) button[ aria-pressed='true' ]::after {
		content: '';
		position: absolute;
		top: 6px;
		inset-inline-end: 6px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var( --os-ui-swatch-badge-bg, transparent );
		pointer-events: none;
		-webkit-mask: url( "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 12.5l4 4 8-9'/%3E%3C/svg%3E" )
				center / 12px no-repeat,
			linear-gradient( #000 0 0 );
		-webkit-mask-composite: xor;
		mask: url( "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 12.5l4 4 8-9'/%3E%3C/svg%3E" )
				center / 12px no-repeat,
			linear-gradient( #000 0 0 );
		mask-composite: exclude;
	}

	button[ aria-pressed='true' ]:focus-visible {
		box-shadow: var( --_holo-focus );
	}

	:host( [ variant='wallpaper' ] ) button:hover {
		transform: translateY( -2px );
	}
`;
