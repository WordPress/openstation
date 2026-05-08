/**
 * Desktop Mode — shared breadcrumb header.
 *
 * Both the folder window and the My WordPress folder window grow a
 * navigation stack as the user drills in. The chrome is identical:
 * a small icon-only Back button on the left, then `›`-separated
 * clickable crumb segments, the deepest of which is bold + non-
 * clickable.
 *
 * This module owns the DOM construction so both surfaces render
 * pixel-identical breadcrumbs and share a single set of CSS rules
 * (`.desktop-mode-breadcrumbs__*`). The caller manages the route
 * stack — this is purely a render helper.
 *
 * @public
 * @since 0.8.0
 */

import { __ } from '../i18n';

export interface BreadcrumbSegment {
	/** Visible label for the segment. */
	label: string;
	/**
	 * Click handler. Omit (or pass undefined) for the current
	 * segment — the renderer treats segments without `onClick` as
	 * the "you are here" tail and styles them bold + non-
	 * interactive.
	 */
	onClick?: () => void;
}

export interface BreadcrumbsOptions {
	/**
	 * Fired when the user clicks the Back button. Omit to hide
	 * the Back button entirely (some surfaces only want crumbs).
	 */
	onBack?: () => void;
	/**
	 * When `true`, the Back button is rendered but disabled.
	 * Surfaces that always show the Back button regardless of
	 * stack depth use this to dim it at the root.
	 */
	backDisabled?: boolean;
}

const ROOT_CLASS = 'desktop-mode-breadcrumbs';

/**
 * Build the breadcrumb header DOM into `host`. Replaces children,
 * so calling this on every route change is the canonical pattern.
 *
 * @public
 */
export function renderBreadcrumbs(
	host: HTMLElement,
	segments: BreadcrumbSegment[],
	opts: BreadcrumbsOptions = {},
): void {
	host.replaceChildren();
	host.classList.add( ROOT_CLASS );

	if ( opts.onBack ) {
		const back = document.createElement( 'button' );
		back.type = 'button';
		back.className = `${ ROOT_CLASS }__back`;
		back.setAttribute( 'aria-label', __( 'Back', 'desktop-mode' ) );
		back.title = __( 'Back', 'desktop-mode' );
		const arrow = document.createElement( 'span' );
		arrow.className = 'dashicons dashicons-arrow-left-alt2';
		arrow.setAttribute( 'aria-hidden', 'true' );
		back.appendChild( arrow );
		if ( opts.backDisabled ) {
			back.disabled = true;
		}
		const onBack = opts.onBack;
		back.addEventListener( 'click', () => {
			if ( back.disabled ) {
				return;
			}
			onBack();
		} );
		host.appendChild( back );
	}

	const nav = document.createElement( 'nav' );
	nav.className = `${ ROOT_CLASS }__crumbs`;
	nav.setAttribute( 'aria-label', __( 'Breadcrumb', 'desktop-mode' ) );

	segments.forEach( ( seg, idx ) => {
		if ( idx > 0 ) {
			const sep = document.createElement( 'span' );
			sep.className = `${ ROOT_CLASS }__sep`;
			sep.setAttribute( 'aria-hidden', 'true' );
			sep.textContent = '›';
			nav.appendChild( sep );
		}
		// Convention: the segment WITHOUT an `onClick` is the
		// current/tail segment. Surfaces that want a clickable
		// tail (e.g., to refresh the same view) can supply
		// `onClick` and we'll render it as a button. Skipping
		// `onClick` makes it bold + non-interactive — matches
		// every breadcrumb library on the planet.
		if ( ! seg.onClick ) {
			const here = document.createElement( 'span' );
			here.className = `${ ROOT_CLASS }__crumb ${ ROOT_CLASS }__crumb--current`;
			here.setAttribute( 'aria-current', 'page' );
			here.textContent = seg.label;
			nav.appendChild( here );
			return;
		}
		const btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.className = `${ ROOT_CLASS }__crumb`;
		btn.textContent = seg.label;
		const onClick = seg.onClick;
		btn.addEventListener( 'click', () => {
			onClick();
		} );
		nav.appendChild( btn );
	} );

	host.appendChild( nav );
}
