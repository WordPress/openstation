/**
 * Engine-level tests for the LIVE capture path.
 *
 * When the stage can promote a window (`acquireLiveWindow`), drag and
 * open effects animate a texture that re-uploads from the real element
 * every paint — so the engine must NOT freeze a region, must NOT hide
 * the element, and must send the element home (demote) exactly once,
 * at cleanup, so a cloth settle can keep sampling live pixels while a
 * snap-commit moves the real window underneath it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { CanvasStage, LiveWindowCapture } from '../../src/stage/stage';
import type {
	WindowEffectDef,
	WindowEffectRunContext,
} from '../../src/stage/window-fx/types';

class FakeContainer {
	public children: FakeContainer[] = [];
	public destroyed = false;
	public visible = true;
	public x = 0;
	public y = 0;
	public alpha = 1;
	public rotation = 0;
	public scale = {
		x: 1,
		y: 1,
		set( x: number, y: number ) {
			this.x = x;
			this.y = y;
		},
	};
	public addChild( child: FakeContainer ): FakeContainer {
		this.children.push( child );
		return child;
	}
	public removeChild( child: FakeContainer ): FakeContainer {
		this.children = this.children.filter( ( c ) => c !== child );
		return child;
	}
	public destroy(): void {
		this.destroyed = true;
	}
}

class FakeSprite extends FakeContainer {
	public constructor( public texture: unknown ) {
		super();
	}
}

class FakeGraphics {
	public filters: unknown[] = [];
	public roundRect() {
		return this;
	}
	public fill() {
		return this;
	}
}

const WINDOW_ID = 'w1';

interface LiveHarness {
	engine: () => void;
	overlay: FakeContainer;
	element: HTMLElement;
	contexts: WindowEffectRunContext[];
	resolvers: Array< () => void >;
	hooks: NonNullable< typeof window.wp >[ 'hooks' ];
	HOOKS: Record< string, string >;
	captures: () => number;
	acquisitions: () => number;
	demotions: () => number;
	liveTexture: unknown;
	opacityWrites: () => string[];
	deliverSnapshot: () => void;
	awaitingSnapshot: () => boolean;
	/** Make the next acquireLiveWindow call decline. */
	declineNextAcquire: () => void;
}

async function liveHarness(
	def: Omit< WindowEffectDef, 'run' >,
): Promise< LiveHarness > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	installHooksStub();

	const { registerWindowEffect } = await import(
		'../../src/stage/window-fx/registry'
	);
	const { startWindowEffectEngine } = await import(
		'../../src/stage/window-fx/engine'
	);
	const { HOOKS } = await import( '../../src/hooks' );

	const contexts: WindowEffectRunContext[] = [];
	const resolvers: Array< () => void > = [];
	registerWindowEffect( {
		...def,
		run( ctx ) {
			contexts.push( ctx );
			return new Promise< void >( ( resolve ) => {
				resolvers.push( resolve );
			} );
		},
	} );

	const element = document.createElement( 'div' );
	element.id = `wp-window-${ WINDOW_ID }`;
	element.getBoundingClientRect = () =>
		( { left: 10, top: 20, width: 300, height: 200 } ) as DOMRect;
	document.body.append( element );

	const opacityWrites: string[] = [];
	const style = element.style;
	const original = Object.getOwnPropertyDescriptor(
		CSSStyleDeclaration.prototype,
		'opacity',
	);
	Object.defineProperty( style, 'opacity', {
		configurable: true,
		get: () => original?.get?.call( style ),
		set: ( value: string ) => {
			opacityWrites.push( value );
			original?.set?.call( style, value );
		},
	} );

	const overlay = new FakeContainer();
	const canvas = document.createElement( 'canvas' );
	canvas.getBoundingClientRect = () =>
		( { left: 0, top: 0, width: 800, height: 600 } ) as DOMRect;

	const selection = Object.fromEntries(
		def.transitions.map( ( t ) => [ t, { id: def.id } ] ),
	);

	let pending: ( () => void ) | null = null;
	let captures = 0;
	let acquisitions = 0;
	let demotions = 0;
	let decline = false;
	const ticks: Array< () => void > = [];
	const liveTexture = { source: null, destroy: () => undefined };

	const engine = startWindowEffectEngine( {
		stage: {
			pixi: {
				Container: FakeContainer,
				Sprite: FakeSprite,
				Graphics: FakeGraphics,
				BlurFilter: class {},
			},
			overlay,
			ticker: {
				add: ( fn: () => void ) => ticks.push( fn ),
				remove: ( fn: () => void ) => {
					const i = ticks.indexOf( fn );
					if ( i !== -1 ) {
						ticks.splice( i, 1 );
					}
				},
			},
			canvas,
			captureRegion: () => {
				captures++;
				return { source: null, destroy: () => undefined };
			},
			recaptureRegion: () => true,
			acquireLiveWindow: (): LiveWindowCapture | null => {
				if ( decline ) {
					decline = false;
					return null;
				}
				acquisitions++;
				let demoted = false;
				return {
					texture: liveTexture,
					get demoted() {
						return demoted;
					},
					demote: () => {
						if ( ! demoted ) {
							demoted = true;
							demotions++;
						}
					},
				} as unknown as LiveWindowCapture;
			},
			afterNextSnapshot: ( cb: () => void ) => {
				pending = cb;
				return () => {
					pending = null;
				};
			},
		} as unknown as CanvasStage,
		getSelection: () => selection,
	} );

	return {
		engine,
		overlay,
		element,
		contexts,
		resolvers,
		hooks: window.wp!.hooks,
		HOOKS: HOOKS as unknown as Record< string, string >,
		captures: () => captures,
		acquisitions: () => acquisitions,
		demotions: () => demotions,
		liveTexture,
		opacityWrites: () => opacityWrites,
		awaitingSnapshot: () => pending !== null,
		deliverSnapshot: () => {
			const cb = pending;
			pending = null;
			cb?.();
		},
		declineNextAcquire: () => {
			decline = true;
		},
	};
}

/** Flush the promise chain the engine's cleanup rides on. */
async function settle(): Promise< void > {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

const DRAG_DEF: Omit< WindowEffectDef, 'run' > = {
	id: 'test-live',
	label: 'Test live',
	transitions: [ 'drag' ],
};

const OPEN_DEF: Omit< WindowEffectDef, 'run' > = {
	id: 'test-live-open',
	label: 'Test live open',
	transitions: [ 'open' ],
};

let h: LiveHarness;

afterEach( () => {
	h?.engine();
	clearHooksStub();
	document.body.innerHTML = '';
} );

beforeEach( () => {
	vi.useRealTimers();
} );

describe( 'live drag capture', () => {
	test( 'uses the live texture and never freezes a region', async () => {
		h = await liveHarness( DRAG_DEF );

		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );

		expect( h.acquisitions() ).toBe( 1 );
		expect( h.captures() ).toBe( 0 );
		expect( h.contexts ).toHaveLength( 1 );
		expect( h.contexts[ 0 ].texture ).toBe( h.liveTexture );
	} );

	test( 'never touches the element opacity', async () => {
		// The element must keep painting: its own texture records it
		// every frame, and hiding it is the frozen path's business.
		h = await liveHarness( DRAG_DEF );

		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
		h.deliverSnapshot();
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_END, { windowId: WINDOW_ID } );
		h.resolvers[ 0 ]();
		await settle();

		expect( h.opacityWrites() ).toEqual( [] );
	} );

	test( 'keeps the stand-in hidden until the first snapshot', async () => {
		// Until the canvas paints once, the live texture is empty and
		// the shell still shows the window; drawing both would double
		// it, drawing the empty texture would blank it.
		h = await liveHarness( DRAG_DEF );

		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );

		const layer = h.overlay.children[ 0 ];
		expect( layer.visible ).toBe( false );
		expect( h.awaitingSnapshot() ).toBe( true );

		h.deliverSnapshot();
		expect( layer.visible ).toBe( true );
	} );

	test( 'demotes at cleanup, not at drag-end', async () => {
		h = await liveHarness( DRAG_DEF );

		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
		h.deliverSnapshot();

		// Drag ends; the effect is still settling (unresolved). The
		// element must STAY promoted: out of the shell texture (or it
		// would show rigid behind its own settling sheet) and live (a
		// snap-commit may still be moving it).
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_END, { windowId: WINDOW_ID } );
		expect( h.contexts[ 0 ].signal.aborted ).toBe( true );
		expect( h.demotions() ).toBe( 0 );

		// The settle finishes — now the window goes home, and teardown
		// waits for the snapshot that contains it again.
		h.resolvers[ 0 ]();
		await settle();
		expect( h.demotions() ).toBe( 1 );
		expect( h.overlay.children ).toHaveLength( 1 );

		h.deliverSnapshot();
		expect( h.overlay.children ).toHaveLength( 0 );
	} );

	test( 'a superseding drag demotes the previous capture', async () => {
		h = await liveHarness( DRAG_DEF );

		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
		h.deliverSnapshot();
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );

		expect( h.acquisitions() ).toBe( 2 );
		expect( h.demotions() ).toBe( 1 );
	} );

	test( 'falls back to the frozen path when promotion declines', async () => {
		h = await liveHarness( DRAG_DEF );
		h.declineNextAcquire();

		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );

		expect( h.acquisitions() ).toBe( 0 );
		expect( h.captures() ).toBe( 1 );
		// The frozen fallback hides the element once its capture has
		// been corrected from the next snapshot.
		h.deliverSnapshot();
		expect( h.opacityWrites() ).toContain( '0.001' );
	} );

	test( 'engine disposal demotes a live capture', async () => {
		h = await liveHarness( DRAG_DEF );

		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
		h.deliverSnapshot();

		h.engine();
		expect( h.demotions() ).toBe( 1 );
	} );
} );

describe( 'live open capture', () => {
	test( 'opens with the live texture and demotes on completion', async () => {
		h = await liveHarness( OPEN_DEF );

		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-opened', {
				detail: { windowId: WINDOW_ID },
			} ),
		);

		expect( h.acquisitions() ).toBe( 1 );
		expect( h.captures() ).toBe( 0 );

		h.deliverSnapshot();
		h.resolvers[ 0 ]();
		await settle();

		expect( h.demotions() ).toBe( 1 );
		expect( h.opacityWrites() ).toEqual( [] );
	} );

	test( 'the watchdog demotes a hung open effect', async () => {
		vi.useFakeTimers();
		h = await liveHarness( OPEN_DEF );

		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-opened', {
				detail: { windowId: WINDOW_ID },
			} ),
		);
		expect( h.demotions() ).toBe( 0 );

		// The effect never resolves. A stranded promoted element would
		// be a window the shell texture never shows again.
		vi.advanceTimersByTime( 5000 );
		expect( h.demotions() ).toBe( 1 );
		vi.useRealTimers();
	} );
} );
