import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { classifyDropTarget } from '../../src/os-file-drop/manager';

function dropOn( el: Element ): DragEvent {
	return {
		target: el,
		clientX: 40,
		clientY: 50,
	} as unknown as DragEvent;
}

describe( 'classifyDropTarget', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'drop on the files layer inside a folder window resolves the folder', () => {

		document.body.innerHTML = `
			<div class="os-window os-window--native" id="wp-window-os-folder-7">
				<div class="os-files-layer" data-folder-id="7">
					<span id="target"></span>
				</div>
			</div>`;
		const ctx = classifyDropTarget( dropOn( document.getElementById( 'target' )! ) );
		expect( ctx.surface ).toBe( 'folder' );
		expect( ctx.folderId ).toBe( 7 );
	} );

	test( 'drop on folder-window whitespace OUTSIDE the layer still resolves the folder', () => {

		document.body.innerHTML = `
			<div class="os-window os-window--native" id="wp-window-os-folder-7">
				<div class="os-folder-window__split" id="target"></div>
			</div>`;
		const ctx = classifyDropTarget( dropOn( document.getElementById( 'target' )! ) );
		expect( ctx.surface ).toBe( 'folder' );
		expect( ctx.folderId ).toBe( 7 );
		expect( ctx.windowId ).toBe( 'os-folder-7' );
	} );

	test( 'drop on a closed folder TILE routes into that folder, not its parent', () => {
		document.body.innerHTML = `
			<div id="os-area">
				<div class="os-files-layer" data-folder-id="0">
					<button class="os-file-tile" data-file-type="folder" data-file-ref="9" id="target"></button>
				</div>
			</div>`;
		const ctx = classifyDropTarget( dropOn( document.getElementById( 'target' )! ) );
		expect( ctx.surface ).toBe( 'folder' );
		expect( ctx.folderId ).toBe( 9 );
	} );

	test( 'drop on a NON-folder tile lands in the containing surface', () => {
		document.body.innerHTML = `
			<div class="os-files-layer" data-folder-id="0">
				<button class="os-file-tile" data-file-type="post" data-file-ref="13" id="target"></button>
			</div>`;
		const ctx = classifyDropTarget( dropOn( document.getElementById( 'target' )! ) );
		expect( ctx.surface ).toBe( 'wallpaper' );
	} );

	test( 'root files layer classifies as wallpaper', () => {
		document.body.innerHTML = `
			<div class="os-files-layer" data-folder-id="0"><span id="target"></span></div>`;
		const ctx = classifyDropTarget( dropOn( document.getElementById( 'target' )! ) );
		expect( ctx.surface ).toBe( 'wallpaper' );
		expect( ctx.folderId ).toBeUndefined();
	} );

	test( 'non-folder windows still classify as window', () => {
		document.body.innerHTML = `
			<div class="os-window" id="wp-window-desktop-mode-posts"><span id="target"></span></div>`;
		const ctx = classifyDropTarget( dropOn( document.getElementById( 'target' )! ) );
		expect( ctx.surface ).toBe( 'window' );
		expect( ctx.windowId ).toBe( 'desktop-mode-posts' );
		expect( ctx.folderId ).toBeUndefined();
	} );

	test( 'iframe drops resolve their window id from the wp-window- root', () => {
		document.body.innerHTML = `
			<div class="os-window" id="wp-window-os-media">
				<iframe id="target"></iframe>
			</div>`;
		const ctx = classifyDropTarget( dropOn( document.getElementById( 'target' )! ) );
		expect( ctx.surface ).toBe( 'iframe' );
		expect( ctx.windowId ).toBe( 'os-media' );
	} );
} );
