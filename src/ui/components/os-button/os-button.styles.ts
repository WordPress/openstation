/**
 * `<os-button>` — shadow-DOM styles. Variants are selected via
 * host-attribute selectors (`:host([variant='primary'])`). Every
 * paintable property reads from a CSS custom property FIRST so
 * authors can tune individual buttons (or whole panels) without
 * reimplementing the component.
 *
 * ## The holographic layer
 *
 * Two of the three treatments from `src/ui/holo.ts`, applied the way
 * that module argues for — as a moment, not a skin:
 *
 *   - **Every** variant gets the iridescent hairline and the sheen
 *     under the pointer. At rest they cost nothing (both are
 *     `opacity: 0`), so a panel of buttons still reads as Obsidian
 *     chrome until you reach for one.
 *   - **`variant="holo"`** gets the mesh itself. That is the hero
 *     CTA, one per surface at most — the brand's "meshes reserved for
 *     hero surfaces" written as a variant name so it is hard to reach
 *     for by accident.
 *
 * `primary` deliberately did NOT become the mesh. It is the accent
 * fill and it is everywhere — in dialogs, in toolbars, three to a row
 * in OS Settings — and a mesh three to a row is wallpaper. It gets the
 * edge and the sheen like everything else.
 *
 * ## And two motions
 *
 * The **glint** crosses the face once on hover; the **press ring**
 * expands and fades on `:active`. Both are element-based (a `<span>`
 * each in the template) rather than pseudo-elements, because the sheen
 * and the edge have already spent this button's `::before` and
 * `::after` — see the pseudo-element budget note in `src/ui/holo.ts`.
 *
 * `link` gets neither: it has no surface for a highlight to cross and
 * no box for a ring to leave.
 *
 * The fill is written out rather than borrowed from the `.os-holo-fill`
 * utility class because `--os-ui-button-bg-image` is a desktop-theme
 * texture slot on the base rule: a utility class setting
 * `background-image` would silently outrank a theme's texture on every
 * button, not just the holographic one.
 */
import { css } from '../../core';
import {
	holoTokens,
	holoSheen,
	holoEdge,
	holoGlint,
	holoRing,
	holoDrift,
} from '../../holo';

export const styles = css`
	${ holoTokens }
	${ holoSheen }
	${ holoEdge }
	${ holoGlint }
	${ holoRing }
	${ holoDrift }

	:host {
		display: inline-flex;
	}
	:host( [ fill-cell ] ) {
		display: flex;
		width: 100%;
	}
	button {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: var( --os-ui-button-padding, 6px 12px );
		border-radius: var( --os-ui-button-border-radius, 6px );
		font: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: background-color var( --_holo-t ) ease, color var( --_holo-t ) ease,
			border-color var( --_holo-t ) ease, box-shadow var( --_holo-t ) ease,
			transform 80ms ease;
		/* Ghost (default) */
		background: var( --os-ui-button-bg, transparent );
		/* Desktop-theme texture slot: unset resolves to none. Declared
		   on the base rule so every variant inherits it — the variant
		   rules below override background-COLOR only. */
		background-image: var( --os-ui-button-bg-image, none );
		background-repeat: var( --os-ui-button-bg-image-repeat, repeat );
		background-size: var( --os-ui-button-bg-image-size, auto );
		background-position: var( --os-ui-button-bg-image-position, center );
		color: var( --os-ui-button-fg, var( --os-ui-fg, #1d2327 ) );
		border: var(
			--os-ui-button-border,
			1px solid var( --os-ui-border, #c3c4c7 )
		);
	}
	:host( [ fill-cell ] ) button {
		width: 100%;
		min-height: var( --os-ui-button-min-height, 44px );
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	/*
	 * A press should move. One pixel is enough to read as travel and
	 * small enough that a toolbar of them does not look like it is
	 * bouncing; it is also the cheapest possible transform, so a grid
	 * of forty keypad buttons costs nothing to animate.
	 */
	button:active:not( :disabled ) {
		transform: translateY( 1px );
	}
	button:hover:not( :disabled ) {
		background-color: var( --os-ui-button-bg-hover, var( --os-ui-hover, rgba( 0, 0, 0, 0.04 ) ) );
	}
	/*
	 * One focus ring for the whole kit, replacing the browser default.
	 * It has to survive landing on a bright mesh, which a flat outline
	 * does not — see the note on --_holo-focus.
	 */
	button:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
	}
	/* Every lit layer is suppressed while the button is unavailable —
	   a disabled control that lights up under the pointer is
	   advertising an action it will not take. */
	button:disabled::before,
	button:disabled::after,
	button:disabled .os-holo-glint {
		opacity: 0 !important;
	}
	/* Primary */
	:host( [ variant='primary' ] ) button {
		background-color: var( --os-ui-button-bg, var( --wp-admin-theme-color, #2271b1 ) );
		color: var( --os-ui-button-fg, var( --os-ui-fg-on-accent, #fff ) );
		border: var( --os-ui-button-border, 1px solid transparent );
	}
	:host( [ variant='primary' ] ) button:hover:not( :disabled ) {
		filter: brightness( 1.06 );
		background-color: var( --os-ui-button-bg, var( --wp-admin-theme-color, #2271b1 ) );
		box-shadow: var( --_holo-glow );
	}
	/*
	 * Holo — the hero CTA. The mesh itself, with Void ink on it (every
	 * mesh in the brand is a light surface; see --os-ui-holo-ink), and
	 * the tilt-on-hover that makes it read as foil rather than as a
	 * pink rectangle. One per surface, at most.
	 */
	:host( [ variant='holo' ] ) button {
		background-color: transparent;
		background-image: var( --_holo-fill );
		background-size: 220% 220%;
		background-position: 22% 28%;
		background-repeat: no-repeat;
		color: var( --os-ui-button-fg, var( --_holo-ink ) );
		border: var( --os-ui-button-border, 1px solid transparent );
		box-shadow: var( --_holo-glow );
		font-weight: 600;
		transition: background-position var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease, filter var( --_holo-t ) ease,
			transform 80ms ease;
	}
	:host( [ variant='holo' ] ) button:hover:not( :disabled ) {
		background-color: transparent;
		background-position: 74% 66%;
		box-shadow: var( --_holo-glow-strong );
	}
	:host( [ variant='holo' ] ) button:active:not( :disabled ) {
		background-position: 88% 82%;
		filter: brightness( 0.94 );
	}
	/* The sheen has nothing to add over a full mesh, and reads as haze. */
	:host( [ variant='holo' ] ) button::before {
		display: none;
	}
	@media ( prefers-reduced-motion: reduce ) {
		:host( [ variant='holo' ] ) button:hover:not( :disabled ),
		:host( [ variant='holo' ] ) button:active:not( :disabled ) {
			background-position: 22% 28%;
		}
	}
	/* Secondary — quiet filled control. Neutral chrome, no underline.
	 * Semantic fit for "not the primary action but also not a
	 * destructive one" (AC / ± / % on a calculator; Cancel in a
	 * two-button dialog). */
	:host( [ variant='secondary' ] ) button {
		background-color: var( --os-ui-button-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
		color: var( --os-ui-button-fg, var( --os-ui-fg, #1d2327 ) );
		border: var( --os-ui-button-border, 1px solid transparent );
	}
	:host( [ variant='secondary' ] ) button:hover:not( :disabled ) {
		background-color: var( --os-ui-button-bg-hover, var( --os-ui-hover, rgba( 0, 0, 0, 0.1 ) ) );
	}
	/* Danger */
	:host( [ variant='danger' ] ) button {
		background-color: var( --os-ui-button-bg, transparent );
		color: var( --os-ui-button-fg, var( --os-ui-danger, #d63638 ) );
		border: var( --os-ui-button-border, 1px solid currentColor );
	}
	:host( [ variant='danger' ] ) button:hover:not( :disabled ) {
		background-color: var( --os-ui-danger, #d63638 );
		color: var( --os-ui-fg-on-accent, #fff );
	}
	/*
	 * Danger keeps its own edge. The iridescent hairline says "brand
	 * moment" and a delete button is the one place that is the wrong
	 * sentence — the border should stay red all the way through the
	 * hover, which is the only warning the user gets.
	 */
	:host( [ variant='danger' ] ) button::after {
		display: none;
	}
	/* Link */
	:host( [ variant='link' ] ) button {
		background-color: transparent;
		background-image: none;
		color: var( --os-ui-button-fg, var( --wp-admin-theme-color, #2271b1 ) );
		border: 0;
		padding: 0;
		text-decoration: underline;
	}
	/* No chrome means nothing to put an edge, a film, a highlight or a
	   ring on — a link is text, and text does not catch the light. */
	:host( [ variant='link' ] ) button::before,
	:host( [ variant='link' ] ) button::after,
	:host( [ variant='link' ] ) .os-holo-glint,
	:host( [ variant='link' ] ) .os-holo-ring {
		display: none;
	}
	:host( [ variant='link' ] ) button:active:not( :disabled ) {
		transform: none;
	}
	:host( [ busy ] ) button {
		pointer-events: none;
		opacity: 0.75;
	}
	/*
	 * A busy holo button keeps drifting. It is the one place in the kit
	 * where the ambient animation is load-bearing rather than
	 * decorative: the mesh moving is what says the work is still
	 * running, next to a spinner that says the same thing more quietly.
	 */
	:host( [ variant='holo' ][ busy ] ) button {
		animation: os-holo-drift 12s ease-in-out infinite;
	}
	@media ( prefers-reduced-motion: reduce ) {
		:host( [ variant='holo' ][ busy ] ) button {
			animation: none;
		}
	}
	.os-button__spinner {
		box-sizing: border-box;
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: os-button-spin 0.6s linear infinite;
		flex-shrink: 0;
	}
	@keyframes os-button-spin {
		to {
			transform: rotate( 360deg );
		}
	}
`;
