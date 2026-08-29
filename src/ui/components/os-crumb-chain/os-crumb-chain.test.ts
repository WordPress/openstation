/**
 * `<os-crumb-chain>` — how a segment gets its paint.
 *
 * The one rule worth pinning: an inline custom property outranks the
 * palette AND every desktop theme, so the chain may only write one for
 * a segment that genuinely carries its own colour. A neutral default
 * written inline is unreachable by both, which is how a light-mode
 * `rgba( 0, 0, 0, 0.08 )` wash with `#1d2327` ink survived the brand
 * and painted the Posts window's Categories column at 1.2:1.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import './os-crumb-chain';
// eslint-disable-next-line no-duplicate-imports
import type { OsCrumbChain } from './os-crumb-chain';

const tick = (): Promise< void > =>
	new Promise( ( r ) => queueMicrotask( () => queueMicrotask( () => r() ) ) );

async function mount(
	segments: OsCrumbChain[ 'segments' ],
): Promise< HTMLElement > {
	document.body.innerHTML = '';
	const chain = document.createElement( 'os-crumb-chain' ) as OsCrumbChain;
	document.body.appendChild( chain );
	chain.segments = segments;
	await tick();
	return chain as unknown as HTMLElement;
}

const crumbs = ( chain: HTMLElement ): HTMLElement[] => [
	...( ( chain as unknown as { shadowRoot: ShadowRoot } ).shadowRoot.querySelectorAll(
		'.os-crumb',
	) as NodeListOf< HTMLElement > ),
];

describe( '<os-crumb-chain> segment paint', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'a segment with its own colour writes both tokens inline', async () => {
		const chain = await mount( [ { id: 1, name: 'Tech', color: '#4b3eff' } ] );
		const style = crumbs( chain )[ 0 ].getAttribute( 'style' ) ?? '';

		expect( style ).toContain( '--os-ui-crumb-bg: #4b3eff' );
		// The ink is derived from that background, not inherited.
		expect( style ).toContain( '--os-ui-crumb-fg:' );
	} );

	test( 'a segment with no colour writes no inline paint at all', async () => {
		const chain = await mount( [ { id: 1, name: 'Notes' } ] );
		const crumb = crumbs( chain )[ 0 ];

		// Not "an empty style attribute" — none, so nothing can outrank
		// the stylesheet's var() chain.
		expect( crumb.hasAttribute( 'style' ) ).toBe( false );
		expect( crumb.style.getPropertyValue( '--os-ui-crumb-bg' ) ).toBe( '' );
		expect( crumb.style.getPropertyValue( '--os-ui-crumb-fg' ) ).toBe( '' );
	} );

	test( 'the pre-brand literals never reach an uncoloured segment', async () => {
		const chain = await mount( [
			{ id: 1, name: 'Notes' },
			{ id: 2, name: 'Drafts' },
		] );

		for ( const crumb of crumbs( chain ) ) {
			const style = crumb.getAttribute( 'style' ) ?? '';
			expect( style ).not.toContain( '#1d2327' );
			expect( style ).not.toContain( 'rgba( 0, 0, 0, 0.08 )' );
		}
	} );

	test( 'a mixed chain only pins the segments that are coloured', async () => {
		const chain = await mount( [
			{ id: 1, name: 'Tech', color: '#4b3eff' },
			{ id: 2, name: 'Notes' },
		] );
		const [ coloured, neutral ] = crumbs( chain );

		expect( coloured.hasAttribute( 'style' ) ).toBe( true );
		expect( neutral.hasAttribute( 'style' ) ).toBe( false );
	} );
} );
