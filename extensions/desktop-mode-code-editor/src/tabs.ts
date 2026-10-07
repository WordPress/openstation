import { showConfirm } from './dialog';

export interface OpenFileMeta {

	path: string;

	label: string;

	icon: string;
}

export interface TabsStripOptions {

	mount: HTMLElement;

	onActivate: ( path: string ) => void;

	onClose: ( path: string ) => void;
}

export interface TabsStripHandle {

	open( file: OpenFileMeta ): string;

	closeQuiet( path: string ): void;
	setActive( path: string ): void;
	getActive(): string | null;
	setDirty( path: string, dirty: boolean ): void;
	has( path: string ): boolean;
	dispose(): void;
}

interface InternalTab extends OpenFileMeta {
	dirty: boolean;
	li: HTMLLIElement;
	dirtyEl: HTMLElement;
}

export function mountTabsStrip(
	opts: TabsStripOptions,
): TabsStripHandle {
	const { mount, onActivate, onClose } = opts;
	mount.classList.add( 'osc-tabs' );

	const ul = document.createElement( 'ul' );
	ul.className = 'osc-tabs__list';
	mount.replaceChildren( ul );

	const tabs = new Map< string, InternalTab >();
	const order: string[] = [];
	let active: string | null = null;

	const updateActiveClass = (): void => {
		for ( const [ path, tab ] of tabs ) {
			tab.li.classList.toggle( 'osc-tabs__tab--active', path === active );
		}
	};

	const indexOf = ( path: string ): number => order.indexOf( path );

	const pickNeighbour = ( path: string ): string | null => {
		const idx = indexOf( path );
		if ( idx === -1 ) {
			return null;
		}

		if ( order[ idx + 1 ] ) {
			return order[ idx + 1 ];
		}
		if ( order[ idx - 1 ] ) {
			return order[ idx - 1 ];
		}
		return null;
	};

	const removeTab = ( path: string ): void => {
		const tab = tabs.get( path );
		if ( ! tab ) {
			return;
		}

		const wasActive = active === path;
		const successor = wasActive ? pickNeighbour( path ) : null;

		tab.li.remove();
		tabs.delete( path );
		const idx = indexOf( path );
		if ( idx !== -1 ) {
			order.splice( idx, 1 );
		}

		if ( wasActive ) {
			active = successor;
			updateActiveClass();
			if ( active ) {
				onActivate( active );
			}
		}
		onClose( path );
	};

	const closeWithGuard = async ( path: string ): Promise< void > => {
		const tab = tabs.get( path );
		if ( ! tab ) {
			return;
		}
		if ( tab.dirty ) {
			const ok = await showConfirm( {
				title: 'Close without saving?',
				body: `${ tab.path } has unsaved changes. Close anyway?`,
				confirmLabel: 'Close without saving',
				cancelLabel: 'Keep open',
				danger: true,
			} );
			if ( ! ok ) {
				return;
			}
		}
		removeTab( path );
	};

	const buildTab = ( file: OpenFileMeta ): InternalTab => {
		const li = document.createElement( 'li' );
		li.className = 'osc-tabs__tab';
		li.dataset.path = file.path;
		li.title = file.path;

		const body = document.createElement( 'button' );
		body.type = 'button';
		body.className = 'osc-tabs__body';
		body.addEventListener( 'click', () => {
			if ( active !== file.path ) {
				active = file.path;
				updateActiveClass();
				onActivate( file.path );
			}
		} );

		const icon = document.createElement( 'span' );
		icon.className = `osc-tabs__icon dashicons ${ file.icon }`;
		icon.setAttribute( 'aria-hidden', 'true' );

		const label = document.createElement( 'span' );
		label.className = 'osc-tabs__label';
		label.textContent = file.label;

		body.append( icon, label );

		const trailing = document.createElement( 'span' );
		trailing.className = 'osc-tabs__trailing';

		const dirtyEl = document.createElement( 'span' );
		dirtyEl.className = 'osc-tabs__dirty';
		dirtyEl.textContent = '●';
		dirtyEl.setAttribute( 'aria-label', 'Unsaved changes' );

		const closeBtn = document.createElement( 'button' );
		closeBtn.type = 'button';
		closeBtn.className = 'osc-tabs__close';
		closeBtn.setAttribute( 'aria-label', 'Close tab' );
		closeBtn.textContent = '×';
		closeBtn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void closeWithGuard( file.path );
		} );

		trailing.append( dirtyEl, closeBtn );
		li.append( body, trailing );

		li.addEventListener( 'auxclick', ( e ) => {
			if ( e.button === 1 ) {
				e.preventDefault();
				void closeWithGuard( file.path );
			}
		} );

		return { ...file, dirty: false, li, dirtyEl };
	};

	const setDirty = ( path: string, dirty: boolean ): void => {
		const tab = tabs.get( path );
		if ( ! tab || tab.dirty === dirty ) {
			return;
		}
		tab.dirty = dirty;
		tab.li.classList.toggle( 'osc-tabs__tab--dirty', dirty );
	};

	return {
		open( file ) {
			let tab = tabs.get( file.path );
			if ( ! tab ) {
				tab = buildTab( file );
				tabs.set( file.path, tab );
				order.push( file.path );
				ul.append( tab.li );
			}
			active = file.path;
			updateActiveClass();
			tab.li.scrollIntoView( {
				inline: 'nearest',
				block: 'nearest',
				behavior: 'smooth',
			} );
			return active;
		},

		closeQuiet( path ) {
			removeTab( path );
		},

		setActive( path ) {
			if ( ! tabs.has( path ) ) {
				return;
			}
			active = path;
			updateActiveClass();
		},

		getActive() {
			return active;
		},

		setDirty,

		has( path ) {
			return tabs.has( path );
		},

		dispose() {
			tabs.clear();
			order.length = 0;
			active = null;
			mount.replaceChildren();
		},
	};
}

export function tabMetaForPath( path: string ): OpenFileMeta {
	const slash = path.lastIndexOf( '/' );
	const label = slash >= 0 ? path.slice( slash + 1 ) : path;
	const dot = label.lastIndexOf( '.' );
	const ext = dot >= 0 ? label.slice( dot + 1 ).toLowerCase() : '';

	const ICON_BY_EXT: Record< string, string > = {
		php: 'dashicons-editor-code',
		js: 'dashicons-editor-code',
		mjs: 'dashicons-editor-code',
		cjs: 'dashicons-editor-code',
		jsx: 'dashicons-editor-code',
		ts: 'dashicons-editor-code',
		tsx: 'dashicons-editor-code',
		css: 'dashicons-art',
		scss: 'dashicons-art',
		sass: 'dashicons-art',
		less: 'dashicons-art',
		html: 'dashicons-html',
		htm: 'dashicons-html',
		json: 'dashicons-media-text',
		md: 'dashicons-media-document',
		mdx: 'dashicons-media-document',
		svg: 'dashicons-format-image',
		xml: 'dashicons-media-text',
		yml: 'dashicons-media-text',
		yaml: 'dashicons-media-text',
		txt: 'dashicons-media-default',
	};

	return {
		path,
		label,
		icon: ICON_BY_EXT[ ext ] ?? 'dashicons-media-default',
	};
}
