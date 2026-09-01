/**
 * The tray — the shell's two standing controls, on the dock's edge.
 *
 * The assistant's front door and the way out. Neither belongs on the
 * dock's rail, which is a list of things you open and close.
 *
 * It wraps the bottom dock, extending `--os-tray-strip` above it, and
 * claims that band of work area by being measured. There is no tray
 * without a bottom dock: a side-placed rail takes the same two
 * controls as tiles instead, registered from `desktop.ts`.
 *
 * Nothing here imports a `<os-*>` component — they live in the lazy
 * `shell-overlays` bundle, and the tray paints on every boot.
 */

import { __ } from './i18n';
import { exitOpenStation } from './exit-openstation';
import { buildChord } from './ui/chord';
import { OS_SITE_LOGO_SVG } from './ui/site-logo-icon';

/** Root element id, so a second boot can find and replace its own. */
const TRAY_ID = 'os-tray';

/**
 * The bottom dock, if one is on screen.
 *
 * Exported because two decisions hang off it and they have to agree:
 * the tray attaches when it finds one, `desktop.ts` registers the rail
 * tiles when it does not. `getDockPlacement()` looks like the same
 * question and is not — the split layout stores the user's pick
 * without acting on it, and answers `'left'` while a bottom dock is on
 * screen carrying the tray.
 */
export function findBottomDock(): HTMLElement | null {
	return document.querySelector< HTMLElement >(
		'.os-dock[ data-os-dock-placement="bottom" ]',
	);
}

export interface TrayDeps {
	/**
	 * Opens the assistant. Injected rather than imported so this module
	 * never reaches into the lazy assistant bundle.
	 */
	openAssistant: () => void;
}

export interface TrayApi {
	/** Remove the tray and its listeners. */
	destroy(): void;
}

interface TipHost {
	bind( control: HTMLElement, text: string ): void;
	destroy(): void;
}

/**
 * The hover label, hosted in `document.body`.
 *
 * The strip clips (`overflow: hidden`), which is what keeps a hover
 * fill inside its rounded corners without every control knowing the
 * radius — but the label opens ABOVE the strip, so rendered inside it
 * would be clipped too. The dock's tooltip is body-hosted for the same
 * reason, and pays the same price: position is computed, because there
 * is no longer an ancestor to anchor to.
 *
 * `aria-hidden` always. Every control showing one also carries an
 * `aria-label` saying the same thing, so nothing here is hover-only.
 */
function createTipHost(): TipHost {
	const tip = document.createElement( 'div' );
	tip.className = 'os-tray__tip';
	tip.setAttribute( 'aria-hidden', 'true' );
	document.body.appendChild( tip );

	const show = ( control: HTMLElement, text: string ) => (): void => {
		const rect = control.getBoundingClientRect();
		tip.textContent = text;
		tip.classList.add( 'os-tray__tip--on' );
		// Measured after the text lands, so the centring uses this
		// label's width rather than the previous one's.
		const width = tip.getBoundingClientRect().width;
		tip.style.left = `${ Math.round(
			rect.left + rect.width / 2 - width / 2,
		) }px`;
		tip.style.top = `${ Math.round( rect.top - 8 ) }px`;
	};
	const hide = (): void => tip.classList.remove( 'os-tray__tip--on' );

	return {
		bind: ( control, text ) => {
			control.addEventListener( 'pointerenter', show( control, text ) );
			control.addEventListener( 'focus', show( control, text ) );
			control.addEventListener( 'pointerleave', hide );
			control.addEventListener( 'blur', hide );
		},
		destroy: () => tip.remove(),
	};
}

/**
 * One control: a glyph, a hover label, and a click.
 *
 * The label is a tooltip rather than text beside the glyph because the
 * strip is 16px of the dock's edge, with no room for words.
 */
function buildControl(
	modifier: string,
	label: string,
	glyph: HTMLElement,
	onClick: () => void,
	tips: TipHost,
): HTMLElement {
	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = `os-tray__group os-tray__${ modifier }`;
	button.setAttribute( 'aria-label', label );
	glyph.setAttribute( 'aria-hidden', 'true' );
	button.appendChild( glyph );
	tips.bind( button, label );
	button.addEventListener( 'click', onClick );
	return button;
}

/** The site mark, the same one heading the assistant's own palette. */
function assistantGlyph(): HTMLElement {
	const glyph = document.createElement( 'span' );
	glyph.className = 'os-tray__glyph';
	glyph.innerHTML = OS_SITE_LOGO_SVG;
	return glyph;
}

/** `dashicons-exit`, the clearest "leave" mark in the WordPress set. */
function exitGlyph(): HTMLElement {
	const glyph = document.createElement( 'span' );
	glyph.className = 'dashicons dashicons-exit';
	return glyph;
}

/**
 * Anchor the tray to the bottom dock, and keep it anchored.
 *
 * A SIBLING of the dock, not a child: the layout dispatcher tears
 * rails down and builds fresh ones on every layout change, so anything
 * parented inside one is destroyed with it. Positioned from
 * measurements instead, which also means it never has to care that the
 * split layout has two docks.
 */
function anchorToDock( root: HTMLElement, host: HTMLElement ): () => void {
	let observer: ResizeObserver | null = null;
	let dock: HTMLElement | null = null;

	const measure = ( rail: HTMLElement ): void => {
		const box = rail.getBoundingClientRect();
		// A dock with no box yet has nothing to say; its zero would
		// park the tray at the host's leading edge for a frame.
		if ( box.width === 0 ) {
			return;
		}
		// Relative to the host, the tray's offset parent. The dock is a
		// sibling floating on its own absolute positioning, so there is
		// no layout relationship to lean on — only measurement.
		const hostBox = host.getBoundingClientRect();
		const set = ( name: string, px: number ): void =>
			root.style.setProperty( name, `${ Math.round( px ) }px` );
		set( '--os-tray-dock-height', box.height );
		set( '--os-tray-dock-bottom', hostBox.bottom - box.bottom );
		set( '--os-tray-dock-width', box.width );
		set( '--os-tray-dock-center', box.left + box.width / 2 - hostBox.left );
	};

	const attach = (): void => {
		observer?.disconnect();
		observer = null;

		dock = findBottomDock();
		if ( ! dock ) {
			// Detached rather than hidden: a tray that merely went
			// transparent would still be measured by the work area and
			// still reserve a band nothing occupies.
			root.remove();
			return;
		}
		host.appendChild( root );
		const live = dock;

		// A dock whose tile list changes — a plugin activating, a menu
		// refresh — changes width, and the tray is centred on it.
		//
		// Feature-detected, and not as a formality: this runs during
		// shell boot, and an unguarded constructor would take the
		// desktop down with it. Without the observer the tray still
		// lands correctly from the measures below.
		if ( typeof ResizeObserver === 'function' ) {
			observer = new ResizeObserver( () => measure( live ) );
			observer.observe( live );
		}

		// Measured here too, not left to the observer's initial
		// callback: that is specified but undelivered in a document
		// that is not painting. And again next frame, because a dock
		// mid-render measures narrower than it ends up — a wrong
		// centre rather than none, which the zero guard cannot catch.
		measure( live );
		requestAnimationFrame( () => measure( live ) );
	};

	// A resize moves the dock's centre without changing its own box, so
	// the observer never hears about it.
	const onResize = (): void => {
		if ( dock ) {
			measure( dock );
		}
	};

	attach();
	// Fired after every rebuild — exactly when the element the observer
	// holds stops being the dock.
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
 * @param host Shell body — a sibling of the dock, and inside what
 *             `installWorkArea` measures.
 * @param deps Injected behaviour.
 */
export function mountTray( host: HTMLElement, deps: TrayDeps ): TrayApi {
	document.getElementById( TRAY_ID )?.remove();

	const root = document.createElement( 'div' );
	root.id = TRAY_ID;
	root.className = 'os-tray';

	const tips = createTipHost();
	const assistant = buildControl(
		'assistant',
		__( 'Open site assistant' ),
		assistantGlyph(),
		deps.openAssistant,
		tips,
	);
	// The chord is spelled out because this is the only visible ⌘K
	// affordance the shell has: Core's own palette button lives in an
	// admin bar OpenStation hides by default.
	assistant.appendChild( buildChord() );
	root.appendChild( assistant );
	root.appendChild(
		buildControl(
			'exit',
			__( 'Exit OpenStation' ),
			exitGlyph(),
			() => void exitOpenStation(),
			tips,
		),
	);

	host.appendChild( root );
	const unanchor = anchorToDock( root, host );

	return {
		destroy: () => {
			unanchor();
			tips.destroy();
			root.remove();
		},
	};
}
