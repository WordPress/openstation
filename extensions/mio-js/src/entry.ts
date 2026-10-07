import { Application, BlurFilter, Container, Graphics } from 'pixi.js';
import { MIO_DEFAULTS } from '../../../src/mio/config';
import { mountMio } from '../../../src/mio/mio';
import type { MioConfig, MioHandle } from '../../../src/mio/types';
import { getColliders, setColliders } from './colliders';

const LAYER_ID = 'mio-layer';

const STYLE_ID = 'mio-layer-style';

const POSITION_KEY = 'mio-js/position';

const LAYER_CSS = `
#${ LAYER_ID } {
	position: fixed;
	inset: 0;
	overflow: hidden;
	pointer-events: none;
	z-index: 2147483000;
}

#${ LAYER_ID } .os-mio__handle {

	position: absolute;
	top: 0;
	left: 0;
	border-radius: 50%;
	pointer-events: auto;
	cursor: grab;
	will-change: transform;
	touch-action: none;
}

#${ LAYER_ID } .os-mio__handle.is-dragging {
	cursor: grabbing;
}
`;

export interface MioStandalone {

	start: () => Promise< void >;

	stop: () => void;

	isRunning: () => boolean;

	getPosition: () => { x: number; y: number } | null;

	setPosition: ( x: number, y: number ) => void;

	setColliders: ( selector: string | null ) => void;

	getColliders: () => string | null;

	config: MioConfig;
}

declare global {
	interface Window {

		Mio?: MioStandalone;

		MIO_AUTO_BOOT?: boolean;
	}
}

let handle: MioHandle | null = null;
let layer: HTMLElement | null = null;

let starting: Promise< void > | null = null;

function ensureStyle(): void {
	if ( document.getElementById( STYLE_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = STYLE_ID;
	style.textContent = LAYER_CSS;
	document.head.appendChild( style );
}

function ensureLayer(): HTMLElement {
	const existing = document.getElementById( LAYER_ID );
	if ( existing ) {
		return existing;
	}
	const el = document.createElement( 'div' );
	el.id = LAYER_ID;

	el.setAttribute( 'aria-hidden', 'true' );
	document.body.appendChild( el );
	return el;
}

function readPosition(): { x: number; y: number } | null {
	try {
		const raw = window.localStorage.getItem( POSITION_KEY );
		if ( ! raw ) {
			return null;
		}
		const parsed = JSON.parse( raw ) as { x?: unknown; y?: unknown };
		if (
			typeof parsed?.x !== 'number' ||
			typeof parsed?.y !== 'number' ||
			! Number.isFinite( parsed.x ) ||
			! Number.isFinite( parsed.y )
		) {
			return null;
		}
		return { x: parsed.x, y: parsed.y };
	} catch {
		return null;
	}
}

function writePosition( pos: { x: number; y: number } ): void {
	try {
		window.localStorage.setItem( POSITION_KEY, JSON.stringify( pos ) );
	} catch {

	}
}

const PIXI = { Application, BlurFilter, Container, Graphics };

async function withPixiGlobal< T >( fn: () => Promise< T > ): Promise< T > {
	const had = Object.prototype.hasOwnProperty.call( window, 'PIXI' );
	const previous = window.PIXI;
	window.PIXI = PIXI as unknown as typeof window.PIXI;
	try {
		return await fn();
	} finally {
		if ( had ) {
			window.PIXI = previous;
		} else {
			delete window.PIXI;
		}
	}
}

async function start(): Promise< void > {
	if ( handle ) {
		return;
	}
	if ( starting ) {
		return starting;
	}
	starting = ( async () => {
		ensureStyle();
		const host = ensureLayer();
		layer = host;

		let mounted;
		try {
			mounted = await withPixiGlobal( () =>
				mountMio( {
					host,
					config: MIO_DEFAULTS,
					position: readPosition(),
					savePosition: writePosition,
				} ),
			);
		} catch ( err ) {
			console.warn( '[mio-js] Mio failed to start.', err );
			mounted = null;
		}
		if ( ! mounted ) {

			host.remove();
			layer = null;
			return;
		}
		handle = mounted;
	} )().finally( () => {
		starting = null;
	} );
	return starting;
}

function stop(): void {
	const live = handle;
	handle = null;
	if ( live ) {

		const resting = live.getPosition();
		if ( resting ) {
			writePosition( resting );
		}
		live.destroy();
	}
	layer?.remove();
	layer = null;
}

const api: MioStandalone = {
	start,
	stop,
	isRunning: () => handle !== null,
	getPosition: () => handle?.getPosition() ?? null,
	setPosition: ( x: number, y: number ) => handle?.setPosition( x, y ),
	setColliders,
	getColliders,
	config: MIO_DEFAULTS,
};

window.Mio = api;

const tag = document.currentScript as HTMLScriptElement | null;

function wantsAutoBoot(): boolean {
	if ( window.MIO_AUTO_BOOT === false ) {
		return false;
	}
	return tag?.dataset?.mioAuto !== 'false';
}

if ( tag?.dataset?.mioColliders ) {
	setColliders( tag.dataset.mioColliders );
}

if ( wantsAutoBoot() ) {

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', () => void start(), {
			once: true,
		} );
	} else {
		void start();
	}
}

export default api;
