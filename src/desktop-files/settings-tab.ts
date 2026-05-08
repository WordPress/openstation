/**
 * Desktop Mode — File Associations OS Settings tab.
 *
 * Phase 5 of the Files-on-the-Desktop system. Renders one row
 * per registered file type with a `<select>` listing every
 * opener that handles that type. Saving writes through the
 * `PUT /associations` REST endpoint and updates the JS-side
 * association map so subsequent `wp.desktop.files.open()` calls
 * pick up the new choice without a reload.
 *
 * @since 0.9.0
 */

import { registerSettingsTab } from '../settings/registry';
import { saveAssociations } from './rest';
import {
	getOpenersForType,
	getUserAssociations,
	resolveOpener,
	setUserAssociations,
} from './openers';
import { getTypes } from './registry';

const TAB_ID = 'desktop-mode-file-associations';

/**
 * Register the tab. Called once at bundle boot from
 * `src/desktop-files/index.ts`.
 */
export function registerFileAssociationsTab(): void {
	registerSettingsTab( {
		id: TAB_ID,
		label: 'File Associations',
		order: 50,
		render( body ) {
			renderTab( body );
		},
	} );
}

function renderTab( body: HTMLElement ): void {
	body.replaceChildren();

	const types = getTypes();
	if ( types.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.className = 'desktop-mode-file-associations__empty';
		empty.textContent = 'No file types are registered.';
		body.appendChild( empty );
		return;
	}

	const intro = document.createElement( 'p' );
	intro.className = 'desktop-mode-file-associations__intro';
	intro.textContent =
		'Pick which app opens each kind of file when you double-click it on the desktop.';
	body.appendChild( intro );

	const associations = getUserAssociations();
	const list = document.createElement( 'div' );
	list.className = 'desktop-mode-file-associations__list';
	list.setAttribute( 'role', 'list' );
	for ( const type of types ) {
		list.appendChild( buildRow( type.type, type.label, associations ) );
	}
	body.appendChild( list );
}

function buildRow(
	typeSlug: string,
	typeLabel: string,
	associations: Record< string, string >,
): HTMLElement {
	const row = document.createElement( 'div' );
	row.className = 'desktop-mode-file-associations__row';
	row.setAttribute( 'role', 'listitem' );
	row.dataset.fileType = typeSlug;

	const label = document.createElement( 'label' );
	label.className = 'desktop-mode-file-associations__label';
	label.textContent = typeLabel;
	row.appendChild( label );

	const candidates = getOpenersForType( typeSlug );
	if ( candidates.length === 0 ) {
		const empty = document.createElement( 'span' );
		empty.className = 'desktop-mode-file-associations__none';
		empty.textContent = 'No app available';
		row.appendChild( empty );
		return row;
	}

	const resolved = resolveOpener( typeSlug );
	const currentId = associations[ typeSlug ] ?? resolved?.id ?? '';

	// Use the framework's `<wpd-select>` so the picker matches the
	// rest of OS Settings. The component wraps a native `<select>`
	// internally — keyboard nav and OS pickers stay correct — and
	// emits `wpd-pick` with the chosen value.
	const select = document.createElement( 'wpd-select' ) as HTMLElement & {
		value?: string;
	};
	select.setAttribute( 'value', currentId );
	select.setAttribute( 'aria-label', `Default app for ${ typeLabel }` );
	select.className = 'desktop-mode-file-associations__select';
	label.htmlFor = `assoc-${ typeSlug }`;
	select.id = `assoc-${ typeSlug }`;

	for ( const o of candidates ) {
		const opt = document.createElement( 'wpd-option' );
		opt.setAttribute( 'value', o.id );
		opt.textContent = o.isDefault ? `${ o.label } (default)` : o.label;
		select.appendChild( opt );
	}

	select.addEventListener( 'wpd-pick', ( e: Event ) => {
		const next = ( e as CustomEvent< { value: string } > ).detail?.value;
		if ( ! next ) {
			return;
		}
		const merged = { ...getUserAssociations(), [ typeSlug ]: next };
		// Optimistic update — the open() resolver picks up the change
		// immediately; REST persistence runs in the background.
		setUserAssociations( merged );
		void saveAssociations( merged ).catch( ( err: unknown ) => {
			// eslint-disable-next-line no-console
			console.error( '[desktop-mode] saveAssociations failed:', err );
		} );
	} );

	row.appendChild( select );
	return row;
}
