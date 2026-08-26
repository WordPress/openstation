import { css } from '../../core';
import { holoTokens, holoSheen } from '../../holo';

/**
 * Styles for the iOS-style segmented control. We ship TWO
 * stylesheets — one per child element — so each class can adopt
 * only the rules that apply to it. Keeping them in one file keeps
 * the visual decisions co-located (the parent pill + the inner
 * buttons share a visual language).
 *
 * ## The selected segment wears the accent
 *
 * Flat accent, not the mesh: selection states across the kit resolve
 * through --os-ui-accent (checkboxes, switches, sliders, rings), and
 * the segmented pill says "this one" in the same voice. The meshes
 * stay reserved for hero surfaces.
 *
 * A caller who wants a different pill has two declarations to write:
 * `--os-ui-segmented-selected-image: <gradient>` and
 * `--os-ui-segmented-selected-bg: <colour>`. Two rather than one
 * because a background *colour* cannot override a background *image*;
 * they are different properties.
 */

export const segmentedStyles = css`
	${ holoTokens }

	:host {
		display: inline-flex;
		position: relative;
		padding: 3px;
		background: var( --os-ui-segmented-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.05 ) ) );
		border-radius: 8px;
		gap: 2px;
	}

	/*
	 * The thumb — the lit pill that slides between segments.
	 *
	 * It lives in the GROUP's shadow root, not in the selected child,
	 * and that is the whole trick. A fill that belongs to the selected
	 * segment can only appear and disappear; one that belongs to the
	 * group is a single element that moves, so the selection travels
	 * and the eye follows it instead of hunting for what changed.
	 *
	 * Painted before the <slot> in the shadow tree, so it sits under
	 * the slotted labels with no z-index needed — the segments'
	 * buttons are transparent and the thumb shows through.
	 *
	 * Geometry comes from the component, which measures the selected
	 * child against the host and writes --_thumb-x / --_thumb-w.
	 * Measured rather than computed from the child count, because the
	 * segments are content-sized: "Small | Medium | Large" are three
	 * different widths and an nth-child rule would put the pill under
	 * the wrong word.
	 */
	.os-segmented__thumb {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 0;
		width: var( --_thumb-w, 0px );
		border-radius: 6px;
		background-color: var(
			--os-ui-segmented-selected-bg,
			var( --os-ui-accent, #2271b1 )
		);
		background-image: var( --os-ui-segmented-selected-image, none );
		background-size: 220% 220%;
		background-position: 22% 28%;
		background-repeat: no-repeat;
		transform: translateX( var( --_thumb-x, 0px ) );
		pointer-events: none;
		opacity: 0;
	}

	/*
	 * Two flags, and they are not the same thing.
	 *
	 * data-thumb says a segment is selected and the pill has been
	 * measured — without it the thumb is a zero-width smear at the
	 * origin, which is what an unselected group and the first frame
	 * both look like.
	 *
	 * data-thumb-ready is set one frame LATER and is what turns the
	 * transition on. Enabling it with the first measurement would
	 * animate the pill in from x=0 on every page load: a settings
	 * panel where six controls all slide into place on arrival, which
	 * reads as the page assembling itself rather than as a selection
	 * moving.
	 */
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
	 * The selected segment paints NO fill of its own — the group's
	 * thumb is sliding underneath it, and a second fill arriving on
	 * the child at the same time would land instantly and give the
	 * pill something to race.
	 *
	 * All the child does is take the on-accent ink, on the fast
	 * duration so the text has flipped by the time the pill gets
	 * there rather than after. No weight bump: the accent pill
	 * already says which one, and bold would make the control jitter
	 * as the selection moves.
	 */
	:host( [ aria-checked='true' ] ) button {
		color: var(
			--os-ui-segmented-selected-fg,
			var( --os-ui-fg-on-accent, #fff )
		);
		transition-duration: var( --_holo-t-fast );
	}

	/* The selected segment has nothing to gain from the hover film —
	   it is already the loudest thing in the control. */
	:host( [ aria-checked='true' ] ) button::before {
		display: none;
	}
`;
