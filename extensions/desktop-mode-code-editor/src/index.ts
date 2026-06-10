/**
 * Code Editor — Phase 3 / 2.5 entry.
 *
 * Three-zone layout:
 *
 *   ┌────────────┬──────────────────────────────────────┐
 *   │            │  tab strip                           │
 *   │   tree     ├──────────────────────────────────────┤
 *   │            │  Monaco                              │
 *   │            ├──────────────────────────────────────┤
 *   │            │  status bar                          │
 *   └────────────┴──────────────────────────────────────┘
 *
 * Click a file in the tree → opens (or focuses) a tab on the right.
 * Each tab owns its Monaco model + per-file save state. Cmd/Ctrl+S
 * writes the active tab's buffer through `/code/file`. Closing a
 * dirty tab confirms; closing the last tab returns to the
 * placeholder.
 *
 * @public
 * @since 0.7.0
 */

import { showConflictDialog } from './conflict-dialog';
import { createModelCache, languageFor } from './file-models';
import { installEditorGlobalListeners } from './global-listeners';
import { loadMonaco } from './monaco-bootstrap';
import { setPhpProviderHost } from './providers/php';
import {
	fetchFile,
	RestError,
	saveFile,
	type ConflictData,
} from './rest';
import {
	mountTabsStrip,
	tabMetaForPath,
	type TabsStripHandle,
} from './tabs';
import { currentColorScheme, monacoThemeForScheme } from './theme';
import { mountFileTree, type FileTreeHandle } from './tree';

import type * as Monaco from 'monaco-editor';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

/** Mount selectors — kept in lockstep with `desktop_mode_code_editor_render_template()`. */
export const ROOT_SELECTOR = '[data-wpdc-editor-root]';
export const MONACO_MOUNT_SELECTOR = '[data-wpdc-editor-monaco]';
export const LOADING_CLASS = 'wpdc-editor--loading';
export const ERROR_CLASS = 'wpdc-editor--error';

/** Per-open-file save state. Keyed by relative path. */
interface OpenFile {
	path: string;
	mtime: number;
	size: number;
	/** Hash of the saved-on-disk content; used to derive the dirty flag. */
	savedVersionId: number;
}

/** Build the layout: tree on the left, (tabs / Monaco / status) on the right. */
function buildShell( root: HTMLElement, monacoSlot: HTMLElement ): {
	treeMount: HTMLElement;
	tabsMount: HTMLElement;
	editorMount: HTMLElement;
	statusBar: HTMLElement;
	statusLeft: HTMLElement;
	statusRight: HTMLElement;
} {
	root.classList.add( 'wpdc-editor--phase3' );

	const split = document.createElement( 'div' );
	split.className = 'wpdc-editor__split';

	const treeMount = document.createElement( 'div' );
	treeMount.className = 'wpdc-editor__tree';

	const right = document.createElement( 'div' );
	right.className = 'wpdc-editor__right';

	const tabsMount = document.createElement( 'div' );
	tabsMount.className = 'wpdc-editor__tabs-host';

	const editorMount = document.createElement( 'div' );
	editorMount.className = 'wpdc-editor__monaco-host';

	const statusBar = document.createElement( 'div' );
	statusBar.className = 'wpdc-editor__statusbar';

	const statusLeft = document.createElement( 'span' );
	statusLeft.className = 'wpdc-editor__statusbar-left';
	statusLeft.textContent = 'Select a file from the tree.';

	const statusRight = document.createElement( 'span' );
	statusRight.className = 'wpdc-editor__statusbar-right';

	statusBar.append( statusLeft, statusRight );

	right.append( tabsMount, editorMount, statusBar );
	split.append( treeMount, right );

	monacoSlot.replaceChildren( split );

	return { treeMount, tabsMount, editorMount, statusBar, statusLeft, statusRight };
}

function formatBytes( n: number ): string {
	if ( n < 1024 ) {
		return `${ n } B`;
	}
	if ( n < 1024 * 1024 ) {
		return `${ ( n / 1024 ).toFixed( 1 ) } KB`;
	}
	return `${ ( n / ( 1024 * 1024 ) ).toFixed( 2 ) } MB`;
}

function formatMtime( mtime: number ): string {
	if ( ! mtime ) {
		return '';
	}
	return new Date( mtime * 1000 ).toLocaleString();
}

function formatTime( ts: number ): string {
	return new Date( ts ).toLocaleTimeString();
}

async function renderEditor( body: HTMLElement ): Promise< void > {
	const root = body.querySelector< HTMLElement >( ROOT_SELECTOR );
	const monacoSlot = body.querySelector< HTMLElement >( MONACO_MOUNT_SELECTOR );
	if ( ! root || ! monacoSlot ) {
		// eslint-disable-next-line no-console
		console.error(
			'[wp-desktop-code-editor] Template mount nodes missing; ensure desktop_mode_code_editor_render_template ran.',
		);
		return;
	}

	let monaco: typeof Monaco;
	try {
		monaco = await loadMonaco();
	} catch ( err ) {
		root.classList.remove( LOADING_CLASS );
		root.classList.add( ERROR_CLASS );
		monacoSlot.textContent =
			err instanceof Error ? err.message : 'Failed to load Monaco.';
		return;
	}

	const {
		treeMount,
		tabsMount,
		editorMount,
		statusBar,
		statusLeft,
		statusRight,
	} = buildShell(
		root,
		monacoSlot,
	);

	const placeholder = monaco.editor.createModel(
		'// Click a file in the tree to open it.\n',
		'plaintext',
	);

	const editor = monaco.editor.create( editorMount, {
		model: placeholder,
		theme: monacoThemeForScheme( currentColorScheme() ),
		// `automaticLayout: true` polls + relayouts synchronously
		// every tick during a drag-resize, which makes the minimap
		// canvas flicker. We drive layout via a rAF-throttled
		// ResizeObserver below — one layout per frame, no flicker.
		automaticLayout: false,
		minimap: {
			enabled: true,
			// Render the minimap as colour blocks rather than
			// individual character glyphs — same level of detail
			// at a fraction of the per-frame cost. Cheaper redraws
			// = less visible churn during resize.
			renderCharacters: false,
		},
		fontSize: 13,
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		readOnly: false,
		scrollBeyondLastLine: false,
	} );

	// rAF-throttled layout. Multiple ResizeObserver entries collapse
	// into a single layout per frame; the minimap repaints once per
	// frame in lockstep with the browser's compositor instead of
	// many times mid-frame.
	let layoutScheduled = false;
	const scheduleLayout = (): void => {
		if ( layoutScheduled ) {
			return;
		}
		layoutScheduled = true;
		requestAnimationFrame( () => {
			layoutScheduled = false;
			editor.layout();
		} );
	};
	const layoutObserver = new ResizeObserver( () => {
		scheduleLayout();
	} );
	layoutObserver.observe( editorMount );

	const models = createModelCache();
	const openFiles = new Map< string, OpenFile >();
	const modelChangeDisposers = new Map< string, () => void >(); // eslint-disable-line func-call-spacing
	const openControllers = new Map< string, AbortController >();
	let saveController: AbortController | null = null;

	// Resolve the desktop Window once — used to update the window's
	// chrome title with the active file's name + dirty marker. Lookup
	// is by id (matches the `desktop_mode_register_window( 'wpdc-editor' )`
	// registration). Falls back to a no-op if the global API isn't
	// available (e.g. tests that mount the editor in isolation).
	const setWindowTitle = ( title: string ): void => {
		const win = (
			window as unknown as {
				wp?: {
					desktop?: {
						windowManager?: {
							getById: (
								id: string,
							) => { setTitle?: ( t: string ) => void } | null;
						};
					};
				};
			}
		).wp?.desktop?.windowManager?.getById( 'wpdc-editor' );
		win?.setTitle?.( title );
	};

	const baseTitle = 'Code';
	const refreshWindowTitle = (): void => {
		const activePath = tabs.getActive();
		if ( ! activePath ) {
			setWindowTitle( baseTitle );
			return;
		}
		const file = openFiles.get( activePath );
		const editorModel = editor.getModel();
		const isDirty =
			!! file &&
			!! editorModel &&
			editorModel.getVersionId() !== file.savedVersionId;
		const basename = activePath.split( '/' ).pop() ?? activePath;
		setWindowTitle(
			`${ isDirty ? '● ' : '' }${ basename } — ${ baseTitle }`,
		);
	};

	const setStatus = (
		text: string,
		kind: 'info' | 'error' | 'success' = 'info',
	): void => {
		statusLeft.textContent = text;
		statusBar.classList.toggle(
			'wpdc-editor__statusbar--error',
			kind === 'error',
		);
		statusBar.classList.toggle(
			'wpdc-editor__statusbar--success',
			kind === 'success',
		);
	};

	const setCursorStatus = ( line: number, column: number ): void => {
		statusRight.textContent = `Ln ${ line }, Col ${ column }`;
	};

	const renderFileStatus = ( file: OpenFile, suffix: string = '' ): void => {
		setStatus(
			`${ file.path } · ${ languageFor( file.path ) } · ${ formatBytes(
				file.size,
			) } · ${ formatMtime( file.mtime ) }${ suffix }`,
		);
	};

	/**
	 * Re-evaluate the dirty marker for a given path. The tab strip's
	 * dirty flag is derived from the model's `versionId` vs the
	 * `savedVersionId` we stash on every successful save (or on
	 * initial load). Cheap to call on every keystroke.
	 *
	 * Callbacks below close over `tabs`, declared later in this
	 * scope. Safe because every closure runs only AFTER
	 * `mountTabsStrip` returns and assigns the binding — invoking
	 * them earlier (which we don't) would TDZ.
	 */
	const recomputeDirty = ( path: string ): void => {
		const file = openFiles.get( path );
		const model = models.get( path );
		if ( ! file || ! model ) {
			return;
		}
		const dirty = model.getVersionId() !== file.savedVersionId;
		tabs.setDirty( path, dirty );
		// Window-title dirty marker only matters for the active tab —
		// `refreshWindowTitle` reads it itself, no path comparison
		// needed here.
		if ( tabs.getActive() === path ) {
			refreshWindowTitle();
		}
	};

	const showFile = ( path: string ): void => {
		const model = models.get( path );
		if ( ! model ) {
			return;
		}
		editor.setModel( model );
		const file = openFiles.get( path );
		if ( file ) {
			renderFileStatus( file );
		}
		refreshWindowTitle();
	};

	const onTabActivate = ( path: string ): void => {
		showFile( path );
	};

	const onTabClose = ( path: string ): void => {
		// Tear down per-file state. Aborting any in-flight open is
		// kinder than letting it overwrite the buffer of whatever's
		// active right now.
		openControllers.get( path )?.abort();
		openControllers.delete( path );
		modelChangeDisposers.get( path )?.();
		modelChangeDisposers.delete( path );

		const model = models.get( path );
		if ( model && ! model.isDisposed() ) {
			model.dispose();
		}
		openFiles.delete( path );

		if ( ! tabs.getActive() ) {
			editor.setModel( placeholder );
			setStatus( 'Select a file from the tree.' );
			refreshWindowTitle();
		}
	};

	const tabs: TabsStripHandle = mountTabsStrip( {
		mount: tabsMount,
		onActivate: onTabActivate,
		onClose: onTabClose,
	} );

	const trackModelChanges = ( path: string ): void => {
		const model = models.get( path );
		if ( ! model ) {
			return;
		}
		// One subscription per model — re-binding on every open
		// would leak.
		modelChangeDisposers.get( path )?.();
		const sub = model.onDidChangeContent( () => {
			recomputeDirty( path );
		} );
		modelChangeDisposers.set( path, () => sub.dispose() );
	};

	/**
	 * Idempotently open a file: returns the existing model if already
	 * open as a tab, otherwise fetches via REST + creates the model
	 * + opens the tab. Returns the model on success, null on error
	 * (errors surface on the status bar).
	 */
	const openFile = async (
		path: string,
	): Promise< Monaco.editor.ITextModel | null > => {
		// Already open? Focus its tab and return the cached model.
		if ( tabs.has( path ) ) {
			tabs.open( tabMetaForPath( path ) );
			showFile( path );
			return models.get( path );
		}

		// Cancel any concurrent open for the same path (rapid
		// re-clicks while still loading).
		openControllers.get( path )?.abort();
		const ac = new AbortController();
		openControllers.set( path, ac );

		setStatus( `${ path } · loading…` );

		try {
			const file = await fetchFile( path, ac.signal );
			if ( ac.signal.aborted ) {
				return null;
			}
			const model = models.open( monaco, path, file.content );
			openFiles.set( path, {
				path: file.path,
				mtime: file.mtime,
				size: file.size,
				savedVersionId: model.getVersionId(),
			} );
			trackModelChanges( path );

			tabs.open( tabMetaForPath( file.path ) );
			showFile( file.path );
			return model;
		} catch ( err ) {
			if ( ( err as Error ).name === 'AbortError' ) {
				return null;
			}
			let msg = 'Failed to open file.';
			if ( err instanceof RestError ) {
				msg = `${ err.code } — ${ err.message }`;
			} else if ( err instanceof Error ) {
				msg = err.message;
			}
			setStatus( msg, 'error' );
			return null;
		} finally {
			if ( openControllers.get( path ) === ac ) {
				openControllers.delete( path );
			}
		}
	};

	/**
	 * Open a file AND scroll the editor to a specific line. Used by
	 * the PHP `Go to Definition` provider when the user cmd-clicks a
	 * workspace symbol — opens the file in a new tab (or focuses
	 * existing) and reveals the declaration line.
	 */
	const openFileAtLine = async (
		path: string,
		line: number,
	): Promise< Monaco.editor.ITextModel | null > => {
		const model = await openFile( path );
		if ( ! model ) {
			return null;
		}
		// Defer to the next tick so Monaco has time to bind the model
		// to the editor before we try to reveal a line in it.
		requestAnimationFrame( () => {
			editor.revealLineInCenter( line );
			editor.setPosition( { lineNumber: line, column: 1 } );
			editor.focus();
		} );
		return model;
	};

	const saveActiveFile = async (): Promise< void > => {
		const activePath = tabs.getActive();
		if ( ! activePath ) {
			return;
		}
		const file = openFiles.get( activePath );
		const model = models.get( activePath );
		if ( ! file || ! model ) {
			return;
		}
		const content = model.getValue();

		saveController?.abort();
		const ac = new AbortController();
		saveController = ac;

		setStatus( `${ file.path } · saving…` );

		try {
			const result = await saveFile( file.path, content, file.mtime, ac.signal );
			if ( ac.signal.aborted ) {
				return;
			}
			const updated: OpenFile = {
				path: result.path,
				mtime: result.mtime,
				size: result.size,
				// Snapshot the model's versionId at save time. Any
				// subsequent edit advances the versionId, which
				// `recomputeDirty` reads to set the tab marker.
				savedVersionId: model.getVersionId(),
			};
			openFiles.set( file.path, updated );
			tabs.setDirty( file.path, false );
			renderFileStatus(
				updated,
				` · saved at ${ formatTime( Date.now() ) }`,
			);
		} catch ( err ) {
			if ( ( err as Error ).name === 'AbortError' ) {
				return;
			}
			if (
				err instanceof RestError &&
				err.code === 'desktop_mode_code_editor_conflict'
			) {
				const data = ( err.data ?? null ) as ConflictData | null;
				if ( ! data ) {
					setStatus(
						`${ file.path } · conflict but no server data; reload manually.`,
						'error',
					);
					return;
				}
				const choice = await showConflictDialog( {
					path: file.path,
					serverMtime: data.server_mtime,
					serverSize: data.server_size,
				} );
				if ( choice === 'cancel' ) {
					setStatus( `${ file.path } · save cancelled`, 'error' );
					return;
				}
				if ( choice === 'reload' ) {
					model.setValue( data.server_content );
					const reloaded: OpenFile = {
						path: file.path,
						mtime: data.server_mtime,
						size: data.server_size,
						savedVersionId: model.getVersionId(),
					};
					openFiles.set( file.path, reloaded );
					tabs.setDirty( file.path, false );
					renderFileStatus( reloaded, ' · reloaded from disk' );
					return;
				}
				// Overwrite — bump our mtime to the server's so the
				// next-attempt's concurrency check passes.
				openFiles.set( file.path, {
					...file,
					mtime: data.server_mtime,
					size: data.server_size,
				} );
				await saveActiveFile();
				return;
			}
			let msg = 'Failed to save.';
			if ( err instanceof RestError ) {
				msg = `${ err.code } — ${ err.message }`;
			} else if ( err instanceof Error ) {
				msg = err.message;
			}
			setStatus( `${ file.path } · ${ msg }`, 'error' );
		} finally {
			if ( saveController === ac ) {
				saveController = null;
			}
		}
	};

	editor.addCommand(
		// eslint-disable-next-line no-bitwise
		monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
		() => {
			void saveActiveFile();
		},
	);
	editor.addAction( {
		id: 'wpdc.saveFile',
		label: 'Save File',
		// eslint-disable-next-line no-bitwise
		keybindings: [ monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS ],
		contextMenuGroupId: 'navigation',
		run: () => {
			void saveActiveFile();
		},
	} );

	// Cursor position → status bar's right zone. Monaco fires
	// `onDidChangeCursorPosition` for both keyboard movement and
	// mouse clicks; one subscription covers both.
	editor.onDidChangeCursorPosition( ( e ) => {
		setCursorStatus( e.position.lineNumber, e.position.column );
	} );
	const initial = editor.getPosition();
	if ( initial ) {
		setCursorStatus( initial.lineNumber, initial.column );
	}

	// Wire the PHP `Go to Definition` provider to this editor's
	// open-file plumbing. Cmd-clicking a workspace symbol now opens
	// the file in a tab and scrolls to its declaration line.
	setPhpProviderHost( { openFileAtLine } );

	// In-editor `wp-desktop-code-open` handler. The page-level
	// listener in `global-listeners.ts` opens the editor window and
	// re-broadcasts the message; this handler catches the broadcast
	// once the render callback has mounted. Same listener also
	// handles direct messages from a user-open editor (no
	// re-broadcast needed in that case).
	const onPostOpen = ( event: MessageEvent ): void => {
		if ( event.origin !== window.location.origin ) {
			return;
		}
		const data = event.data as
			| { type?: string; path?: string; line?: number }
			| null;
		if (
			! data ||
			data.type !== 'wp-desktop-code-open' ||
			typeof data.path !== 'string'
		) {
			return;
		}
		void openFileAtLine( data.path, data.line ?? 1 );
	};
	window.addEventListener( 'message', onPostOpen );

	const tree: FileTreeHandle = mountFileTree( {
		mount: treeMount,
		onOpen: ( path ) => {
			void openFile( path );
		},
	} );

	root.classList.remove( LOADING_CLASS );
	void tree;
}

// Install page-level keyboard shortcut + open-from-elsewhere
// postMessage listener. Idempotent — bundle imported multiple times
// (rare but possible if a plugin re-enqueues it) won't double-attach.
installEditorGlobalListeners();

const registry =
	( window.desktopModeNativeWindows ??
		( window.desktopModeNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
registry[ 'wpdc-editor' ] = ( body: HTMLElement ) => {
	void renderEditor( body );
};
