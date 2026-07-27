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
	public x = 0;
	public y = 0;
	public constructor( public texture: unknown ) {
		super();
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
	document.body.append( element );

	const overlay = new FakeContainer();
	const canvas = document.createElement( 'canvas' );
	canvas.getBoundingClientRect = () =>
		( { left: 0, top: 0, width: 800, height: 600 } ) as DOMRect;

	const selection = Object.fromEntries(
		def.transitions.map( ( t ) => [ t, { id: def.id } ] ),
	);

	const engine = startWindowEffectEngine( {
		stage: {
			pixi: { Container: FakeContainer, Sprite: FakeSprite },
			overlay,
			ticker: { add: () => undefined, remove: () => undefined },
			canvas,
			captureRegion: () => ( { source: null, destroy: () => undefined } ),
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
	};
}

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
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-window-opened', {
				detail: { windowId: WINDOW_ID },
			} ),
		);
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
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
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
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );

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
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
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

		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
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
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
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
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
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

		// Two frames later the snapshot has caught up and the copy can go.
		vi.advanceTimersByTime( 64 );
		expect( h.overlay.children ).toHaveLength( 0 );
		h.engine();
	} );

	test( 'tears the stand-in down even if frames stop arriving', async () => {
		const h = await harness( {
			id: 'clothy',
			label: 'Clothy',
			transitions: [ 'drag' ],
		} );
		h.hooks.doAction( h.HOOKS.WINDOW_DRAG_START, { windowId: WINDOW_ID } );
		h.resolvers[ 0 ]();
		await Promise.resolve();
		await Promise.resolve();

		// A backgrounded tab stops painting; the copy must not survive it.
		vi.advanceTimersByTime( 250 );
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
