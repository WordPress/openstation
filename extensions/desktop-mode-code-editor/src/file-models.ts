/**
 * Code Editor — Monaco model cache + language detection.
 *
 * Each file the user opens gets one Monaco model, keyed by relative
 * path. Re-opening the same file from the tree re-uses the model
 * (preserves edits + scroll position + selection — Phase 2 is
 * read-only so edits are moot, but Phase 2.5+ relies on this cache).
 *
 * Path → language detection is intentionally extension-driven only.
 * Shebang sniffing or content-detection would slow tree clicks for
 * almost no win in WordPress-plugin/theme work.
 *
 * @public
 * @since 0.18.0
 */

import type * as Monaco from 'monaco-editor';

/**
 * Map a file path to the Monaco language id Monaco's tokenizer +
 * language services key off. Unknown extensions resolve to
 * `'plaintext'` so the editor still opens them — Phase 2 lists every
 * file with `allowed: true` in the tree, so an unknown extension
 * here means the allowlist was extended without a language map
 * update; better to show plaintext than refuse to open.
 */
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
			// Monaco's bundled TS worker handles JSX when compiler
			// options enable it (see monaco-bootstrap.ts).
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

/**
 * Per-relative-path Monaco model cache. Public methods are scoped
 * to a single shell instance — caller provides the cache; we don't
 * keep module-level state so tests can mount multiple shells.
 */
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
		// Use a stable in-memory URI scheme that Monaco's TS worker
		// recognises as JSX/TSX when the path's extension matches.
		// `file://workspace/<path>` keeps the extension in the URI,
		// which is what TypeScript looks at to enable JSX parsing.
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
				// File re-opened from the tree. Refresh content if
				// the disk version drifted (mtime check is the
				// caller's job — we just sync the buffer).
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
