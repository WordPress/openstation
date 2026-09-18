import { afterEach, expect, test } from 'vitest';
import './os-app-frame';

afterEach( () => {
	document.body.replaceChildren();
} );

test( 'slots preserve light-DOM controls across frame mode changes', async () => {
	const frame = document.createElement( 'os-app-frame' );
	frame.innerHTML = '<button slot="toolbar">Save</button><input value="draft"><span slot="footer">Ready</span>';
	document.body.appendChild( frame );
	await Promise.resolve();
	const input = frame.querySelector( 'input' )!;
	input.value = 'Unsaved draft';
	const slots = Array.from( frame.shadowRoot!.querySelectorAll( 'slot' ) );
	expect( slots.map( ( slot ) => slot.name ) ).toEqual( [ 'header', 'toolbar', '', 'footer' ] );
	expect( slots[ 2 ].assignedElements() ).toEqual( [ input ] );
	frame.setAttribute( 'contained', '' );
	await Promise.resolve();
	expect( frame.querySelector( 'input' ) ).toBe( input );
	expect( input.value ).toBe( 'Unsaved draft' );
} );
