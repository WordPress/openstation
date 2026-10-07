import { __ } from '../i18n';
import type { Window as WPWindow } from '../window';

const OS_SETTINGS_ID = 'desktop-mode-os-settings';

const RECYCLE_BIN_ID = 'desktop-mode-recycle-bin';

type CountReader = () => number;

interface PeekCardContext {
	window: WPWindow;
	item: { id: string; title: string; icon: string; url: string };
}

interface RegisterOpts {

	getRecycleBinCount: CountReader;
}

export function registerBuiltInPeekRenderers( opts: RegisterOpts ): void {
	const wpHooks = getWpHooks();
	if ( ! wpHooks ) {
		return;
	}
	wpHooks.addFilter(
		'os.dock.peek-card-content',
		'desktop-mode/built-in-peek-renderers',
		( body: unknown, ctx: unknown ): HTMLElement => {
			const context = ctx as PeekCardContext;
			const id = context.window.id;
			if ( id === OS_SETTINGS_ID ) {
				return renderOsSettings( context );
			}
			if ( id === RECYCLE_BIN_ID ) {
				return renderRecycleBin( context, opts.getRecycleBinCount );
			}
			return body as HTMLElement;
		},
	);
}

function renderOsSettings( _ctx: PeekCardContext ): HTMLElement {
	const root = document.createElement( 'span' );
	root.className =
		'os-dock-peek__card-body os-dock-peek__card-body--os-settings';
	root.setAttribute( 'aria-hidden', 'true' );

	const hero = document.createElement( 'span' );
	hero.className = 'os-dock-peek__os-hero dashicons dashicons-admin-generic';
	root.appendChild( hero );

	const subtitle = document.createElement( 'span' );
	subtitle.className = 'os-dock-peek__os-subtitle';
	subtitle.textContent = __( 'System Preferences' );
	root.appendChild( subtitle );

	const tabs = document.createElement( 'span' );
	tabs.className = 'os-dock-peek__os-tabs';
	for ( const cls of [
		'dashicons-art',
		'dashicons-admin-customizer',
		'dashicons-editor-help',
	] ) {
		const tab = document.createElement( 'span' );
		tab.className = `os-dock-peek__os-tab dashicons ${ cls }`;
		tabs.appendChild( tab );
	}
	root.appendChild( tabs );

	return root;
}

function renderRecycleBin(
	_ctx: PeekCardContext,
	getCount: CountReader,
): HTMLElement {
	const root = document.createElement( 'span' );
	root.className =
		'os-dock-peek__card-body os-dock-peek__card-body--recycle-bin';
	root.setAttribute( 'aria-hidden', 'true' );

	const count = Math.max( 0, Math.floor( getCount() || 0 ) );
	root.dataset.empty = count === 0 ? 'true' : 'false';

	const stage = document.createElement( 'span' );
	stage.className = 'os-dock-peek__bin-stage';

	const stack = document.createElement( 'span' );
	stack.className = 'os-dock-peek__bin-stack';
	for ( let i = 0; i < 3; i++ ) {
		const slip = document.createElement( 'span' );
		slip.className = 'os-dock-peek__bin-slip';
		stack.appendChild( slip );
	}
	stage.appendChild( stack );

	const icon = document.createElement( 'span' );
	icon.className = `os-dock-peek__bin-icon dashicons ${
		count === 0 ? 'dashicons-trash' : 'dashicons-trash'
	}`;
	stage.appendChild( icon );

	root.appendChild( stage );

	const label = document.createElement( 'span' );
	label.className = 'os-dock-peek__bin-label';
	if ( count === 0 ) {
		label.textContent = __( 'Trash — empty' );
	} else if ( count === 1 ) {
		label.textContent = __( '1 item' );
	} else if ( count > 99 ) {
		label.textContent = '99+ items';
	} else {
		label.textContent = `${ count } items`;
	}
	root.appendChild( label );

	return root;
}

interface FakeWpHooks {
	addFilter: (
		hookName: string,
		ns: string,
		cb: ( ...a: unknown[] ) => unknown,
	) => void;
}

function getWpHooks(): FakeWpHooks | null {
	const wp = ( window as unknown as { wp?: { hooks?: FakeWpHooks } } ).wp;
	return wp?.hooks ?? null;
}
