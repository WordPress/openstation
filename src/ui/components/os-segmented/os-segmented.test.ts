import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-segmented';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-segmented> + <os-segment>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'clicking a segment bubbles os-pick + updates aria-checked', async () => {
		host.innerHTML = `
			<os-segmented value="default" label="Dock size">
				<os-segment value="compact">Compact</os-segment>
				<os-segment value="default">Default</os-segment>
				<os-segment value="large">Large</os-segment>
			</os-segmented>
		`;
		await tick();
		await tick();
		const group = host.querySelector( 'os-segmented' )!;
		const compact = host.querySelector( 'os-segment[value="compact"]' )!;
		expect( compact.getAttribute( 'aria-checked' ) ).toBe( 'false' );
		expect(
			host
				.querySelector( 'os-segment[value="default"]' )!
				.getAttribute( 'aria-checked' ),
		).toBe( 'true' );

		let heard: string | null = null;
		group.addEventListener( 'os-pick', ( e ) => {
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
		host.innerHTML = `<os-segmented value="km" label="Unit"></os-segmented>`;
		await tick();

		const group = host.querySelector( 'os-segmented' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		};
		group.items = [
			{ value: 'm', label: 'm' },
			{ value: 'km', label: 'km' },
			{ value: 'mi', label: 'mi' },
		];
		await tick();
		await tick();

		const seg = host.querySelectorAll( 'os-segment' );
		expect( seg.length ).toBe( 3 );
		expect( seg[ 1 ].getAttribute( 'value' ) ).toBe( 'km' );
		expect( seg[ 1 ].getAttribute( 'aria-checked' ) ).toBe( 'true' );
		expect( group.getAttribute( 'value' ) ).toBe( 'km' );
	} );

	test( '.items setter falls back to first entry when current value is no longer in the list', async () => {
		host.innerHTML = `<os-segmented value="km"></os-segmented>`;
		await tick();

		const group = host.querySelector( 'os-segmented' ) as HTMLElement & {
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
