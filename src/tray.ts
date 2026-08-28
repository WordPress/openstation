/**
 * The tray — one pill of shell chrome, divided into sections.
 *
 * The assistant's front door and the way out. They belong to the same
 * corner and read as one object, so they share one capsule; the
 * hairline divider between them is what keeps them two separate
 * subjects rather than one long readout.
 *
 * The time is deliberately NOT here. A clock is glanceable content,
 * which is what the widget layer is for — `src/widgets/built-in.ts`
 * ships one, and it can be moved, resized and removed like anything
 * else on the desk. Pinning it into shell chrome made it the one
 * readout on the desktop nobody could turn off.
 *
 * The surface is drawn once, by the pill itself — the sections carry
 * only their contents and a leading-edge divider, so the outer caps
 * are rounded without any section needing to know which end of the row
 * it sits on. See `tray.css`.
 *
 * **It claims no work-area inset.** The work area (`src/work-area/`)
 * is a band model, and this is a corner pill: a top inset would push
 * every window, icon and graph down by the tray's height across the
 * full width of the desktop, to clear something occupying one corner
 * of it. The widgets column IS nudged down (`desktop.css`), because
 * it is the one neighbour that actually shares the corner, but that
 * is one sibling yielding to another rather than a claim on the
 * shared rectangle.
 *
 * **Nothing here imports a `<os-*>` component.** The tray paints on
 * every boot and the component classes live in the lazy
 * `shell-overlays` bundle, so one would either drag that bundle into
 * the critical path or render as an inert unstyled tag until it
 * arrived. Plain DOM instead, for as long as this stays small.
 */

import { __ } from './i18n';
import { exitOpenStation } from './exit-openstation';
import { osIconSvg } from './ui/icons';

/** Root element id, so a second boot can find and replace its own. */
const TRAY_ID = 'os-tray';

export interface TrayDeps {
	/**
	 * Opens the assistant. Injected rather than imported so this
	 * module never reaches into the lazy assistant bundle — the tray
	 * paints on every boot, the assistant is downloaded only if
	 * asked for.
	 */
	openAssistant: () => void;
}

export interface TrayApi {
	/** Remove the tray and drop its timers. */
	destroy(): void;
}

/**
 * Is this a Mac keyboard? Decides `⌘` vs `Ctrl` in the chord hint.
 *
 * `userAgentData.platform` where it exists, `navigator.platform`
 * where it doesn't. The latter is deprecated and the former is
 * Chromium-only, so neither alone covers the field. Getting this
 * wrong costs a wrong glyph in a hint, so there is no fallback
 * beyond guessing "not a Mac".
 */
function isMacKeyboard(): boolean {
	const uaData = ( navigator as Navigator & {
		userAgentData?: { platform?: string };
	} ).userAgentData;
	const platform = uaData?.platform || navigator.platform || '';
	return /mac/i.test( platform );
}

/**
 * The assistant pill: a search glyph and the chord that also opens it.
 *
 * The chord is spelled out rather than implied because this is the
 * only visible ⌘K affordance the shell has — Core's own palette
 * button is in an admin bar that OpenStation hides by default.
 */
function buildAssistant( openAssistant: () => void ): HTMLElement {
	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'os-tray__group os-tray__assistant';
	button.setAttribute( 'aria-label', __( 'Open the site assistant' ) );

	const glyph = document.createElement( 'span' );
	glyph.className = 'os-tray__glyph';
	glyph.setAttribute( 'aria-hidden', 'true' );
	glyph.innerHTML = osIconSvg( 'search', { size: null } );
	button.appendChild( glyph );

	// `aria-hidden`: the button's own label already names the action,
	// and a screen reader spelling out "command K" adds nothing for a
	// user who reaches this by keyboard anyway.
	const chord = document.createElement( 'span' );
	chord.className = 'os-tray__chord';
	chord.setAttribute( 'aria-hidden', 'true' );
	for ( const key of isMacKeyboard() ? [ '⌘', 'K' ] : [ 'Ctrl', 'K' ] ) {
		const kbd = document.createElement( 'kbd' );
		kbd.textContent = key;
		chord.appendChild( kbd );
	}
	button.appendChild( chord );

	button.addEventListener( 'click', openAssistant );
	return button;
}

/**
 * The way out of the shell.
 *
 * `dashicons-exit` — the same glyph it wore on the dock, and the
 * clearest "leave" mark in the WordPress set. A dashicon rather than
 * one of ours because the icon set is generated from the brand
 * repository and has no exit drawing; the font is already on the page
 * for the dock's own tiles.
 *
 * The label is a tooltip rather than text beside the glyph. Spelling
 * it out inline would make leaving the loudest thing in a pill whose
 * other sections are a search hint and a name, and this is a rare,
 * one-way action — findable on hover is the right prominence for it.
 * It is still the button's `aria-label`, so nothing about it is
 * hover-only for anyone not using a pointer.
 */
function buildExit(): HTMLElement {
	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'os-tray__group os-tray__exit';
	button.setAttribute( 'aria-label', __( 'Exit OpenStation' ) );

	const glyph = document.createElement( 'span' );
	glyph.className = 'dashicons dashicons-exit';
	glyph.setAttribute( 'aria-hidden', 'true' );
	button.appendChild( glyph );

	// `aria-hidden`: the button's own label already says this, and a
	// screen reader announcing both would read the control twice.
	const tip = document.createElement( 'span' );
	tip.className = 'os-tray__tip';
	tip.setAttribute( 'aria-hidden', 'true' );
	tip.textContent = __( 'Exit OpenStation' );
	button.appendChild( tip );

	button.addEventListener( 'click', () => {
		void exitOpenStation();
	} );
	return button;
}

/**
 * Anchor the tray to the bottom dock, and keep it anchored.
 *
 * The tray reads as a second, smaller shelf behind the dock — the iOS
 * stacked-sheet idiom, where the card behind is the same material,
 * just narrower. Nothing is actually behind anything: the shelf rests
 * flush on the dock's top edge, and SQUARE BOTTOM CORNERS are what
 * say the surface carries on underneath it. Hiding real geometry back
 * there would be paying to render a strip nobody can see.
 *
 * It is NOT a child of the dock. The layout dispatcher tears rails
 * down and builds fresh ones on every layout or placement change, so
 * anything parented inside one is destroyed with it. The tray stays on
 * the shell and is positioned from measurements instead, which also
 * means it never has to care that the split layout has two docks.
 *
 * There is no bottom dock to hide behind when the user puts their
 * single rail on the left or the right, so the tray falls back to
 * floating in the top-right corner. `data-os-tray-mode` carries which
 * of the two it currently is, and the stylesheet does the rest.
 */
function anchorToDock( root: HTMLElement, shell: HTMLElement ): () => void {
	let observer: ResizeObserver | null = null;

	const measure = ( dock: HTMLElement ): void => {
		const dockBox = dock.getBoundingClientRect();
		// A dock with no box yet has nothing to say. Writing its zero
		// would place the shelf at the shell's leading edge for a
		// frame, which is worse than the `50%` the stylesheet falls
		// back to while the properties are unset.
		if ( dockBox.width === 0 ) {
			return;
		}
		const shellBox = shell.getBoundingClientRect();
		// Relative to the shell, which is the tray's offset parent —
		// the dock lives further down the tree and floats on its own
		// absolute positioning, so the two boxes have no useful
		// ancestor relationship to lean on.
		root.style.setProperty(
			'--os-tray-dock-height',
			`${ Math.round( dockBox.height ) }px`,
		);
		root.style.setProperty(
			'--os-tray-dock-bottom',
			`${ Math.round( shellBox.bottom - dockBox.bottom ) }px`,
		);
		root.style.setProperty(
			'--os-tray-dock-width',
			`${ Math.round( dockBox.width ) }px`,
		);
		root.style.setProperty(
			'--os-tray-dock-center',
			`${ Math.round(
				dockBox.left + dockBox.width / 2 - shellBox.left,
			) }px`,
		);
	};

	const attach = (): void => {
		observer?.disconnect();
		observer = null;

		const dock = document.querySelector< HTMLElement >(
			'.os-dock[ data-os-dock-placement="bottom" ]',
		);
		root.dataset.osTrayMode = dock ? 'shelf' : 'pill';
		if ( ! dock ) {
			return;
		}

		// A dock whose tile list changes — a plugin activating, a
		// menu refresh — changes width, and the shelf is centred on
		// it. Observing is what keeps the two from drifting apart
		// without polling for it.
		//
		// Feature-detected, and not as a formality: this runs during
		// shell boot, and an unguarded constructor call would throw
		// there. Losing the desktop because a decorative shelf could
		// not watch a box is not a trade worth making — without the
		// observer the shelf still lands correctly from the measures
		// below and still follows a window resize, it just stops
		// tracking a dock that silently changes width.
		if ( typeof ResizeObserver === 'function' ) {
			observer = new ResizeObserver( () => measure( dock ) );
			observer.observe( dock );
		}

		// Measured here as well, rather than left to the observer's
		// initial callback. That callback is specified but not
		// dependable — a document that is not painting (a background
		// tab, a headless pane) can leave it undelivered, and the
		// shelf would sit on its fallback centre indefinitely with
		// nothing scheduled to correct it.
		measure( dock );
		// …and again next frame, because the reverse case is just as
		// real: a dock mid-render measures narrower than it ends up,
		// which is a wrong centre rather than no centre, and the
		// zero-width guard does not catch it.
		requestAnimationFrame( () => measure( dock ) );
	};

	// A resize moves the dock's centre without changing its own box,
	// so the observer never hears about it. Re-measuring is enough —
	// the element itself has not been replaced, so nothing needs
	// rebinding, and rebuilding the observer on every resize event
	// would be the expensive way to ask the same question.
	const onResize = (): void => {
		const dock = document.querySelector< HTMLElement >(
			'.os-dock[ data-os-dock-placement="bottom" ]',
		);
		if ( dock ) {
			measure( dock );
		}
	};

	attach();
	// The dispatcher fires this after every rebuild, which is exactly
	// when the element the observer is holding stops being the dock.
	document.addEventListener( 'os-layout-changed', attach );
	window.addEventListener( 'resize', onResize );

	return () => {
		observer?.disconnect();
		document.removeEventListener( 'os-layout-changed', attach );
		window.removeEventListener( 'resize', onResize );
	};
}

/**
 * Mount the tray.
 *
 * @param shell Shell root to append to.
 * @param deps  Injected behaviour — see {@link TrayDeps}.
 */
export function mountTray( shell: HTMLElement, deps: TrayDeps ): TrayApi {
	document.getElementById( TRAY_ID )?.remove();

	const root = document.createElement( 'div' );
	root.id = TRAY_ID;
	root.className = 'os-tray';

	root.appendChild( buildAssistant( deps.openAssistant ) );
	root.appendChild( buildExit() );

	shell.appendChild( root );
	const unanchor = anchorToDock( root, shell );

	return {
		destroy: () => {
			unanchor();
			root.remove();
		},
	};
}
