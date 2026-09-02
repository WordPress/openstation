import { beforeEach, describe, expect, test } from 'vitest';
import { render } from '../../src/ui/core';
import {
	normalizeAboutFeed,
	renderAbout,
	type AboutFeed,
} from '../../apps/os-settings/parts/about';

const feed: AboutFeed = {
	title: 'OpenStation',
	description: 'The build diary.',
	homeUrl: 'https://openstation.blog/',
	feedUrl: 'https://openstation.blog/feed/',
	stale: false,
	items: [
		{
			title: '<img src=x onerror=alert(1)> The newest dispatch',
			url: 'https://openstation.blog/newest/',
			author: 'OpenStation Crew',
			publishedAt: '2026-08-19T12:00:00+00:00',
			excerpt: 'A look behind the latest build.',
		},
		{
			title: 'A second dispatch',
			url: 'https://openstation.blog/second/',
			author: '',
			publishedAt: '',
			excerpt: '',
		},
	],
};

const config = { pluginUrl: 'https://example.test/plugin', pluginVersion: '1.2.3' };

describe( 'OS Settings — About journal', () => {
	let wrapper: HTMLElement;

	beforeEach( () => {
		wrapper = document.createElement( 'div' );
		document.body.replaceChildren( wrapper );
	} );

	test( 'validates links, required fields, and the five-post ceiling', () => {
		const normalized = normalizeAboutFeed( {
			title: 'Journal',
			homeUrl: 'javascript:alert(1)',
			feedUrl: 'https://openstation.blog/feed/',
			items: [
				{ title: 'Missing URL' },
				{ title: 'Bad scheme', url: 'javascript:alert(1)' },
				...Array.from( { length: 7 }, ( _, index ) => ( {
					title: `Post ${ index }`,
					url: `https://openstation.blog/post-${ index }/`,
				} ) ),
			],
		} );
		expect( normalized ).not.toBeNull();
		expect( normalized!.homeUrl ).toBe( 'https://openstation.blog/' );
		expect( normalized!.items ).toHaveLength( 5 );
		expect( normalized!.items[ 0 ].title ).toBe( 'Post 0' );
	} );

	test( 'renders the newest post as the feature and keeps remote text inert', () => {
		render( renderAbout( config, { kind: 'ready', feed } ), wrapper );
		const featured = wrapper.querySelector( '.os-settings__about-featured h3' );
		expect( featured?.textContent ).toBe( '<img src=x onerror=alert(1)> The newest dispatch' );
		expect( wrapper.querySelector( 'img[src="x"]' ) ).toBeNull();
		expect( wrapper.querySelectorAll( '.os-settings__about-card' ) ).toHaveLength( 1 );
		expect( wrapper.textContent ).toContain( 'OpenStation 1.2.3' );
	} );

	test( 'paints the loading and error states', () => {
		render( renderAbout( config, { kind: 'loading' } ), wrapper );
		expect( wrapper.querySelector( '.os-settings__about-spinner' ) ).not.toBeNull();
		render( renderAbout( config, { kind: 'error' } ), wrapper );
		expect( wrapper.querySelector( '[role="alert"]' ) ).not.toBeNull();
		expect( wrapper.textContent ).toContain( 'openstation.blog' );
	} );

	test( 'says when the copy is stale', () => {
		render( renderAbout( config, { kind: 'ready', feed: { ...feed, stale: true } } ), wrapper );
		expect( wrapper.querySelector( '.os-settings__about-stale' ) ).not.toBeNull();
	} );
} );
