/**
 * `<os-tooltip>` — hover and keyboard-focus hint for a control.
 *
 * A short dark lozenge that says what a control is for, shown after a
 * short hover or straight away on keyboard focus. It is for the
 * control whose glyph alone does not say what it does — the ⋯ button
 * in a window's title bar is the first one — and it is a visual aid
 * only: the control must still carry its own accessible name.
 *
 * Most callers never write the tag. `attachTooltip()` wires a control
 * to ONE shared `<os-tooltip>` on `document.body` — fixed-positioned,
 * so a window's overflow or transform cannot clip it — and handles
 * the timing, placement and dismissal:
 *
 * ```ts
 * const detach = attachTooltip( button, () => ( {
 *     heading: __( 'Window actions' ),
 *     text: listOfRows(),
 * } ) );
 * ```
 *
 * The content is resolved every time the tooltip shows, so a function
 * can describe state that changes while the control is on screen.
 *
 * Dismissal: leaving the control, pressing on it, moving focus away,
 * or Escape. It never shows for touch, and never while the control
 * reports `aria-expanded="true"` — a tooltip over the menu its own
 * button just opened is noise.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-tooltip.styles';

/** What a tooltip says: an optional bold first line and a body. */
export interface OsTooltipContent {
	heading?: string;
	text?: string;
}

/** A fixed string, a content object, or a function resolved on show. */
export type OsTooltipSource =
	| string
	| OsTooltipContent
	| ( () => string | OsTooltipContent | null );

export interface AttachTooltipOptions {
	/** Hover delay before showing, in ms. Keyboard focus shows at once. */
	delay?: number;
}

/** Hover delay: long enough that sweeping across a title bar stays quiet. */
const DEFAULT_DELAY = 500;

/** Space between the control and the tooltip, and from the viewport edge. */
const GAP = 8;

export class OsTooltip extends Component {
	static props = [ 'heading', 'text', 'open' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Tooltip',
		summary:
			'Short hover / keyboard-focus hint for a control whose glyph does not say what it does. Use `attachTooltip( el, content )` rather than placing the tag: it shares one fixed-positioned tooltip across the page and handles delay, placement and dismissal.',
		status: 'stable',
		props: [
			{
				name: 'heading',
				type: 'string',
				description: 'Optional bold first line, usually the control’s name.',
			},
			{
				name: 'text',
				type: 'string',
				description: 'Body text. Wraps at 280px.',
			},
			{
				name: 'open',
				type: 'boolean attribute',
				description:
					'Shown when present. Set by `attachTooltip()`; set it yourself only when positioning the host by hand.',
			},
		],
		parts: [ { name: 'surface', description: 'The lozenge.' } ],
		cssProps: [
			{
				name: '--os-tooltip-bg',
				description: 'Lozenge background. Shared with the dock tooltip.',
			},
			{
				name: '--os-tooltip-fg',
				description: 'Lozenge text colour. Shared with the dock tooltip.',
			},
		],
		example: html`
			<os-button class="os-tooltip-example" variant="secondary">
				Hover or focus me
			</os-button>
		`,
		exampleInit: ( root: HTMLElement ) => {
			const button = root.querySelector< HTMLElement >( '.os-tooltip-example' );
			if ( button ) {
				attachTooltip( button, {
					heading: 'Window actions',
					text: 'Open on startup, Reload, Open in classic wp-admin',
				} );
			}
		},
	} as const;

	connectedCallback(): void {
		super.connectedCallback?.();
		this.setAttribute( 'role', 'tooltip' );
	}

	protected render() {
		const heading = ( this as unknown as { heading: string | null } ).heading;
		const text = ( this as unknown as { text: string | null } ).text;
		return html`
			<div part="surface" class="surface">
				${ heading ? html`<strong class="heading">${ heading }</strong>` : '' }
				${ text ? html`<span class="text">${ text }</span>` : '' }
			</div>
		`;
	}
}
defineComponent( 'os-tooltip', OsTooltip );

// ------------------------------------------------------------------
// attachTooltip — one shared tooltip, many controls.
// ------------------------------------------------------------------

let shared: HTMLElement | null = null;
let owner: HTMLElement | null = null;
let showTimer: ReturnType< typeof setTimeout > | null = null;
let pending: HTMLElement | null = null;
let positionFrame: number | null = null;

function sharedTooltip(): HTMLElement {
	if ( ! shared || ! shared.isConnected ) {
		shared = document.createElement( 'os-tooltip' );
		document.body.appendChild( shared );
	}
	return shared;
}

function resolveContent( source: OsTooltipSource ): OsTooltipContent | null {
	const value = typeof source === 'function' ? source() : source;
	if ( ! value ) {
		return null;
	}
	const content = typeof value === 'string' ? { text: value } : value;
	return content.heading || content.text ? content : null;
}

function cancelPending(): void {
	if ( showTimer !== null ) {
		clearTimeout( showTimer );
		showTimer = null;
		pending = null;
	}
	if ( positionFrame !== null ) {
		cancelAnimationFrame( positionFrame );
		positionFrame = null;
	}
}

function onDocumentKeydown( e: KeyboardEvent ): void {
	if ( e.key === 'Escape' ) {
		hideTooltip();
	}
}

/**
 * Where the tooltip goes for a control: centred below it, flipped
 * above when the viewport has no room below, and slid sideways to
 * stay `GAP` inside the viewport's left and right edges.
 */
export function placeTooltip(
	anchor: DOMRect,
	size: { width: number; height: number },
	viewport: { width: number; height: number },
): { top: number; left: number } {
	let top = anchor.bottom + GAP;
	if ( top + size.height > viewport.height - GAP && anchor.top - GAP - size.height >= GAP ) {
		top = anchor.top - GAP - size.height;
	}
	const centred = anchor.left + ( anchor.width - size.width ) / 2;
	const maxLeft = Math.max( GAP, viewport.width - size.width - GAP );
	const left = Math.min( Math.max( centred, GAP ), maxLeft );
	return { top: Math.round( top ), left: Math.round( left ) };
}

function showTooltip( anchor: HTMLElement, source: OsTooltipSource ): void {
	cancelPending();
	if ( ! anchor.isConnected || anchor.getAttribute( 'aria-expanded' ) === 'true' ) {
		return;
	}
	const content = resolveContent( source );
	if ( ! content ) {
		return;
	}
	const tip = sharedTooltip();
	owner = anchor;
	if ( content.heading ) {
		tip.setAttribute( 'heading', content.heading );
	} else {
		tip.removeAttribute( 'heading' );
	}
	if ( content.text ) {
		tip.setAttribute( 'text', content.text );
	} else {
		tip.removeAttribute( 'text' );
	}
	// The content renders on a microtask; measure it on the next frame
	// so the placement uses the new size, not the previous tooltip's.
	positionFrame = requestAnimationFrame( () => {
		positionFrame = null;
		if ( owner !== anchor || ! anchor.isConnected ) {
			return;
		}
		const box = tip.getBoundingClientRect();
		const { top, left } = placeTooltip(
			anchor.getBoundingClientRect(),
			{ width: box.width, height: box.height },
			{ width: window.innerWidth, height: window.innerHeight },
		);
		tip.style.top = `${ top }px`;
		tip.style.left = `${ left }px`;
		tip.setAttribute( 'open', '' );
		document.addEventListener( 'keydown', onDocumentKeydown, true );
	} );
}

/** Hide the shared tooltip, whichever control it belongs to. */
export function hideTooltip(): void {
	cancelPending();
	owner = null;
	shared?.removeAttribute( 'open' );
	document.removeEventListener( 'keydown', onDocumentKeydown, true );
}

/** Whether a focus event landed through the keyboard rather than a click. */
function isKeyboardFocus( e: FocusEvent ): boolean {
	const target = e.composedPath()[ 0 ];
	if ( ! ( target instanceof Element ) ) {
		return false;
	}
	try {
		return target.matches( ':focus-visible' );
	} catch {
		return false;
	}
}

/**
 * Give `anchor` a tooltip. Returns a function that removes it.
 *
 * `source` is a string, `{ heading, text }`, or a function returning
 * either (or `null` to skip showing this time), resolved on every show.
 */
export function attachTooltip(
	anchor: HTMLElement,
	source: OsTooltipSource,
	options: AttachTooltipOptions = {},
): () => void {
	const delay = options.delay ?? DEFAULT_DELAY;

	const onPointerEnter = ( e: PointerEvent ) => {
		if ( e.pointerType === 'touch' ) {
			return;
		}
		cancelPending();
		pending = anchor;
		showTimer = setTimeout( () => {
			showTimer = null;
			pending = null;
			showTooltip( anchor, source );
		}, delay );
	};
	const onFocusIn = ( e: FocusEvent ) => {
		if ( isKeyboardFocus( e ) ) {
			showTooltip( anchor, source );
		}
	};
	const onLeave = () => {
		if ( owner === anchor || pending === anchor ) {
			hideTooltip();
		}
	};

	anchor.addEventListener( 'pointerenter', onPointerEnter );
	anchor.addEventListener( 'pointerleave', onLeave );
	anchor.addEventListener( 'pointerdown', onLeave );
	anchor.addEventListener( 'focusin', onFocusIn );
	anchor.addEventListener( 'focusout', onLeave );

	return () => {
		anchor.removeEventListener( 'pointerenter', onPointerEnter );
		anchor.removeEventListener( 'pointerleave', onLeave );
		anchor.removeEventListener( 'pointerdown', onLeave );
		anchor.removeEventListener( 'focusin', onFocusIn );
		anchor.removeEventListener( 'focusout', onLeave );
		onLeave();
	};
}
