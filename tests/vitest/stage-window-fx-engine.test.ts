/**
 * Engine-level tests for window transition effects: how long the real
 * window stays hidden, and how it is handed back when the effect ends.
 *
 * Both behaviours are invisible in the registry tests and both produced
 * user-visible bugs — a watchdog firing mid-drag, and a one-frame gap
 * where neither the animation nor the window was drawn.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { CanvasStage } from '../../src/stage/stage';
import type {
	WindowEffectDef,
	WindowEffectRunContext,
} from '../../src/stage/window-fx/types';

/** Minimal stand-ins for the Pixi display objects the engine builds. */
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

/** Enough of `Graphics` / `BlurFilter` for the shadow builder. */
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

/**
 * Record every `opacity` / `transition` write on an element, in order.
 *
 * The order is the contract: handing transitions back before — or in
 * the same breath as — the opacity change lets the window's 200 ms
 * `opacity` transition catch it and fade instead of switching.
 *
 * @param element The element to watch.
 * @return A live array of `prop=value` strings.
 */
function recordStyleWrites( element: HTMLElement ): string[] {
	const writes: string[] = [];
	const style = element.style;
	for ( const prop of [ 'opacity', 'transition' ] as const ) {
		const original = Object.getOwnPropertyDescriptor(
			CSSStyleDeclaration.prototype,
			prop,
		);
		Object.defineProperty( style, prop, {
			configurable: true,
			get: () => original?.get?.call( style ),
			set: ( value: string ) => {
				writes.push( `${ prop }=${ value }` );
				original?.set?.call( style, value );
			},
		} );
	}
	return writes;
}

interface Harness {
	engine: () => void;
	overlay: FakeContainer;
	element: HTMLElement;
	contexts: WindowEffectRunContext[];
	resolvers: Array< () => void >;
	hooks: NonNullable< typeof window.wp >[ 'hooks' ];
	HOOKS: Record< string, string >;
	/** How many times the engine has frozen a region of the desktop. */
	captures: () => number;
	/** How many times it has repainted a capture from a newer snapshot. */
	recaptures: () => number;
	/** Run one frame of everything the engine put on the ticker. */
	tick: () => void;
	/** Whether the engine is waiting for the snapshot to catch up. */
	awaitingSnapshot: () => boolean;
	/** Deliver the snapshot the engine is waiting for. */
	deliverSnapshot: () => void;
}

/**
 * Boot an engine wired to fake Pixi objects, with `def` registered and
 * selected for every transition it claims.
 *
 * @param def The effect under test, minus its `run`.
 */
async function harness(
	def: Omit< WindowEffectDef, 'run' >,
): Promise< Harness > {
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
			// Never resolves on its own — each test decides when.
			return new Promise< void >( ( resolve ) => {
				resolvers.push( resolve );
			} );
		},
	} );

	const element = document.createElement( 'div' );
	element.id = `wp-window-${ WINDOW_ID }`;
	element.getBoundingClientRect = () =>
		( { left: 10, top: 20, width: 300, height: 200 } ) as DOMRect;
	// Windows ship a shadow by default (`variables.css`), and it paints
	// outside the border box the capture is taken from.
	element.style.boxShadow = 'rgba(0, 0, 0, 0.3) 0px 8px 32px 0px';
	document.body.append( element );

	const overlay = new FakeContainer();
	const canvas = document.createElement( 'canvas' );
	canvas.getBoundingClientRect = () =>
		( { left: 0, top: 0, width: 800, height: 600 } ) as DOMRect;

	const selection = Object.fromEntries(
		def.transitions.map( ( t ) => [ t, { id: def.id } ] ),
	);

	// The real stage hands the callback back a frame or two later, once
	// the browser has repainted and the texture has been re-uploaded.
	let pending: ( () => void ) | null = null;
	let captures = 0;
	let recaptures = 0;
	const ticks: Array< () => void > = [];

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
			recaptureRegion: () => {
				recaptures++;
				return true;
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
		recaptures: () => recaptures,
		tick: () => {
			for ( const fn of [ ...ticks ] ) {
				fn();
			}
		},
		awaitingSnapshot: () => pending !== null,
		deliverSnapshot: () => {
			const cb = pending;
			pending = null;
			cb?.();
		},
	};
}

/**
 * Begin a drag and let the desktop snapshot catch up.
 *
 * The effect starts on the first call; the second is what corrects its
 * capture and hides the real window, which is the state most of these
 * tests are actually about.
 *
 * @param h The harness.
 */
function startDrag( h: Harness ): void {
	h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
	h.deliverSnapshot();
}

/**
 * Announce a newly opened window and let the snapshot catch up.
 *
 * Open corrects too, and for a starker reason than drag: the window is
 * announced in the same block that created it, so it has never been
 * painted and the first capture holds the wallpaper behind it.
 *
 * @param h The harness.
 */
function openWindow( h: Harness ): void {
	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-window-opened', {
			detail: { windowId: WINDOW_ID },
		} ),
	);
	h.deliverSnapshot();
}

describe( 'window effect engine — capturing the right pixels', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );
	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
		clearHooksStub();
	} );

	/*
	 * The pointerdown that precedes a drag raises the window to the top
	 * of the stack — possibly in the same frame. The DOM knows that; the
	 * snapshot the stage draws does not yet, so the first capture comes
	 * out with whatever had been sitting on top of it baked in.
	 *
	 * Nothing waits for that. Delaying the effect until the snapshot
	 * caught up left the real window being dragged, unaltered, for a beat
	 * before the animation took over — a worse artefact than the bug.
	 */
	test( 'a drag animates immediately and corrects its capture after', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );

		// Up on screen in the frame the gesture began.
		expect( h.captures() ).toBe( 1 );
		expect( h.contexts ).toHaveLength( 1 );
		expect( h.awaitingSnapshot() ).toBe( true );
		// Still visible, and covered by the stand-in: it has to be IN the
		// next snapshot for the corrected capture to contain it.
		expect( h.element.style.opacity ).toBe( '' );

		h.deliverSnapshot();
		expect( h.recaptures() ).toBe( 1 );
		// Only now does the copy take over alone.
		expect( h.element.style.opacity ).toBe( '0.001' );
		h.engine();
	} );

	/*
	 * Open is the starker case. The window is announced in the same
	 * synchronous block that created it, so it has never been painted:
	 * the rectangle still holds the WALLPAPER that was behind it, and a
	 * scale-and-fade dutifully animated that instead of the window,
	 * which is what made an opening window look see-through.
	 */
	test( 'an open corrects its capture — the window is not painted yet', async () => {
		const h = await harness( {
			id: 'scale-fade',
			label: 'Scale & fade',
			transitions: [ 'open' ],
		} );
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-opened', {
				detail: { windowId: WINDOW_ID },
			} ),
		);

		expect( h.captures() ).toBe( 1 );
		expect( h.awaitingSnapshot() ).toBe( true );
		// Still visible: it has to be painted once to be capturable at all.
		expect( h.element.style.opacity ).toBe( '' );

		h.deliverSnapshot();
		expect( h.recaptures() ).toBe( 1 );
		expect( h.element.style.opacity ).toBe( '0.001' );
		h.engine();
	} );

	/*
	 * `Window`'s constructor adds a class that runs a 200 ms
	 * `opacity: 0 → 1` keyframe. Left alone it defeats the effect twice
	 * over: the corrected capture lands on a window still at roughly zero
	 * opacity, and a running CSS animation outranks inline styles, so the
	 * engine's own hide does not apply until it ends.
	 */
	test( 'an open cancels the window manager CSS opening animation', async () => {
		const h = await harness( {
			id: 'scale-fade',
			label: 'Scale & fade',
			transitions: [ 'open' ],
		} );
		h.element.classList.add( 'desktop-mode-window--opening' );

		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-opened', {
				detail: { windowId: WINDOW_ID },
			} ),
		);

		expect(
			h.element.classList.contains( 'desktop-mode-window--opening' ),
		).toBe( false );
		h.engine();
	} );

	test( 'leaves the CSS opening animation alone when no effect claims open', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		h.element.classList.add( 'desktop-mode-window--opening' );

		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-opened', {
				detail: { windowId: WINDOW_ID },
			} ),
		);

		// Nothing is replacing it, so the window manager's own animation
		// is the only one there is.
		expect(
			h.element.classList.contains( 'desktop-mode-window--opening' ),
		).toBe( true );
		h.engine();
	} );

	test( 'keeps the stand-in hidden until its pixels are right', async () => {
		const h = await harness( {
			id: 'scale-fade',
			label: 'Scale & fade',
			transitions: [ 'open' ],
		} );
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-opened', {
				detail: { windowId: WINDOW_ID },
			} ),
		);

		// Showing the first capture would show the WALLPAPER — the exact
		// see-through flash this is all about. The real window is the
		// better thing to look at for that frame.
		const layer = h.overlay.children[ 0 ] as FakeContainer & {
			visible: boolean;
		};
		expect( layer.visible ).toBe( false );

		h.deliverSnapshot();
		expect( layer.visible ).toBe( true );
		h.engine();
	} );

	/*
	 * The opposite case, and the reason this is not done for every
	 * transition: a minimise is announced once the window is ALREADY
	 * minimised. There the stale snapshot is the point — it is the only
	 * remaining record of what the window looked like before, and
	 * repainting it would capture the aftermath.
	 */
	test( 'a minimise hides at once and never corrects', async () => {
		const h = await harness( {
			id: 'genie',
			label: 'Genie',
			transitions: [ 'minimize' ],
		} );
		h.hooks.doAction( h.HOOKS.WINDOW_MINIMIZED, {
			windowId: WINDOW_ID,
			element: h.element,
		} );

		expect( h.captures() ).toBe( 1 );
		expect( h.awaitingSnapshot() ).toBe( false );
		expect( h.element.style.opacity ).toBe( '0.001' );
		h.engine();
	} );

	test( 'a drag that ends before the correction lands never corrects', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_END, { windowId: WINDOW_ID } );
		// The effect winds itself down; its cleanup runs on resolution.
		h.resolvers[ 0 ]();
		await Promise.resolve();
		await Promise.resolve();

		// Repainting now would write into a texture already queued for
		// release, and re-hide a window that has just been handed back.
		// The snapshot the engine is waiting on now is the hand-back, not
		// the correction, so delivering it must not repaint anything.
		h.deliverSnapshot();
		expect( h.recaptures() ).toBe( 0 );
		expect( h.element.style.opacity ).toBe( '' );
		h.engine();
	} );

	test( 'a close whose capture fails does not claim the close', async () => {
		const h = await harness( {
			id: 'poof',
			label: 'Poof',
			transitions: [ 'close' ],
		} );
		// A zero-area window: mid-layout, or already gone.
		h.element.getBoundingClientRect = () =>
			( { left: 0, top: 0, width: 0, height: 0 } ) as DOMRect;

		// Claiming a duration the engine cannot animate would hold the
		// window open, visible and doing nothing, before it vanished.
		expect(
			h.hooks.applyFilters( h.HOOKS.WINDOW_CLOSE_ANIMATION, null, {
				windowId: WINDOW_ID,
				element: h.element,
			} ),
		).toBeNull();
		h.engine();
	} );

	test( 'tearing the engine down cancels a pending correction', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
		h.engine();

		h.deliverSnapshot();
		expect( h.recaptures() ).toBe( 0 );
	} );
} );

describe( 'window effect engine — the drawn shadow', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );
	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
		clearHooksStub();
	} );

	test( 'hands the effect a shadow when the window is coming back', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		startDrag( h );
		expect( h.contexts[ 0 ].shadow ).not.toBeNull();
		h.engine();
	} );

	test( 'draws no shadow for a close', async () => {
		const h = await harness( {
			id: 'poof',
			label: 'Poof',
			transitions: [ 'close' ],
		} );
		h.hooks.applyFilters( h.HOOKS.WINDOW_CLOSE_ANIMATION, null, {
			windowId: WINDOW_ID,
			element: h.element,
		} );

		// The window ends up gone, so there is no moment of comparison to
		// get wrong — and a crisp shadow outliving a dissolving window
		// would be an artefact of its own.
		expect( h.contexts[ 0 ].shadow ).toBeNull();
		h.engine();
	} );

	test( 'keeps the shadow aligned to the stand-in sprite', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		startDrag( h );

		const ctx = h.contexts[ 0 ];
		const sprite = ctx.sprite as unknown as {
			x: number;
			y: number;
			alpha: number;
			rotation: number;
			scale: { set( x: number, y: number ): void };
		};
		sprite.x = 500;
		sprite.y = 300;
		sprite.alpha = 0.5;
		sprite.rotation = 0.25;
		sprite.scale.set( 2, 3 );
		h.tick();

		const shadow = ctx.shadow as unknown as {
			x: number;
			y: number;
			alpha: number;
			rotation: number;
			scale: { x: number; y: number };
		};
		expect( shadow.x ).toBe( 500 );
		expect( shadow.y ).toBe( 300 );
		expect( shadow.alpha ).toBe( 0.5 );
		expect( shadow.rotation ).toBe( 0.25 );
		expect( shadow.scale.x ).toBe( 2 );
		h.engine();
	} );

	test( 'lets go the moment the effect replaces the sprite', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		startDrag( h );

		const ctx = h.contexts[ 0 ];
		const sprite = ctx.sprite as unknown as {
			x: number;
			visible: boolean;
		};
		const shadow = ctx.shadow as unknown as { x: number };

		// The cloth hides the sprite and drives a mesh instead. There is
		// nothing sensible left to track, so the shadow becomes the
		// effect's to place.
		sprite.visible = false;
		shadow.x = 42;
		sprite.x = 900;
		h.tick();

		expect( shadow.x ).toBe( 42 );
		h.engine();
	} );
} );

describe( 'window effect engine — how long the window stays hidden', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );
	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
		clearHooksStub();
	} );

	test( 'a momentary effect that never resolves un-hides the window on a watchdog', async () => {
		const h = await harness( {
			id: 'stuck',
			label: 'Stuck',
			transitions: [ 'open' ],
		} );
		openWindow( h );
		expect( h.element.style.opacity ).toBe( '0.001' );

		// A window nobody can click is worse than a missing animation.
		vi.advanceTimersByTime( 4000 );
		expect( h.element.style.opacity ).toBe( '' );
		h.engine();
	} );

	test( 'a drag is never cut off by a timer, however long it lasts', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		startDrag( h );
		expect( h.element.style.opacity ).toBe( '0.001' );

		// Ten minutes of dragging is unusual, not invalid. Any ceiling
		// picked out of the air eventually fires mid-drag and re-renders
		// the real window behind its own animation.
		vi.advanceTimersByTime( 10 * 60 * 1000 );
		expect( h.element.style.opacity ).toBe( '0.001' );
		expect( h.contexts[ 0 ].signal.aborted ).toBe( false );
		h.engine();
	} );

	test( 'releasing the pointer ends a drag even if drag-end never fires', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		startDrag( h );

		// The failsafe is a fact — the pointer is up — rather than a clock.
		document.dispatchEvent( new Event( 'pointerup' ) );
		expect( h.contexts[ 0 ].signal.aborted ).toBe( true );
		h.engine();
	} );

	test( 'a lost pointer capture ends a drag too', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		startDrag( h );
		document.dispatchEvent( new Event( 'pointercancel' ) );
		expect( h.contexts[ 0 ].signal.aborted ).toBe( true );
		h.engine();
	} );
} );

describe( 'window effect engine — hiding without animating', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );
	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
		clearHooksStub();
	} );

	/*
	 * Windows carry `opacity 0.2s ease` in their base transition list
	 * (`assets/css/window-chrome.css`). Without pinning transitions off,
	 * writing the property does not hide or show a window — it fades it,
	 * and the stand-in is long gone before the fade finishes.
	 */
	test( 'suppresses the transition around both writes, and only around them', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		const writes = recordStyleWrites( h.element );

		startDrag( h );
		expect( writes.splice( 0 ) ).toEqual( [
			'transition=none',
			'opacity=0.001',
			// Handed straight back: a snap-drag gives the window a
			// deliberate 90 ms transition of its own, and holding this off
			// for the effect's whole run would silently flatten it.
			'transition=',
		] );

		h.resolvers[ 0 ]();
		await Promise.resolve();
		await Promise.resolve();

		expect( writes ).toEqual( [
			'transition=none',
			'opacity=',
			'transition=',
		] );
		h.engine();
	} );

	test( 'restores an inline transition the window already had', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		h.element.style.transition = 'left 1s linear';
		startDrag( h );
		expect( h.element.style.transition ).toBe( 'left 1s linear' );
		h.engine();
	} );

	test( 'the watchdog un-hides without animating either', async () => {
		const h = await harness( {
			id: 'stuck',
			label: 'Stuck',
			transitions: [ 'open' ],
		} );
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-opened', {
				detail: { windowId: WINDOW_ID },
			} ),
		);
		vi.advanceTimersByTime( 4000 );
		expect( h.element.style.opacity ).toBe( '' );
		expect( h.element.style.transition ).toBe( '' );
		h.engine();
	} );
} );

describe( 'window effect engine — handing the window back', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );
	afterEach( () => {
		vi.useRealTimers();
		document.body.innerHTML = '';
		clearHooksStub();
	} );

	test( 'un-hides the window BEFORE removing its stand-in', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		startDrag( h );
		expect( h.overlay.children ).toHaveLength( 1 );

		h.resolvers[ 0 ]();
		await Promise.resolve();
		await Promise.resolve();

		/*
		 * The stage draws a SNAPSHOT of the DOM refreshed once a frame,
		 * so the restored window is not on screen yet. Removing the
		 * stand-in now would leave a gap where neither is drawn — the
		 * blink at the end of a drag.
		 */
		expect( h.element.style.opacity ).toBe( '' );
		expect( h.overlay.children ).toHaveLength( 1 );

		// Once the snapshot has caught up, the copy can go.
		h.deliverSnapshot();
		expect( h.overlay.children ).toHaveLength( 0 );
		h.engine();
	} );

	test( 'waits for the snapshot rather than a number of frames', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		startDrag( h );
		h.resolvers[ 0 ]();
		await Promise.resolve();
		await Promise.resolve();

		// Counting frames was only ever the right order of magnitude:
		// land early and the gap is back, land late and the copy
		// overstays. Time passing is not the signal.
		vi.advanceTimersByTime( 10000 );
		expect( h.overlay.children ).toHaveLength( 1 );

		h.deliverSnapshot();
		expect( h.overlay.children ).toHaveLength( 0 );
		h.engine();
	} );

	test( 'a close tears down at once — that element is leaving the DOM', async () => {
		const h = await harness( {
			id: 'poof',
			label: 'Poof',
			transitions: [ 'close' ],
		} );
		const claimed = h.hooks.applyFilters(
			h.HOOKS.WINDOW_CLOSE_ANIMATION,
			null,
			{ windowId: WINDOW_ID, element: h.element },
		);
		expect( claimed ).toBeGreaterThan( 0 );

		h.resolvers[ 0 ]();
		await Promise.resolve();
		await Promise.resolve();

		// Holding a copy of a window that is supposed to be gone would
		// flash it back for a frame.
		expect( h.overlay.children ).toHaveLength( 0 );
		h.engine();
	} );
} );
