/**
 * Posts app — the sidebar editor's building blocks: the header dot +
 * label, the labelled inputs (a slug input normalises as you type),
 * the meta line, the actions row, the empty state, and the two-click
 * armed Delete. Both canvases compose their draft and editor forms
 * from these.
 *
 * @public
 */

import { __ } from '@openstation/app';
import { CANVAS_PREFIX, canvasButton } from './chrome';

const P = CANVAS_PREFIX;

export function sidebarHeader( sidebar: HTMLElement, color: string, label: string ): void {
	const header = document.createElement( 'div' );
	header.className = `${ P }__sidebar-header`;
	const dot = document.createElement( 'span' );
	dot.className = `${ P }__sidebar-dot`;
	dot.style.background = color;
	const code = document.createElement( 'code' );
	code.className = `${ P }__sidebar-slug`;
	code.textContent = label;
	header.appendChild( dot );
	header.appendChild( code );
	sidebar.appendChild( header );
}

function labelFor( sidebar: HTMLElement, text: string ): void {
	const label = document.createElement( 'label' );
	label.className = `${ P }__sidebar-label`;
	label.textContent = text;
	sidebar.appendChild( label );
}

/** A labelled text input. */
export function sidebarInput( sidebar: HTMLElement, label: string, value: string, placeholder: string ): HTMLInputElement {
	labelFor( sidebar, label );
	const input = document.createElement( 'input' );
	input.type = 'text';
	input.className = `${ P }__editor-name`;
	input.value = value;
	input.placeholder = placeholder;
	sidebar.appendChild( input );
	return input;
}

/**
 * The slug input: lowercase, `[a-z0-9-]`, normalised eagerly so the
 * user sees what will actually be saved; `autocapitalize="off"` keeps
 * phone keyboards from capitalising the first character.
 */
export function sidebarSlugInput( sidebar: HTMLElement, value: string ): HTMLInputElement {
	const input = sidebarInput( sidebar, __( 'Slug' ), value, __( 'auto-from-name' ) );
	input.spellcheck = false;
	input.autocapitalize = 'off';
	input.addEventListener( 'input', () => {
		const v = input.value;
		const norm = v.toLowerCase().replace( /[^a-z0-9-]+/g, '-' );
		if ( v !== norm ) {
			const sel = input.selectionStart ?? norm.length;
			input.value = norm;
			input.setSelectionRange( sel, sel );
		}
	} );
	return input;
}

export function sidebarTextarea( sidebar: HTMLElement, value: string ): HTMLTextAreaElement {
	labelFor( sidebar, __( 'Description' ) );
	const textarea = document.createElement( 'textarea' );
	textarea.className = `${ P }__editor-desc`;
	textarea.value = value;
	textarea.placeholder = __( 'Description (optional)' );
	textarea.rows = 4;
	sidebar.appendChild( textarea );
	return textarea;
}

export function sidebarMeta( sidebar: HTMLElement, text: string ): void {
	const meta = document.createElement( 'p' );
	meta.className = `${ P }__sidebar-meta`;
	meta.textContent = text;
	sidebar.appendChild( meta );
}

export const sidebarButton = canvasButton;

export function sidebarActions( sidebar: HTMLElement, buttons: HTMLElement[] ): void {
	const actions = document.createElement( 'div' );
	actions.className = `${ P }__editor-actions`;
	for ( const b of buttons ) {
		actions.appendChild( b );
	}
	sidebar.appendChild( actions );
}

/** The empty state when nothing is focused. */
export function sidebarEmpty( sidebar: HTMLElement, icon: string, title: string, hint: string ): void {
	const empty = document.createElement( 'div' );
	empty.className = `${ P }__sidebar-empty`;
	const iconEl = document.createElement( 'span' );
	iconEl.className = `dashicons ${ icon }`;
	iconEl.setAttribute( 'aria-hidden', 'true' );
	empty.appendChild( iconEl );
	const titleEl = document.createElement( 'h3' );
	titleEl.className = `${ P }__sidebar-empty-title`;
	titleEl.textContent = title;
	empty.appendChild( titleEl );
	const help = document.createElement( 'p' );
	help.className = `${ P }__sidebar-empty-hint`;
	help.textContent = hint;
	empty.appendChild( help );
	sidebar.appendChild( empty );
}

/**
 * Delete as a two-click gesture: the first click arms the button
 * ("Click again to delete") for 2.5s, the second runs it.
 */
export function armedDeleteButton( onDelete: () => Promise< void > ): HTMLButtonElement {
	const delBtn = canvasButton( 'danger', __( 'Delete' ) );
	let armResetTimer: number | null = null;
	delBtn.addEventListener( 'click', async () => {
		if ( ! delBtn.classList.contains( 'is-armed' ) ) {
			delBtn.textContent = __( 'Click again to delete' );
			delBtn.classList.add( 'is-armed' );
			if ( armResetTimer !== null ) {
				window.clearTimeout( armResetTimer );
			}
			armResetTimer = window.setTimeout( () => {
				delBtn.textContent = __( 'Delete' );
				delBtn.classList.remove( 'is-armed' );
				armResetTimer = null;
			}, 2500 );
			return;
		}
		if ( armResetTimer !== null ) {
			window.clearTimeout( armResetTimer );
			armResetTimer = null;
		}
		await onDelete();
	} );
	return delBtn;
}

/** Enter commits, Escape cancels — the muscle memory of every "new item" form in wp-admin. */
export function bindDraftKeys( input: HTMLInputElement, commit: () => void, cancel: () => void ): void {
	input.addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'Enter' ) {
			e.preventDefault();
			commit();
		} else if ( e.key === 'Escape' ) {
			cancel();
		}
	} );
}
