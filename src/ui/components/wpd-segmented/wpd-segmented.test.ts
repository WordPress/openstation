import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './wpd-segmented';

const tick = (): Promise<void> => Promise.resolve();

describe( '<wpd-segmented> + <wpd-segment>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'clicking a segment bubbles wpd-pick + updates aria-checked', async () => {
		host.innerHTML = `
			<wpd-segmented value="default" label="Dock size">
				<wpd-segment value="compact">Compact</wpd-segment>
				<wpd-segment value="default">Default</wpd-segment>
				<wpd-segment value="large">Large</wpd-segment>
			</wpd-segmented>
		`;
		await tick();
		await tick();
		const group = host.querySelector( 'wpd-segmented' )!;
		const compact = host.querySelector( 'wpd-segment[value="compact"]' )!;
		expect( compact.getAttribute( 'aria-checked' ) ).toBe( 'false' );
		expect(
			host
				.querySelector( 'wpd-segment[value="default"]' )!
				.getAttribute( 'aria-checked' ),
		).toBe( 'true' );

		let heard: string | null = null;
		group.addEventListener( 'wpd-pick', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );
		compact.shadowRoot!.querySelector( 'button' )!.click();
		await tick();
		await tick();
		expect( heard ).toBe( 'compact' );
		expect( group.getAttribute( 'value' ) ).toBe( 'compact' );
		expect( compact.getAttribute( 'aria-checked' ) ).toBe( 'true' );
	} );

	test( '.items setter replaces children and mirrors aria-checked', async () => {
		host.innerHTML = `<wpd-segmented value="km" label="Unit"></wpd-segmented>`;
		await tick();

		const group = host.querySelector( 'wpd-segmented' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		};
		group.items = [
			{ value: 'm', label: 'm' },
			{ value: 'km', label: 'km' },
			{ value: 'mi', label: 'mi' },
		];
		await tick();
		await tick();

		const seg = host.querySelectorAll( 'wpd-segment' );
		expect( seg.length ).toBe( 3 );
		expect( seg[ 1 ].getAttribute( 'value' ) ).toBe( 'km' );
		expect( seg[ 1 ].getAttribute( 'aria-checked' ) ).toBe( 'true' );
		expect( group.getAttribute( 'value' ) ).toBe( 'km' );
	} );

	test( '.items setter falls back to first entry when current value is no longer in the list', async () => {
		host.innerHTML = `<wpd-segmented value="km"></wpd-segmented>`;
		await tick();

		const group = host.querySelector( 'wpd-segmented' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		};
		group.items = [
			{ value: 'a', label: 'A' },
			{ value: 'b', label: 'B' },
		];
		await tick();
		await tick();

		expect( group.getAttribute( 'value' ) ).toBe( 'a' );
	} );
} );
