import type * as Monaco from 'monaco-editor';

export function languageFor( path: string ): string {
	const lower = path.toLowerCase();
	const dot = lower.lastIndexOf( '.' );
	const ext = dot >= 0 ? lower.slice( dot + 1 ) : '';

	switch ( ext ) {
		case 'php':
			return 'php';
		case 'js':
		case 'mjs':
		case 'cjs':
			return 'javascript';
		case 'jsx':

			return 'javascript';
		case 'ts':
			return 'typescript';
		case 'tsx':
			return 'typescript';
		case 'css':
			return 'css';
		case 'scss':
			return 'scss';
		case 'sass':
			return 'scss';
		case 'less':
			return 'less';
		case 'html':
		case 'htm':
			return 'html';
		case 'json':
			return 'json';
		case 'md':
		case 'mdx':
			return 'markdown';
		case 'xml':
		case 'svg':
			return 'xml';
		case 'yml':
		case 'yaml':
			return 'yaml';
		default:
			return 'plaintext';
	}
}

export interface ModelCache {
	get( path: string ): Monaco.editor.ITextModel | null;
	open(
		monaco: typeof Monaco,
		path: string,
		content: string,
	): Monaco.editor.ITextModel;
	disposeAll(): void;
}

export function createModelCache(): ModelCache {
	const cache = new Map< string, Monaco.editor.ITextModel >();

	const monacoUriFor = (
		monaco: typeof Monaco,
		path: string,
	): Monaco.Uri => {

		return monaco.Uri.parse( `file:///workspace/${ path }` );
	};

	return {
		get( path ) {
			const cached = cache.get( path );
			if ( cached && ! cached.isDisposed() ) {
				return cached;
			}
			cache.delete( path );
			return null;
		},

		open( monaco, path, content ) {
			const cached = cache.get( path );
			if ( cached && ! cached.isDisposed() ) {

				if ( cached.getValue() !== content ) {
					cached.setValue( content );
				}
				return cached;
			}

			const uri = monacoUriFor( monaco, path );
			const existing = monaco.editor.getModel( uri );
			if ( existing ) {
				cache.set( path, existing );
				return existing;
			}

			const model = monaco.editor.createModel(
				content,
				languageFor( path ),
				uri,
			);
			cache.set( path, model );
			return model;
		},

		disposeAll() {
			for ( const model of cache.values() ) {
				if ( ! model.isDisposed() ) {
					model.dispose();
				}
			}
			cache.clear();
		},
	};
}
