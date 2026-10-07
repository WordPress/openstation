import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Window } from '../../src/window';
import type { WindowConfig } from '../../src/types';
import { paintWindowSlots } from '../../src/window-chrome/slots/render';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function baseConfig( overrides: Partial< WindowConfig > = {} ): WindowConfig {
	return {
		id: 'revision-php',
		url: 'http://example.test/wp-admin/revision.php?revision=31',
		title: 'Browse',
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

function mountWindow( cfg: WindowConfig ): { win: Window; cleanup: () => void } {
	const parent = document.createElement( 'div' );
	document.body.appendChild( parent );
	const win = new Window( cfg );
	parent.appendChild( win.element );
	return {
		win,
		cleanup: () => {
			parent.remove();
		},
	};
}

function paintedTitle( win: Window ): string {
	return (
		win.element.querySelector< HTMLElement >( '.os-window__title' )
			?.textContent ?? ''
	);
}

describe( 'Window.setTitle', () => {
	let cleanup: () => void = () => {};

	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		cleanup();
		clearHooksStub();
	} );

	test( 'repaints the title bar, not the node the constructor captured', () => {
		const mounted = mountWindow( baseConfig() );
		cleanup = mounted.cleanup;

		mounted.win.setTitle( 'Revisions' );

		expect( paintedTitle( mounted.win ) ).toBe( 'Revisions' );
		expect( mounted.win.config.title ).toBe( 'Revisions' );
	} );

	test( 'the name survives a window-slot repaint', () => {

		const mounted = mountWindow( baseConfig() );
		cleanup = mounted.cleanup;

		mounted.win.setTitle( 'Revisions' );
		paintWindowSlots( mounted.win );

		expect( paintedTitle( mounted.win ) ).toBe( 'Revisions' );
	} );

	test( 'a title slot override that removed the span is not a crash', () => {

		const mounted = mountWindow(
			baseConfig( { appearance: { slots: { title: null } } } )
		);
		cleanup = mounted.cleanup;

		expect( () => mounted.win.setTitle( 'Revisions' ) ).not.toThrow();
		expect( mounted.win.config.title ).toBe( 'Revisions' );
	} );
} );
