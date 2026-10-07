import { buildLoadingSpinner } from './inline-loader';

export interface SurfacePlaceholderOptions {

	id: string;

	label: string;

	layerStyle: string[];

	scrimStyle: string[];

	cardStyle: string[];

	onCancel?: () => void;
}

export const SURFACE_HANDOFF_MS = 200;

interface Painted {
	el: HTMLElement;
	onKey: ( e: KeyboardEvent ) => void;

	leaving?: number;
}

const painted = new Map< string, Painted >();

export function showSurfacePlaceholder( options: SurfacePlaceholderOptions ): void {
	const current = painted.get( options.id );
	if ( current && current.el.isConnected && undefined === current.leaving ) {
		return;
	}
	hideSurfacePlaceholder( options.id );

	const cancel = (): void => {
		hideSurfacePlaceholder( options.id );
		options.onCancel?.();
	};
	const onKey = ( e: KeyboardEvent ): void => {
		if ( 'Escape' === e.key ) {
			cancel();
		}
	};
	document.addEventListener( 'keydown', onKey );

	const el = document.createElement( 'div' );
	el.id = options.id;
	el.setAttribute( 'role', 'status' );
	el.setAttribute( 'aria-live', 'polite' );
	el.style.cssText = [
		'position:fixed',
		'inset:0',

		'z-index:9999',
		'display:flex',
		'box-sizing:border-box',
		...options.layerStyle,
	].join( ';' );

	const scrim = document.createElement( 'div' );
	scrim.setAttribute( 'aria-hidden', 'true' );
	scrim.style.cssText = [
		'position:absolute',
		'inset:0',
		...options.scrimStyle,
	].join( ';' );

	const card = document.createElement( 'div' );
	card.style.cssText = [
		'position:relative',
		'display:flex',
		'align-items:center',
		'gap:12px',
		'width:100%',
		'box-sizing:border-box',
		'font-size:14px',
		'font-family:inherit',
		...options.cardStyle,
	].join( ';' );

	const label = document.createElement( 'span' );
	label.textContent = options.label;

	card.appendChild( buildLoadingSpinner() );
	card.appendChild( label );
	el.appendChild( scrim );
	el.appendChild( card );

	el.addEventListener( 'click', ( e ) => {
		if ( ! ( e.target instanceof Node && card.contains( e.target ) ) ) {
			cancel();
		}
	} );
	document.body.appendChild( el );
	painted.set( options.id, { el, onKey } );
}

export function hideSurfacePlaceholder( id: string, afterMs = 0 ): void {
	const current = painted.get( id );
	if ( current && afterMs > 0 ) {
		if ( undefined !== current.leaving ) {
			return;
		}
		document.removeEventListener( 'keydown', current.onKey );
		const { el } = current;
		el.style.pointerEvents = 'none';
		el.style.transition = `opacity ${ afterMs }ms linear`;
		el.style.opacity = '0';
		current.leaving = window.setTimeout( () => {
			el.remove();
			if ( painted.get( id ) === current ) {
				painted.delete( id );
			}
		}, afterMs );
		return;
	}
	if ( current ) {
		window.clearTimeout( current.leaving );
		document.removeEventListener( 'keydown', current.onKey );
		current.el.remove();
		painted.delete( id );
	}

	document.getElementById( id )?.remove();
}
