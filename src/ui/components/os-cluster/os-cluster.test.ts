import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-cluster';

const tick = (): Promise< void > => Promise.resolve();

describe( '<os-cluster>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'writes gap, justify, align as custom properties', async () => {
		host.innerHTML = `
			<os-cluster gap="16" justify="end" align="start">
				<span>a</span><span>b</span>
			</os-cluster>
		`;
		await tick();
		const cluster = host.querySelector< HTMLElement >( 'os-cluster' )!;
		expect( cluster.style.getPropertyValue( '--os-ui-cluster-gap' ) ).toBe( '16px' );
		expect( cluster.style.getPropertyValue( '--os-ui-cluster-justify' ) ).toBe( 'end' );
		expect( cluster.style.getPropertyValue( '--os-ui-cluster-align' ) ).toBe( 'start' );
	} );
} );
