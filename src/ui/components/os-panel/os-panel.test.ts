import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-panel';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-panel>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'custom padding + gap flow through to the host', async () => {
		host.innerHTML = `<os-panel padding="24" gap="6"></os-panel>`;
		await tick();
		const panel = host.querySelector< HTMLElement >( 'os-panel' )!;
		expect( panel.style.getPropertyValue( '--os-ui-panel-padding' ) ).toBe( '24px' );
		expect( panel.style.getPropertyValue( '--os-ui-panel-gap' ) ).toBe( '6px' );
	} );

	test( 'without attributes, host has no inline properties (CSS defaults win)', async () => {
		host.innerHTML = `<os-panel></os-panel>`;
		await tick();
		const panel = host.querySelector< HTMLElement >( 'os-panel' )!;
		expect( panel.style.getPropertyValue( '--os-ui-panel-padding' ) ).toBe( '' );
		expect( panel.style.getPropertyValue( '--os-ui-panel-gap' ) ).toBe( '' );
	} );
} );
