import { Component, defineComponent, html } from '../../core';
import { styles } from './os-tooltip.styles';

export interface OsTooltipContent {
	heading?: string;
	text?: string;
}

export type OsTooltipSource =
	| string
	| OsTooltipContent
	| ( () => string | OsTooltipContent | null );

export interface AttachTooltipOptions {

	delay?: number;
}

const DEFAULT_DELAY = 500;

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

export function hideTooltip(): void {
	cancelPending();
	owner = null;
	shared?.removeAttribute( 'open' );
	document.removeEventListener( 'keydown', onDocumentKeydown, true );
}

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
