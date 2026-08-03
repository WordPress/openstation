import { css } from '../../core';
import { holoTokens, holoSheen, holoGlint, holoRing } from '../../holo';

/**
 * `<os-key>` — the keypad tile.
 *
 * A key is pressed far more often than it is looked at, so the
 * holographic layer here is the *quietest* one in the kit: the hover
 * film, no edge and no mesh. A grid of twenty iridescent tiles would
 * be a screensaver.
 *
 * `variant="primary"` is the exception, and stays an accent fill
 * rather than a mesh for the same reason a primary button does — on a
 * calculator that variant is the `=` key, and it is on screen next to
 * nineteen others every second the window is open.
 *
 * It does get both motions, though, and a keypad is where they earn
 * the most: the glint on hover, and the press ring on `:active`. A key
 * already squashes (`scale( 0.96 )` plus an inset shadow) — the ring
 * is what makes a *fast repeated* press legible, where the squash
 * alone blurs into one continuous dent.
 */
export const styles = css`
	${ holoTokens }
	${ holoSheen }
	${ holoGlint }
	${ holoRing }

	:host {
		display: inline-flex;
		user-select: none;
	}
	:host( [ fill-cell ] ),
	:host {
		/* Keys default to filling their cell; the calculator use
		 * case is the common one. Callers who want an inline key
		 * tile can override with display:inline-flex and width:auto
		 * on the host. */
		display: flex;
		width: 100%;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	button {
		width: 100%;
		min-height: var( --os-ui-key-min-height, 48px );
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var( --os-ui-key-padding, 8px 12px );
		font: inherit;
		font-size: var( --os-ui-key-font-size, 16px );
		font-weight: 500;
		cursor: pointer;
		border-radius: var( --os-ui-key-border-radius, 8px );
		background: var( --os-ui-key-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
		color: var( --os-ui-key-fg, var( --os-ui-fg, #1d2327 ) );
		border: var( --os-ui-key-border, 1px solid transparent );
		transition:
			transform 0.08s ease,
			background-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	button:hover:not( :disabled ) {
		background: var( --os-ui-key-bg-hover, var( --os-ui-hover, rgba( 0, 0, 0, 0.1 ) ) );
	}
	button:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
	}
	/* A disabled key must not light up under the pointer — the film
	   would advertise a press that will not happen. */
	button:disabled::before {
		opacity: 0 !important;
	}
	:host( [ variant='primary' ] ) button {
		background: var( --os-ui-key-bg, var( --wp-admin-theme-color, #2271b1 ) );
		color: var( --os-ui-key-fg, var( --os-ui-fg-on-accent, #fff ) );
	}
	:host( [ variant='primary' ] ) button:hover:not( :disabled ) {
		filter: brightness( 1.06 );
	}
	:host( [ variant='secondary' ] ) button {
		background: var( --os-ui-key-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.04 ) ) );
	}
	:host( [ variant='ghost' ] ) button {
		background: transparent;
		border: var( --os-ui-key-border, 1px solid var( --os-ui-border, #c3c4c7 ) );
	}
	:host( [ variant='danger' ] ) button {
		background: transparent;
		color: var( --os-ui-danger, #d63638 );
		border: 1px solid currentColor;
	}
	/* Pressed — both click-flash and keyboard-hold resolve here. The
	 * visual is deliberately tactile: inset shadow + subtle scale-down
	 * so the key reads as "squeezed" rather than "disappeared." */
	:host( .os-key--pressed ) button,
	button:active:not( :disabled ) {
		transform: scale( 0.96 );
		box-shadow: inset 0 1px 2px rgba( 0, 0, 0, 0.22 );
		background: var( --os-ui-key-bg-pressed, var( --os-ui-hover, rgba( 0, 0, 0, 0.14 ) ) );
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;
