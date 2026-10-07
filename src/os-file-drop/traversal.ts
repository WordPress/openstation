export interface TreeFile {
	file: File;

	relativePath: string;
}

export interface TreeCollection {
	files: TreeFile[];

	emptyDirs: string[];

	hadDirectory: boolean;
}

const MAX_DEPTH = 32;

export function snapshotEntries( items: DataTransferItemList | undefined | null ): FileSystemEntry[] {
	if ( ! items ) {
		return [];
	}
	const out: FileSystemEntry[] = [];
	for ( let i = 0; i < items.length; i++ ) {
		const item = items[ i ];
		if ( item.kind !== 'file' ) {
			continue;
		}
		const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
		if ( entry ) {
			out.push( entry );
		}
	}
	return out;
}

function readAllEntries( dir: FileSystemDirectoryEntry ): Promise< FileSystemEntry[] > {
	const reader = dir.createReader();
	return new Promise( ( resolve, reject ) => {
		const out: FileSystemEntry[] = [];
		const step = (): void => {
			reader.readEntries( ( batch ) => {
				if ( batch.length === 0 ) {
					resolve( out );
					return;
				}
				out.push( ...batch );
				step();
			}, reject );
		};
		step();
	} );
}

function entryFile( entry: FileSystemFileEntry ): Promise< File > {
	return new Promise( ( resolve, reject ) => {
		entry.file( resolve, reject );
	} );
}

export async function collectDroppedTree(
	entries: FileSystemEntry[],
): Promise< TreeCollection > {
	const collection: TreeCollection = {
		files: [],
		emptyDirs: [],
		hadDirectory: false,
	};
	for ( const entry of entries ) {
		await collectEntry( entry, '', collection, 0 );
	}
	return collection;
}

async function collectEntry(
	entry: FileSystemEntry,
	prefix: string,
	collection: TreeCollection,
	depth: number,
): Promise< void > {
	if ( depth > MAX_DEPTH ) {
		return;
	}
	if ( entry.isFile ) {
		try {
			const file = await entryFile( entry as FileSystemFileEntry );
			collection.files.push( {
				file,

				relativePath: prefix ? `${ prefix }${ file.name }` : '',
			} );
		} catch {

		}
		return;
	}
	if ( ! entry.isDirectory ) {
		return;
	}
	collection.hadDirectory = true;
	const dirPath = `${ prefix }${ entry.name }`;
	let children: FileSystemEntry[] = [];
	try {
		children = await readAllEntries( entry as FileSystemDirectoryEntry );
	} catch {
		children = [];
	}
	if ( children.length === 0 ) {
		collection.emptyDirs.push( dirPath );
		return;
	}
	for ( const child of children ) {
		await collectEntry( child, `${ dirPath }/`, collection, depth + 1 );
	}
}
