/**
 * "New note" wallpaper context-menu entry: it appears in the menu,
 * pins a note where the user right-clicked, and never doubles up.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildMenuItems } from '../../src/desktop-files/wallpaper-menu';
import { NotesLayer } from '../../src/notes/layer';
import { installNotesWallpaperMenu } from '../../src/notes/wallpaper-menu';
import { __resetNotesRestForTests, installNotesRestDeps } from '../../src/notes/rest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const stubDeps = ( position?: { x: number; y: number } ) => ( {
	createFolder: vi.fn(),
	createUrl: vi.fn(),
	toggleShowDesktop: vi.fn(),
	openOsSettings: vi.fn(),
	sortIcons: vi.fn(),
	position,
	labels: {
		createFolder: 'New folder',
		showDesktop: 'Show desktop',
		osSettings: 'OS Settings',
		sortHeading: 'Sort by',
		sortNameAsc: 'Name (A → Z)',
		sortNameDesc: 'Name (Z → A)',
		sortDateAsc: 'Date (oldest first)',
		sortDateDesc: 'Date (newest first)',
		newUrl: 'New URL',
	},
} );

function makeLayer(): NotesLayer {
	const host = document.createElement( 'div' );
	Object.defineProperty( host, 'clientWidth', { value: 1000 } );
	Object.defineProperty( host, 'clientHeight', { value: 500 } );
	host.getBoundingClientRect = () =>
		( {
			left: 0,
			top: 0,
			width: 1000,
			height: 500,
			right: 1000,
			bottom: 500,
			x: 0,
			y: 0,
			toJSON: () => ( {} ),
		} ) as DOMRect;
	document.body.appendChild( host );
	return new NotesLayer( {
		host,
		pluginUrl: 'https://example.test/plugin',
	} );
}

describe( 'notes wallpaper menu', () => {
	let fetchSpy: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		installHooksStub();
		__resetNotesRestForTests();
		installNotesRestDeps( { baseUrl: 'https://example.test/notes', nonce: 'n' } );
		fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( {
					id: 9,
					text: '',
					color: 'butter',
					x: 0.3,
					y: 0.5,
					z: 1,
					public: false,
					seed: 1,
					ownerId: 1,
					ownerName: 'Me',
					ownerAvatar: '',
					canEdit: true,
					updatedAtMs: 1,
				} ),
				{ status: 200 },
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		clearHooksStub();
		vi.unstubAllGlobals();
	} );

	test( 'adds a New note entry to the wallpaper menu', () => {
		installNotesWallpaperMenu( makeLayer() );
		const items = buildMenuItems( stubDeps() );
		const item = items.find( ( i ) => i.id === 'new-note' );
		expect( item ).toBeDefined();
		expect( item?.label ).toBe( 'New note' );
	} );

	test( 'the entry is added once even across repeated menu builds', () => {
		installNotesWallpaperMenu( makeLayer() );
		buildMenuItems( stubDeps() );
		const items = buildMenuItems( stubDeps() );
		expect( items.filter( ( i ) => i.id === 'new-note' ) ).toHaveLength( 1 );
	} );

	test( 'clicking it pins an empty note at the click position', async () => {
		const layer = makeLayer();
		installNotesWallpaperMenu( layer );
		const items = buildMenuItems( stubDeps( { x: 300, y: 250 } ) );
		await items.find( ( i ) => i.id === 'new-note' )?.onClick(
			new MouseEvent( 'click' ),
		);

		const note = document.querySelector( '.os-pinned-note' );
		expect( note ).not.toBeNull();
		// 300/1000 and 250/500 of the host, per the stubbed geometry.
		expect( ( note as HTMLElement ).style.left ).toBe( '30%' );
		expect( ( note as HTMLElement ).style.top ).toBe( '50%' );

		await new Promise( ( r ) => setTimeout( r, 10 ) );
		const post = fetchSpy.mock.calls.find(
			( call ) => ( call[ 1 ] as RequestInit | undefined )?.method === 'POST',
		);
		const body = JSON.parse( String( ( post?.[ 1 ] as RequestInit ).body ) );
		expect( body.text ).toBe( '' );
	} );
} );
