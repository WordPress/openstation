import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WidgetContext } from '../../src/widgets/types';

import '../../src/plugins/recent-comments-widget/index';

type MountFn = (
	container: HTMLElement,
	ctx: WidgetContext,
) => Promise< () => void >;

const WIDGET_ID = 'desktop-mode/recent-comments';

function getMount(): MountFn {
	const widgets = (
		window as unknown as {
			openStationWidgets?: Record< string, MountFn >;
		}
	).openStationWidgets;
	const mount = widgets?.[ WIDGET_ID ];
	if ( ! mount ) {
		throw new Error( 'recent comments widget did not register its mount' );
	}
	return mount;
}

function makeContext(): WidgetContext {
	return {
		id: WIDGET_ID,
		pluginUrl: 'https://example.test/plugin',
	} as unknown as WidgetContext;
}

describe( 'recent comments widget', () => {
	let container: HTMLElement;
	let teardown: ( () => void ) | null = null;

	beforeEach( () => {
		container = document.createElement( 'div' );
		document.body.appendChild( container );

		const fetch = vi.fn( async () => ( {
			ok: true,
			status: 200,
			json: () => Promise.resolve( [
				{
					id: 1,
					status: 'approved',
					author_name: '&#81;&amp;A Guest',
					date_gmt: '2026-08-05T12:00:00',
					post: 42,
				},
			] ),
		} ) as Response );
		( window as unknown as { wp: unknown } ).wp = { os: { fetch } };
	} );

	afterEach( () => {
		teardown?.();
		teardown = null;
		container.remove();
		delete ( window as unknown as { wp?: unknown } ).wp;
		vi.restoreAllMocks();
	} );

	test( 'decodes commenter names before rendering text and initials', async () => {
		teardown = await getMount()( container, makeContext() );

		expect(
			container.querySelector( '.dm-comments__author' )?.textContent,
		).toBe( 'Q&A Guest' );
		expect(
			container.querySelector( '.dm-comments__avatar' )?.textContent,
		).toBe( 'Q' );
	} );
} );
