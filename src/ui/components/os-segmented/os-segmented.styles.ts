import { css } from '../../core';
import { holoTokens, holoSheen } from '../../holo';

/**
 * Styles for the iOS-style segmented control. We ship TWO
 * stylesheets — one per child element — so each class can adopt
 * only the rules that apply to it. Keeping them in one file keeps
 * the visual decisions co-located (the parent pill + the inner
 * buttons share a visual language).
 *
 * ## The selected segment is the mesh
 *
 * Of every "one of these is chosen" control in the kit this is the
 * best-behaved place to spend an identity moment: exactly one segment
 * is lit at a time, the lit area is small and bounded, and the thing
 * being said — *this* one — is precisely what an accent is for.
 *
 * A caller who disagrees has two declarations to write —
 * `--os-ui-segmented-selected-image: none` and
 * `--os-ui-segmented-selected-bg: <colour>` — which is how a settings
 * panel with four segmented controls stacked in a column flattens
 * them without touching this file. Two rather than one because a
 * background *colour* cannot override a background *image*; they are
 * different properties and the mesh lives in the second.
 */

export const segmentedStyles = css`
	:host {
		display: inline-flex;
		padding: 3px;
		background: var( --os-ui-segmented-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.05 ) ) );
		border-radius: 7px;
		gap: 2px;
	}
`;

export const segmentStyles = css`
	${ holoTokens }
	${ holoSheen }

	:host {
		flex: 1 1 auto;
		min-width: 0;
	}
	button {
		appearance: none;
		display: block;
		width: 100%;
		padding: 8px 12px;
		background: transparent;
		border: 0;
		font: inherit;
		font-size: 13px;
		color: var( --os-ui-fg-muted, #646970 );
		cursor: pointer;
		border-radius: 5px;
		transition: background-color var( --_holo-t ) ease, color var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease, background-position var( --_holo-t ) ease;
		/* Single-line labels — let the host grow horizontally to fit
		 * the widest segment instead of wrapping mid-word. The pill
		 * is naturally inline-flex so width follows content. */
		white-space: nowrap;
	}

	/* An unselected segment lifts toward its own text colour under
	   the pointer; the holographic film underneath does the rest. */
	button:hover {
		color: var( --os-ui-fg, #1d2327 );
	}

	button:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
	}

	/*
	 * Longhands, not the background shorthand. --_holo-fill is a
	 * nine-layer gradient list, and in a shorthand a trailing
	 * "center / 220% 220%" binds to the LAST layer only — the eight
	 * above it would fall back to auto and the mesh would come apart.
	 */
	:host( [ aria-checked='true' ] ) button {
		background-color: var( --os-ui-segmented-selected-bg, transparent );
		background-image: var(
			--os-ui-segmented-selected-image,
			var( --_holo-fill )
		);
		background-size: 220% 220%;
		background-position: 22% 28%;
		background-repeat: no-repeat;
		color: var( --os-ui-segmented-selected-fg, var( --_holo-ink ) );
		box-shadow: var( --_holo-glow );
		font-weight: 600;
	}

	:host( [ aria-checked='true' ] ) button:hover {
		background-position: 74% 66%;
		color: var( --os-ui-segmented-selected-fg, var( --_holo-ink ) );
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host( [ aria-checked='true' ] ) button:hover {
			background-position: 22% 28%;
		}
	}

	/* The selected segment has nothing to gain from the hover film —
	   it is already the loudest thing in the control. */
	:host( [ aria-checked='true' ] ) button::before {
		display: none;
	}
`;
