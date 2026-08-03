import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	_resetHeartbeatBusForTests,
	bootHeartbeatBus,
} from '../../src/heartbeat';
import {
	__resetStickyNotesHeartbeatForTests,
	startStickyNotesHeartbeat,
} from '../../src/sticky-notes/heartbeat';
import { StickyNotesLayer } from '../../src/sticky-notes/layer';
import {
	editorBody,
	noteComponentsForBody,
	noteFromGuideline,
	removeLegacyMetadataComment,
	titleField,
	titleForBody,
} from '../../src/sticky-notes/text';
import { buildGuidelineEditUrl, pickStickyTerms } from '../../src/sticky-notes/rest';
import type { StickyNote } from '../../src/sticky-notes/types';

interface HeartbeatHandlers {
	'heartbeat-send'?: ( e: unknown, data: Record< string, unknown > ) => void;
	'heartbeat-tick'?: ( e: unknown, response: Record< string, unknown > ) => void;
}

afterEach( () => {
	_resetHeartbeatBusForTests();
	__resetStickyNotesHeartbeatForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	window.localStorage.removeItem( 'desktop-mode-sticky-notes-geometry' );
	delete ( window as unknown as { jQuery?: unknown } ).jQuery;
} );

describe( 'sticky notes text helpers', () => {
	test( 'titleField prefers raw text and strips rendered HTML fallback', () => {
		expect(
			titleField( { raw: '', rendered: '<strong>Rendered title</strong>' } ),
		).toBe( 'Rendered title' );
		expect( titleField( { raw: 'Raw title', rendered: 'Rendered' } ) ).toBe(
			'Raw title',
		);
	} );

	test( 'editorBody does not duplicate a title already present in content', () => {
		expect( editorBody( 'Plan', 'Plan\nDo the thing' ) ).toBe(
			'Plan\nDo the thing',
		);
		expect( editorBody( 'Plan', 'Do the thing' ) ).toBe(
			'Plan\nDo the thing',
		);
	} );

	test( 'noteComponentsForBody stores first line as title and rest as content', () => {
		expect( noteComponentsForBody( 'Title\nBody line', 'Fallback' ) ).toEqual( {
			title: 'Title',
			content: 'Body line',
			excerpt: 'Body line',
		} );
		expect( noteComponentsForBody( 'Only title', 'Fallback' ) ).toMatchObject( {
			title: 'Only title',
			content: '',
		} );
	} );

	test( 'removeLegacyMetadataComment strips Whispress legacy metadata', () => {
		expect(
			removeLegacyMetadataComment(
				'<!-- wpworkspace-sticky:{"x":1} -->\nActual body',
			),
		).toBe( 'Actual body' );
	} );

	test( 'noteFromGuideline builds the editable note body', () => {
		const note = noteFromGuideline( {
			id: 9,
			title: { raw: 'Sticky A' },
			content: { raw: 'Remember this' },
			open_station_modified_ms: 1234,
			wp_guideline_type: [ 3, 5 ],
		} );
		expect( note.guidelineId ).toBe( 9 );
		expect( note.title ).toBe( 'Sticky A' );
		expect( note.body ).toBe( 'Sticky A\nRemember this' );
		expect( note.modifiedMs ).toBe( 1234 );
		expect( note.termIds ).toEqual( [ 3, 5 ] );
	} );

	test( 'titleForBody falls back for empty notes', () => {
		expect( titleForBody( '\n\t' ) ).toBe( 'Sticky Note' );
	} );
} );

describe( 'sticky notes heartbeat', () => {
	test( 'contributes sticky subscription and applies heartbeat payloads', () => {
		const handlers: HeartbeatHandlers = {};
		( window as unknown as { jQuery: unknown } ).jQuery = () => ( {
			on: (
				event: keyof HeartbeatHandlers,
				handler: ( e: unknown, data: Record< string, unknown > ) => void,
			) => {
				handlers[ event ] = handler;
			},
		} );
		bootHeartbeatBus();

		const applyHeartbeatPayload = vi.fn();
		startStickyNotesHeartbeat( {
			getHeartbeatSubscription: () => ( {
				stickyTermId: 5,
				knownIds: [ 10, 12 ],
				version: 1700,
			} ),
			applyHeartbeatPayload,
		} );

		const data: Record< string, unknown > = {};
		handlers[ 'heartbeat-send' ]?.( {}, data );
		expect( data.open_station_sticky_notes_subscribe ).toEqual( {
			stickyTermId: 5,
			knownIds: [ 10, 12 ],
			version: 1700,
		} );

		const payload = {
			notes: [ { id: 14, title: { raw: 'Remote' } } ],
			removed: [ 10 ],
			serverTimeMs: 1800,
		};
		handlers[ 'heartbeat-tick' ]?.( {}, {
			open_station_sticky_notes: payload,
		} );
		expect( applyHeartbeatPayload ).toHaveBeenCalledWith( payload );
	} );
} );

describe( 'sticky notes layer', () => {
	test( 'uses compact default geometry for desktop notes', () => {
		const host = createSizedHost();
		const layer = new StickyNotesLayer( {
			host,
			config: { adminUrl: 'https://example.test/wp-admin/' },
			openArtifact: vi.fn(),
		} );

		expect( layer.defaultGeometry( 0 ) ).toMatchObject( {
			width: 264,
			height: 176,
		} );

		host.remove();
	} );

	test( 'brings the selected sticky note to the top of the sticky layer', () => {
		const host = createSizedHost();

		const layer = new StickyNotesLayer( {
			host,
			config: { adminUrl: 'https://example.test/wp-admin/' },
			openArtifact: vi.fn(),
		} );
		const upsert = (
			layer as unknown as {
				upsert: ( note: StickyNote, index: number ) => { element: HTMLElement };
			}
		).upsert.bind( layer );

		const older = upsert( stickyNote( 1, 1000 ), 0 );
		const newer = upsert( stickyNote( 2, 2000 ), 1 );

		expect( Number( newer.element.style.zIndex ) ).toBeGreaterThan(
			Number( older.element.style.zIndex ),
		);

		older.element.dispatchEvent(
			new MouseEvent( 'pointerdown', { bubbles: true } ),
		);

		expect( Number( older.element.style.zIndex ) ).toBeGreaterThan(
			Number( newer.element.style.zIndex ),
		);

		host.remove();
	} );

	test( 'assigns new sticky notes to the active desktop', () => {
		let activeDesktopId = 'desktop-1';
		const host = createSizedHost();
		const layer = new StickyNotesLayer( {
			host,
			config: { adminUrl: 'https://example.test/wp-admin/' },
			getActiveDesktopId: () => activeDesktopId,
			openArtifact: vi.fn(),
		} );
		const privateLayer = layer as unknown as {
			upsert: ( note: StickyNote, index: number ) => { element: HTMLElement };
			refreshDesktopVisibility: () => void;
		};

		const note = privateLayer.upsert( stickyNote( 3, 3000 ), 0 );
		expect( note.element.style.display ).toBe( '' );
		expect(
			JSON.parse(
				window.localStorage.getItem( 'desktop-mode-sticky-notes-geometry' ) ??
					'{}',
			)[ 'guideline:3' ].desktopId,
		).toBe( 'desktop-1' );

		activeDesktopId = 'desktop-2';
		privateLayer.refreshDesktopVisibility();
		expect( note.element.style.display ).toBe( 'none' );

		activeDesktopId = 'desktop-1';
		privateLayer.refreshDesktopVisibility();
		expect( note.element.style.display ).toBe( '' );

		host.remove();
	} );

	test( 'migrates sticky assignments when a desktop is closed', () => {
		let activeDesktopId = 'desktop-2';
		window.localStorage.setItem(
			'desktop-mode-sticky-notes-geometry',
			JSON.stringify( {
				'guideline:4': {
					x: 0.1,
					y: 0.1,
					width: 264,
					height: 176,
					desktopId: 'desktop-2',
				},
			} ),
		);
		const host = createSizedHost();
		const layer = new StickyNotesLayer( {
			host,
			config: { adminUrl: 'https://example.test/wp-admin/' },
			getActiveDesktopId: () => activeDesktopId,
			openArtifact: vi.fn(),
		} );
		const privateLayer = layer as unknown as {
			upsert: ( note: StickyNote, index: number ) => { element: HTMLElement };
			migrateDesktopAssignments: ( desktopId: string, migratedTo: string ) => void;
			refreshDesktopVisibility: () => void;
		};
		const note = privateLayer.upsert( stickyNote( 4, 4000 ), 0 );
		expect( note.element.style.display ).toBe( '' );

		activeDesktopId = 'desktop-1';
		privateLayer.migrateDesktopAssignments( 'desktop-2', 'desktop-1' );
		privateLayer.refreshDesktopVisibility();

		expect( note.element.style.display ).toBe( '' );
		expect(
			JSON.parse(
				window.localStorage.getItem( 'desktop-mode-sticky-notes-geometry' ) ??
					'{}',
			)[ 'guideline:4' ].desktopId,
		).toBe( 'desktop-1' );

		host.remove();
	} );

	test( 'preserves a stored desktop id that is not registered yet during boot', () => {
		window.localStorage.setItem(
			'desktop-mode-sticky-notes-geometry',
			JSON.stringify( {
				'guideline:5': {
					x: 0.1,
					y: 0.1,
					width: 264,
					height: 176,
					desktopId: 'desktop-2',
				},
			} ),
		);
		const host = createSizedHost();
		const layer = new StickyNotesLayer( {
			host,
			config: { adminUrl: 'https://example.test/wp-admin/' },
			getActiveDesktopId: () => 'desktop-1',
			openArtifact: vi.fn(),
		} );
		const privateLayer = layer as unknown as {
			upsert: ( note: StickyNote, index: number ) => { element: HTMLElement };
		};

		const note = privateLayer.upsert( stickyNote( 5, 5000 ), 0 );

		expect( note.element.style.display ).toBe( 'none' );
		expect(
			JSON.parse(
				window.localStorage.getItem( 'desktop-mode-sticky-notes-geometry' ) ??
					'{}',
			)[ 'guideline:5' ].desktopId,
		).toBe( 'desktop-2' );

		host.remove();
	} );

	test( 'does not touch the network when the Guidelines surface is unavailable', async () => {
		const host = createSizedHost();
		const fetchMock = vi.fn();
		vi.stubGlobal( 'fetch', fetchMock );

		const layer = new StickyNotesLayer( {
			host,
			config: { adminUrl: 'https://example.test/wp-admin/' },
			available: false,
			openArtifact: vi.fn(),
		} );
		await layer.boot();

		expect( fetchMock ).not.toHaveBeenCalled();

		host.remove();
	} );

	test( 'still attempts term resolution when availability is unspecified', async () => {
		const host = createSizedHost();
		const fetchMock = vi.fn().mockRejectedValue( new Error( 'offline' ) );
		vi.stubGlobal( 'fetch', fetchMock );
		// boot() swallows the rejection via console.debug — keep it quiet.
		vi.spyOn( console, 'debug' ).mockImplementation( () => undefined );

		const layer = new StickyNotesLayer( {
			host,
			config: { adminUrl: 'https://example.test/wp-admin/' },
			openArtifact: vi.fn(),
		} );
		await layer.boot();

		expect( fetchMock ).toHaveBeenCalled();

		host.remove();
	} );

	test( 'keeps editor keystrokes from reaching global shortcut listeners', () => {
		const host = createSizedHost();
		const layer = new StickyNotesLayer( {
			host,
			config: { adminUrl: 'https://example.test/wp-admin/' },
			openArtifact: vi.fn(),
		} );
		const privateLayer = layer as unknown as {
			upsert: ( note: StickyNote, index: number ) => { element: HTMLElement };
		};
		const note = privateLayer.upsert( stickyNote( 6, 6000 ), 0 );
		const onDocumentKey = vi.fn();
		document.addEventListener( 'keydown', onDocumentKey );

		note.element
			.querySelector( 'os-textarea' )!
			.dispatchEvent(
				new KeyboardEvent( 'keydown', {
					key: 'n',
					bubbles: true,
					composed: true,
				} ),
			);

		expect( onDocumentKey ).not.toHaveBeenCalled();

		document.removeEventListener( 'keydown', onDocumentKey );
		host.remove();
	} );
} );

describe( 'sticky notes REST helpers', () => {
	test( 'pickStickyTerms prefers sticky under artifact/artifacts parent', () => {
		expect(
			pickStickyTerms(
				[ { id: 10, slug: 'artifacts' } ],
				[ { id: 11, slug: 'note', parent: 10 } ],
				[
					{ id: 99, slug: 'sticky', parent: 1 },
					{ id: 12, slug: 'sticky', parent: 10 },
				],
			),
		).toEqual( {
			stickyTermId: 12,
			termIds: [ 10, 11, 12 ],
		} );
	} );

	test( 'buildGuidelineEditUrl points at the CPT edit screen', () => {
		expect( buildGuidelineEditUrl( 'https://example.test/wp-admin/', 42 ) )
			.toBe( 'https://example.test/wp-admin/post.php?post=42&action=edit' );
	} );
} );

function stickyNote( id: number, modifiedMs: number ): StickyNote {
	return {
		localId: `guideline:${ id }`,
		guidelineId: id,
		title: `Sticky ${ id }`,
		body: `Sticky ${ id }`,
		modifiedMs,
		termIds: [ 5 ],
	};
}

function createSizedHost(): HTMLElement {
	const host = document.createElement( 'div' );
	Object.defineProperty( host, 'clientWidth', {
		value: 1200,
		configurable: true,
	} );
	Object.defineProperty( host, 'clientHeight', {
		value: 800,
		configurable: true,
	} );
	document.body.appendChild( host );
	return host;
}
