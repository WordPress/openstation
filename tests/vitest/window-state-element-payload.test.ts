import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Window } from '../../src/window';
import { HOOKS } from '../../src/hooks';
import type { WindowConfig } from '../../src/types';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

function baseConfig( overrides: Partial< WindowConfig > = {} ): WindowConfig {
	return {
		id: 'payload-w1',
		url: 'http://example.test/wp-admin/edit.php',
		title: 'Editor',
		icon: 'dashicons-admin-post',
		x: 40,
		y: 40,
		width: 800,
		height: 600,
		minWidth: 320,
		minHeight: 200,
		...overrides,
	};
}

function mountWindow(): { win: Window; parent: HTMLElement; cleanup: () => void } {
	const parent = document.createElement( 'div' );
	Object.defineProperty( parent, 'clientWidth', { value: 1200, configurable: true } );
	Object.defineProperty( parent, 'clientHeight', { value: 800, configurable: true } );
	document.body.appendChild( parent );
	const win = new Window( baseConfig() );
	parent.appendChild( win.element );
	Object.defineProperty( win.element, 'offsetLeft', { value: 40, configurable: true } );
	Object.defineProperty( win.element, 'offsetTop', { value: 60, configurable: true } );
	Object.defineProperty( win.element, 'offsetWidth', { value: 800, configurable: true } );
	Object.defineProperty( win.element, 'offsetHeight', { value: 600, configurable: true } );
	return {
		win,
		parent,
		cleanup: () => parent.remove(),
	};
}

describe( 'Window state hook payloads carry the live element', () => {
	let hooks: FakeWpHooks;
	beforeEach( () => {
		hooks = installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	function expectElementPayload(
		hookName: string,
		trigger: () => void,
		win: Window,
	): void {
		const calls: Array< { windowId?: string; element?: unknown } > = [];
		hooks.addAction( hookName, 'test/payload', ( payload: unknown ) => {
			calls.push( payload as { windowId?: string; element?: unknown } );
		} );
		trigger();
		const filtered = calls.filter( ( c ) => c.windowId === win.id );
		expect( filtered.length ).toBeGreaterThanOrEqual( 1 );
		for ( const payload of filtered ) {
			expect( payload.element ).toBe( win.element );
		}
	}

	test( 'WINDOW_MINIMIZED payload includes element', () => {
		const { win, cleanup } = mountWindow();
		try {
			expectElementPayload(
				HOOKS.WINDOW_MINIMIZED,
				() => win.minimize(),
				win,
			);
		} finally {
			cleanup();
		}
	} );

	test( 'WINDOW_RESTORED payload includes element', () => {
		const { win, cleanup } = mountWindow();
		try {
			win.minimize();
			expectElementPayload(
				HOOKS.WINDOW_RESTORED,
				() => win.restore(),
				win,
			);
		} finally {
			cleanup();
		}
	} );

	test( 'WINDOW_MAXIMIZED payload includes element', () => {
		const { win, cleanup } = mountWindow();
		try {
			expectElementPayload(
				HOOKS.WINDOW_MAXIMIZED,
				() => win.maximize(),
				win,
			);
		} finally {
			cleanup();
		}
	} );

	test( 'WINDOW_UNMAXIMIZED payload includes element', () => {
		const { win, cleanup } = mountWindow();
		try {
			win.maximize();
			expectElementPayload(
				HOOKS.WINDOW_UNMAXIMIZED,
				() => win.toggleMaximize(),
				win,
			);
		} finally {
			cleanup();
		}
	} );

	test( 'WINDOW_FULLSCREEN_ENTERED payload includes element', () => {
		const { win, cleanup } = mountWindow();
		try {
			expectElementPayload(
				HOOKS.WINDOW_FULLSCREEN_ENTERED,
				() => win.toggleFullscreen(),
				win,
			);
		} finally {
			cleanup();
		}
	} );

	test( 'WINDOW_FULLSCREEN_EXITED payload includes element', () => {
		const { win, cleanup } = mountWindow();
		try {
			win.toggleFullscreen();
			expectElementPayload(
				HOOKS.WINDOW_FULLSCREEN_EXITED,
				() => win.toggleFullscreen(),
				win,
			);
		} finally {
			cleanup();
		}
	} );

	test( 'backwards compat — windowId is still present alongside element', () => {

		const { win, cleanup } = mountWindow();
		try {
			const seen: Array< { windowId?: string; element?: unknown } > = [];
			hooks.addAction(
				HOOKS.WINDOW_MINIMIZED,
				'test/compat',
				( payload: unknown ) => {
					seen.push( payload as { windowId?: string; element?: unknown } );
				},
			);
			win.minimize();
			expect( seen ).toHaveLength( 1 );
			expect( seen[ 0 ].windowId ).toBe( win.id );
			expect( seen[ 0 ].element ).toBe( win.element );
		} finally {
			cleanup();
		}
	} );
} );
