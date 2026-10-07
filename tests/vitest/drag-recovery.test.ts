import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DragManager } from '../../src/drag/manager';
import { __resetRecoveryForTests } from '../../src/drag/recovery';

function pointerEvent(
	type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
	clientX: number,
	clientY: number,
	target: HTMLElement | Document = document,
): PointerEvent {
	const ev = new Event( type, { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	Object.defineProperty( ev, 'clientX', { value: clientX } );
	Object.defineProperty( ev, 'clientY', { value: clientY } );
	if ( target instanceof HTMLElement ) {
		Object.defineProperty( ev, 'target', { value: target } );
	}
	return ev as unknown as PointerEvent;
}

function makeSource(): HTMLElement {
	const el = document.createElement( 'div' );
	el.className = 'os-file-tile';
	document.body.appendChild( el );
	return el;
}

function startActiveDrag( manager: DragManager, onCancel: () => void ): { source: HTMLElement } {
	const source = makeSource();
	manager.start( {
		payload: { type: 'desktop-file', source, data: {} },
		origin: pointerEvent( 'pointerdown', 50, 50, source ),
		onCancel,
	} );
	document.dispatchEvent( pointerEvent( 'pointermove', 60, 50 ) );
	return { source };
}

describe( 'DragManager recovery', () => {
	beforeEach( () => {
		installHooksStub();
		__resetRecoveryForTests();

		document.elementFromPoint = () => null;
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
	} );

	test( 'Escape mid-drag cancels the session and scrubs DOM state', () => {
		const manager = new DragManager();
		const onCancel = vi.fn();
		const { source } = startActiveDrag( manager, onCancel );

		const escape = new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } );
		document.dispatchEvent( escape );

		expect( onCancel ).toHaveBeenCalledWith( 'escape' );
		expect( source.classList.contains( 'os-file-tile--dragging' ) ).toBe( false );
		expect( document.querySelector( '.os-drag-ghost' ) ).toBeNull();
		expect( manager.debug().findOrphans() ).toEqual( [] );
	} );

	test( 'window blur mid-drag cancels with reason=blur', () => {
		const manager = new DragManager();
		const onCancel = vi.fn();
		startActiveDrag( manager, onCancel );

		window.dispatchEvent( new Event( 'blur' ) );

		expect( onCancel ).toHaveBeenCalledWith( 'blur' );
	} );

	test( 'visibilitychange to hidden cancels with reason=visibility', () => {
		const manager = new DragManager();
		const onCancel = vi.fn();
		startActiveDrag( manager, onCancel );

		Object.defineProperty( document, 'hidden', { value: true, configurable: true } );
		document.dispatchEvent( new Event( 'visibilitychange' ) );

		expect( onCancel ).toHaveBeenCalledWith( 'visibility' );

		Object.defineProperty( document, 'hidden', { value: false, configurable: true } );
	} );

	test( 'pointercancel fires CancelReason="pointercancel"', () => {
		const manager = new DragManager();
		const onCancel = vi.fn();
		startActiveDrag( manager, onCancel );

		document.dispatchEvent( pointerEvent( 'pointercancel', 60, 50 ) );

		expect( onCancel ).toHaveBeenCalledWith( 'pointercancel' );
	} );

	test( 'recovery handlers are idempotent — duplicate cancels do not re-fire onCancel', () => {
		const manager = new DragManager();
		const onCancel = vi.fn();
		startActiveDrag( manager, onCancel );

		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) );
		window.dispatchEvent( new Event( 'blur' ) );

		expect( onCancel ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'Escape WITHOUT an active drag is a no-op', () => {
		const manager = new DragManager();

		expect( () => {
			document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) );
		} ).not.toThrow();
		expect( manager.getActive() ).toBeNull();
	} );
} );
