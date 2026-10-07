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

	function layOut(
		group: Element,
		{
			scale = 1,
			hostWidth = 189,
			offsetWidth = 189,
		}: { scale?: number; hostWidth?: number; offsetWidth?: number } = {},
	): void {
		const rect = ( left: number, width: number ) => {
			const l = left * scale;
			const w = width * scale;
			return { left: l, width: w, right: l + w, top: 0, bottom: 24, height: 24, x: l, y: 0, toJSON: () => ( {} ) } as DOMRect;
		};
		group.getBoundingClientRect = () => rect( 100, hostWidth );
		Object.defineProperty( group, 'offsetWidth', {
			configurable: true,
			value: offsetWidth,
		} );
		const segs = Array.from( group.querySelectorAll( ':scope > os-segment' ) );
		segs.forEach( ( seg, i ) => {
			seg.getBoundingClientRect = () => rect( 103 + i * 62, 60 );
		} );
	}

	test( 'the thumb is measured onto the selected segment', async () => {
		host.innerHTML = `
			<os-segmented value="b">
				<os-segment value="a">A</os-segment>
				<os-segment value="b">B</os-segment>
				<os-segment value="c">C</os-segment>
			</os-segmented>
		`;
		await tick();
		const group = host.querySelector( 'os-segmented' ) as HTMLElement;
		layOut( group );

		group.setAttribute( 'value', 'b' );
		( group as HTMLElement & { value: string } ).value = 'b';
		await tick();
		await tick();

		expect( group.style.getPropertyValue( '--_thumb-x' ) ).toBe( '65px' );
		expect( group.style.getPropertyValue( '--_thumb-w' ) ).toBe( '60px' );
		expect( group.hasAttribute( 'data-thumb' ) ).toBe( true );
	} );

	test( 'the thumb travels when the selection changes', async () => {
		host.innerHTML = `
			<os-segmented value="a">
				<os-segment value="a">A</os-segment>
				<os-segment value="b">B</os-segment>
				<os-segment value="c">C</os-segment>
			</os-segmented>
		`;
		await tick();
		const group = host.querySelector( 'os-segmented' ) as HTMLElement;
		layOut( group );
		( group as HTMLElement & { value: string } ).value = 'a';
		await tick();
		await tick();
		expect( group.style.getPropertyValue( '--_thumb-x' ) ).toBe( '3px' );

		host
			.querySelector( 'os-segment[value="c"]' )!
			.shadowRoot!.querySelector( 'button' )!
			.click();
		await tick();
		await tick();

		expect( group.style.getPropertyValue( '--_thumb-x' ) ).toBe( '127px' );
	} );

	test( 'a fractional layout width does not drift the thumb off the segment', async () => {
		host.innerHTML = `
			<os-segmented value="c">
				<os-segment value="a">A</os-segment>
				<os-segment value="b">B</os-segment>
				<os-segment value="c">C</os-segment>
			</os-segmented>
		`;
		await tick();
		const group = host.querySelector( 'os-segmented' ) as HTMLElement;

		layOut( group, { hostWidth: 189.4, offsetWidth: 189 } );

		group.setAttribute( 'value', 'c' );
		( group as HTMLElement & { value: string } ).value = 'c';
		await tick();
		await tick();

		expect( group.style.getPropertyValue( '--_thumb-x' ) ).toBe( '127px' );
		expect( group.style.getPropertyValue( '--_thumb-w' ) ).toBe( '60px' );
	} );

	test( 'the thumb ignores an ancestor scale instead of shrinking with it', async () => {
		host.innerHTML = `
			<os-segmented value="b">
				<os-segment value="a">A</os-segment>
				<os-segment value="b">B</os-segment>
				<os-segment value="c">C</os-segment>
			</os-segmented>
		`;
		await tick();
		const group = host.querySelector( 'os-segmented' ) as HTMLElement;
		layOut( group, { scale: 0.92 } );

		group.setAttribute( 'value', 'b' );
		( group as HTMLElement & { value: string } ).value = 'b';
		await tick();
		await tick();

		expect( group.style.getPropertyValue( '--_thumb-x' ) ).toBe( '65px' );
		expect( group.style.getPropertyValue( '--_thumb-w' ) ).toBe( '60px' );
	} );

	test( 'a collapsed ancestor keeps the last placement instead of hiding the thumb', async () => {
		host.innerHTML = `
			<os-segmented value="b">
				<os-segment value="a">A</os-segment>
				<os-segment value="b">B</os-segment>
				<os-segment value="c">C</os-segment>
			</os-segmented>
		`;
		await tick();
		const group = host.querySelector( 'os-segmented' ) as HTMLElement;
		layOut( group );
		( group as HTMLElement & { value: string } ).value = 'b';
		await tick();
		await tick();
		expect( group.style.getPropertyValue( '--_thumb-x' ) ).toBe( '65px' );

		layOut( group, { scale: 0 } );
		group.setAttribute( 'value', 'b' );
		( group as HTMLElement & { value: string } ).value = 'b';
		await tick();
		await tick();

		expect( group.hasAttribute( 'data-thumb' ) ).toBe( true );
		expect( group.style.getPropertyValue( '--_thumb-x' ) ).toBe( '65px' );
		expect( group.style.getPropertyValue( '--_thumb-w' ) ).toBe( '60px' );
	} );

	test( 'an unmeasurable group hides the thumb rather than smearing it at the origin', async () => {
		host.innerHTML = `
			<os-segmented value="a">
				<os-segment value="a">A</os-segment>
			</os-segmented>
		`;
		await tick();
		await tick();

		const group = host.querySelector( 'os-segmented' )!;
		expect( group.hasAttribute( 'data-thumb' ) ).toBe( false );
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
