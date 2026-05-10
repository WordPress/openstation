import { css } from '../../core';

/**
 * `<wpd-flyout>` — window-scoped sliding card.
 *
 * Per the 14-point spec: `position: absolute` inside the window
 * body (which is `position: relative; overflow: hidden`), card
 * shape with all four corners rounded + a large drop shadow,
 * margins from every edge so the title bar / chrome stays
 * visible above and a small gutter remains on the trailing
 * edges. NOT a viewport-fixed drawer — the flyout reads as a
 * floating card *inside* the window, not as a panel pinned to
 * the viewport edge.
 *
 * Animation: slide from off-screen-end to in-place + fade in.
 * Reduced motion snaps. RTL flips the transform sign via
 * `:host-context( [ dir='rtl' ] )` so the inline-end placement
 * still slides in from the user's reading-direction edge.
 *
 * **z-index: 10** intentionally — above the window body, below
 * the shell chrome. NOT 9999.
 */
export const flyoutStyles = css`
	:host {
		display: block;
		position: absolute;
		z-index: 10;

		/* Card surface — white against the window background, with
		   a large drop shadow so it visibly sits above the content. */
		background: var(
			--wpd-flyout-bg,
			var( --wpd-surface-elevated, #ffffff )
		);
		color: var( --wpd-flyout-fg, var( --desktop-mode-fg, #1d2327 ) );
		border-radius: 14px;
		box-shadow: var(
			--wpd-flyout-shadow,
			0 16px 48px rgba( 0, 25, 53, 0.4 )
		);

		/* Closed state — translated off the inline-end edge + faded
		   out. The window body's overflow:hidden crops the off-screen
		   translate so it does not leak into siblings.               */
		transform: translateX( 110% );
		opacity: 0;
		pointer-events: none;
		transition:
			transform 220ms cubic-bezier( 0.22, 1, 0.36, 1 ),
			opacity 180ms ease;
	}

	:host( [ open ] ) {
		transform: translateX( 0 );
		opacity: 1;
		pointer-events: auto;
	}

	/* placement = end (default — anchored to the inline-end edge,
	   gutters on top / bottom / inline-end). Title bar above stays
	   visible thanks to the 64px block-start inset. */
	:host( [ placement='end' ] ),
	:host( :not( [ placement ] ) ) {
		inset-block: 64px 14px;
		inset-inline-end: 14px;
		width: min( 320px, calc( 100% - 28px ) );
	}

	/* placement = start (anchored to the inline-start edge). */
	:host( [ placement='start' ] ) {
		inset-block: 64px 14px;
		inset-inline-start: 14px;
		width: min( 320px, calc( 100% - 28px ) );
		transform: translateX( -110% );
	}
	:host( [ placement='start' ][ open ] ) {
		transform: translateX( 0 );
	}

	/* placement = top (slides down from the block-start edge,
	   spans the inline width with gutters). Useful for in-window
	   filter / search drawers. */
	:host( [ placement='top' ] ) {
		inset-block-start: 14px;
		inset-inline: 14px;
		max-block-size: calc( 100% - 28px );
		transform: translateY( -110% );
	}
	:host( [ placement='top' ][ open ] ) {
		transform: translateY( 0 );
	}

	/* RTL — flip the transform sign on the inline placements so
	   the panel still slides in from the user's reading-direction
	   end. The inset-inline-* properties already swap sides
	   automatically. */
	:host-context( [ dir='rtl' ] ):host( [ placement='end' ] ),
	:host-context( [ dir='rtl' ] ):host( :not( [ placement ] ) ) {
		transform: translateX( -110% );
	}
	:host-context( [ dir='rtl' ] ):host( [ placement='end' ][ open ] ),
	:host-context( [ dir='rtl' ] ):host( :not( [ placement ] ) [ open ] ) {
		transform: translateX( 0 );
	}
	:host-context( [ dir='rtl' ] ):host( [ placement='start' ] ) {
		transform: translateX( 110% );
	}
	:host-context( [ dir='rtl' ] ):host( [ placement='start' ][ open ] ) {
		transform: translateX( 0 );
	}

	/* Optional window-scoped backdrop. Off by default — the
	   flyout is additive to the window content. Plugins set
	   --wpd-flyout-backdrop (e.g. rgba(0,0,0,0.4)) when they
	   want modality scoped to the window only.                 */
	:host::before {
		content: '';
		position: fixed;
		inset: 0;
		background: var( --wpd-flyout-backdrop, transparent );
		z-index: -1;
		pointer-events: none;
		transition: opacity 180ms ease;
		opacity: 0;
	}
	:host( [ open ] )::before {
		opacity: 1;
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host {
			transition: none;
		}
		:host::before {
			transition: none;
		}
	}
`;
