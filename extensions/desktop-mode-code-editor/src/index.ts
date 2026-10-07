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
		openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

export const ROOT_SELECTOR = '[data-osc-editor-root]';
export const MONACO_MOUNT_SELECTOR = '[data-osc-editor-monaco]';
export const LOADING_CLASS = 'osc-editor--loading';
export const ERROR_CLASS = 'osc-editor--error';

interface OpenFile {
	path: string;
	mtime: number;
	size: number;

	savedVersionId: number;
}

function buildShell( root: HTMLElement, monacoSlot: HTMLElement ): {
	treeMount: HTMLElement;
	tabsMount: HTMLElement;
	editorMount: HTMLElement;
	statusBar: HTMLElement;
	statusLeft: HTMLElement;
	statusRight: HTMLElement;
} {
	root.classList.add( 'osc-editor--phase3' );

	const split = document.createElement( 'div' );
	split.className = 'osc-editor__split';

	const treeMount = document.createElement( 'div' );
	treeMount.className = 'osc-editor__tree';

	const right = document.createElement( 'div' );
	right.className = 'osc-editor__right';

	const tabsMount = document.createElement( 'div' );
	tabsMount.className = 'osc-editor__tabs-host';

	const editorMount = document.createElement( 'div' );
	editorMount.className = 'osc-editor__monaco-host';

	const statusBar = document.createElement( 'div' );
	statusBar.className = 'osc-editor__statusbar';

	const statusLeft = document.createElement( 'span' );
	statusLeft.className = 'osc-editor__statusbar-left';
	statusLeft.textContent = 'Select a file from the tree.';

	const statusRight = document.createElement( 'span' );
	statusRight.className = 'osc-editor__statusbar-right';

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

		console.error(
			'[os-code-editor] Template mount nodes missing; ensure openstation_code_editor_render_template ran.',
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

		automaticLayout: false,
		minimap: {
			enabled: true,

			renderCharacters: false,
		},
		fontSize: 13,
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		readOnly: false,
		scrollBeyondLastLine: false,
	} );

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
	const modelChangeDisposers = new Map< string, () => void >();
	const openControllers = new Map< string, AbortController >();
	let saveController: AbortController | null = null;

	const setWindowTitle = ( title: string ): void => {
		const win = (
			window as unknown as {
				wp?: {
					os?: {
						windowManager?: {
							getById: (
								id: string,
							) => { setTitle?: ( t: string ) => void } | null;
						};
					};
				};
			}
		).wp?.os?.windowManager?.getById( 'wpdc-editor' );
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
			'osc-editor__statusbar--error',
			kind === 'error',
		);
		statusBar.classList.toggle(
			'osc-editor__statusbar--success',
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

	const recomputeDirty = ( path: string ): void => {
		const file = openFiles.get( path );
		const model = models.get( path );
		if ( ! file || ! model ) {
			return;
		}
		const dirty = model.getVersionId() !== file.savedVersionId;
		tabs.setDirty( path, dirty );

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

		modelChangeDisposers.get( path )?.();
		const sub = model.onDidChangeContent( () => {
			recomputeDirty( path );
		} );
		modelChangeDisposers.set( path, () => sub.dispose() );
	};

	const openFile = async (
		path: string,
	): Promise< Monaco.editor.ITextModel | null > => {

		if ( tabs.has( path ) ) {
			tabs.open( tabMetaForPath( path ) );
			showFile( path );
			return models.get( path );
		}

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

	const openFileAtLine = async (
		path: string,
		line: number,
	): Promise< Monaco.editor.ITextModel | null > => {
		const model = await openFile( path );
		if ( ! model ) {
			return null;
		}

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
				err.code === 'openstation_code_editor_conflict'
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

		monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
		() => {
			void saveActiveFile();
		},
	);
	editor.addAction( {
		id: 'osc.saveFile',
		label: 'Save File',

		keybindings: [ monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS ],
		contextMenuGroupId: 'navigation',
		run: () => {
			void saveActiveFile();
		},
	} );

	editor.onDidChangeCursorPosition( ( e ) => {
		setCursorStatus( e.position.lineNumber, e.position.column );
	} );
	const initial = editor.getPosition();
	if ( initial ) {
		setCursorStatus( initial.lineNumber, initial.column );
	}

	setPhpProviderHost( { openFileAtLine } );

	const onPostOpen = ( event: MessageEvent ): void => {
		if ( event.origin !== window.location.origin ) {
			return;
		}
		const data = event.data as
			| { type?: string; path?: string; line?: number }
			| null;
		if (
			! data ||
			data.type !== 'os-code-open' ||
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

installEditorGlobalListeners();

const registry =
	( window.openStationNativeWindows ??
		( window.openStationNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
registry[ 'wpdc-editor' ] = ( body: HTMLElement ) => {
	void renderEditor( body );
};
