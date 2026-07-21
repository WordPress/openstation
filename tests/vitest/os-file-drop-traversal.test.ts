/**
 * Tests for the folder-tree traversal: synchronous entry snapshot,
 * the 100-entry readEntries batching loop, relative-path building,
 * and empty-directory capture.
 */
import { describe, expect, test } from 'vitest';
import {
	collectDroppedTree,
	snapshotEntries,
} from '../../src/os-file-drop/traversal';

function fileEntry( name: string ): FileSystemFileEntry {
	return {
		isFile: true,
		isDirectory: false,
		name,
		fullPath: `/${ name }`,
		file: ( ok: ( f: File ) => void ) => {
			ok( new File( [ 'x' ], name, { type: 'text/plain' } ) );
		},
	} as unknown as FileSystemFileEntry;
}

function dirEntry(
	name: string,
	children: FileSystemEntry[],
	batchSize = 100,
): FileSystemDirectoryEntry {
	return {
		isFile: false,
		isDirectory: true,
		name,
		fullPath: `/${ name }`,
		createReader: () => {
			let cursor = 0;
			return {
				readEntries: ( ok: ( batch: FileSystemEntry[] ) => void ) => {
					const batch = children.slice( cursor, cursor + batchSize );
					cursor += batch.length;
					ok( batch );
				},
			};
		},
	} as unknown as FileSystemDirectoryEntry;
}

describe( 'snapshotEntries', () => {
	test( 'collects entries from file items and skips non-file items', () => {
		const entry = fileEntry( 'a.txt' );
		const items = [
			{ kind: 'file', webkitGetAsEntry: () => entry },
			{ kind: 'string', webkitGetAsEntry: () => null },
			{ kind: 'file', webkitGetAsEntry: () => null },
		];
		const list = Object.assign( items, {
			length: items.length,
		} ) as unknown as DataTransferItemList;
		expect( snapshotEntries( list ) ).toEqual( [ entry ] );
	} );

	test( 'tolerates a missing item list', () => {
		expect( snapshotEntries( null ) ).toEqual( [] );
		expect( snapshotEntries( undefined ) ).toEqual( [] );
	} );
} );

describe( 'collectDroppedTree', () => {
	test( 'walks past the 100-entry readEntries batch limit', async () => {
		const children: FileSystemEntry[] = [];
		for ( let i = 0; i < 250; i++ ) {
			children.push( fileEntry( `f${ i }.txt` ) );
		}
		const tree = await collectDroppedTree( [ dirEntry( 'big', children ) ] );
		expect( tree.files.length ).toBe( 250 );
		expect( tree.hadDirectory ).toBe( true );
		expect( tree.files[ 0 ].relativePath ).toBe( 'big/f0.txt' );
		expect( tree.files[ 249 ].relativePath ).toBe( 'big/f249.txt' );
	} );

	test( 'builds nested relative paths and captures empty dirs', async () => {
		const tree = await collectDroppedTree( [
			dirEntry( 'docs', [
				fileEntry( 'readme.md' ),
				dirEntry( 'reports', [ fileEntry( 'q1.pdf' ) ] ),
				dirEntry( 'empty', [] ),
			] ),
		] );
		const paths = tree.files.map( ( f ) => f.relativePath ).sort();
		expect( paths ).toEqual( [ 'docs/readme.md', 'docs/reports/q1.pdf' ] );
		expect( tree.emptyDirs ).toEqual( [ 'docs/empty' ] );
	} );

	test( 'a flat dropped file has an empty relativePath', async () => {
		const tree = await collectDroppedTree( [ fileEntry( 'flat.txt' ) ] );
		expect( tree.files.length ).toBe( 1 );
		expect( tree.files[ 0 ].relativePath ).toBe( '' );
		expect( tree.hadDirectory ).toBe( false );
		expect( tree.emptyDirs ).toEqual( [] );
	} );

	test( 'unreadable files are skipped, batch survives', async () => {
		const broken = {
			isFile: true,
			isDirectory: false,
			name: 'gone.txt',
			fullPath: '/gone.txt',
			file: ( _ok: unknown, err: ( e: Error ) => void ) => {
				err( new Error( 'gone' ) );
			},
		} as unknown as FileSystemEntry;
		const tree = await collectDroppedTree( [
			dirEntry( 'd', [ broken, fileEntry( 'ok.txt' ) ] ),
		] );
		expect( tree.files.map( ( f ) => f.relativePath ) ).toEqual( [ 'd/ok.txt' ] );
	} );
} );
