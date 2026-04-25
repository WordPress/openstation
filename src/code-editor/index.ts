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
 * @since 0.18.0
 */

import { showConflictDialog } from './conflict-dialog';
import { createModelCache, languageFor } from './file-models';
import { loadMonaco } from './monaco-bootstrap';
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
import { mountFileTree, type FileTreeHandle } from './tree';

import type * as Monaco from 'monaco-editor';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		wpDesktopNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

/** Mount selectors — kept in lockstep with `wpdc_render_editor_template()`. */
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
	statusBar.textContent = 'Select a file from the tree.';

	right.append( tabsMount, editorMount, statusBar );
	split.append( treeMount, right );

	monacoSlot.replaceChildren( split );

	return { treeMount, tabsMount, editorMount, statusBar };
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
			'[wp-desktop-code-editor] Template mount nodes missing; ensure wpdc_render_editor_template ran.',
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

	const { treeMount, tabsMount, editorMount, statusBar } = buildShell(
		root,
		monacoSlot,
	);

	const placeholder = monaco.editor.createModel(
		'// Click a file in the tree to open it.\n',
		'plaintext',
	);

	const editor = monaco.editor.create( editorMount, {
		model: placeholder,
		theme: 'vs-dark',
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

	const setStatus = (
		text: string,
		kind: 'info' | 'error' | 'success' = 'info',
	): void => {
		statusBar.textContent = text;
		statusBar.classList.toggle(
			'wpdc-editor__statusbar--error',
			kind === 'error',
		);
		statusBar.classList.toggle(
			'wpdc-editor__statusbar--success',
			kind === 'success',
		);
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

	const openFileFromTree = async ( path: string ): Promise< void > => {
		// Already open? Just focus its tab.
		if ( tabs.has( path ) ) {
			tabs.open( tabMetaForPath( path ) );
			showFile( path );
			return;
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
				return;
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
		} catch ( err ) {
			if ( ( err as Error ).name === 'AbortError' ) {
				return;
			}
			let msg = 'Failed to open file.';
			if ( err instanceof RestError ) {
				msg = `${ err.code } — ${ err.message }`;
			} else if ( err instanceof Error ) {
				msg = err.message;
			}
			setStatus( msg, 'error' );
		} finally {
			if ( openControllers.get( path ) === ac ) {
				openControllers.delete( path );
			}
		}
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
			if ( err instanceof RestError && err.code === 'wpdc_conflict' ) {
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

	const tree: FileTreeHandle = mountFileTree( {
		mount: treeMount,
		onOpen: ( path ) => {
			void openFileFromTree( path );
		},
	} );

	root.classList.remove( LOADING_CLASS );
	void tree;
}

const registry =
	( window.wpDesktopNativeWindows ??
		( window.wpDesktopNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
registry[ 'wpdc-editor' ] = ( body: HTMLElement ) => {
	void renderEditor( body );
};
