/**
 * Focus behaviour of the first-run intro dialogs.
 *
 * Five windows ship one, and they are the shell's only modals built
 * from hand-written light DOM rather than from `<os-modal>` — so the
 * guarantee that they behave like modals is a thing to pin, once,
 * across all of them. Each is driven through the same table: focus
 * opens inside, Tab cannot leave, and dismissal lands the user in the
 * window the dialog was introducing rather than on `<body>`.
 *
 * The Posts dialog additionally mounts a PixiJS canvas. It does that
 * behind `wp.os.loadModules`, which is absent here, so the mount
 * rejects and the dialog falls back to static markup — which is the
 * path this file wants anyway.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { showPostsIntroDialog } from '../../src/posts-window/intro-dialog';
import { showPagesIntroDialog } from '../../src/posts-window/pages-intro-dialog';
import { showUsersIntroDialog } from '../../src/posts-window/users-intro-dialog';
import { showPluginsIntroDialog } from '../../src/plugins-window/intro-dialog';
import { showCommentsIntroDialog } from '../../src/comments-window/intro-dialog';

type IntroResult = 'confirm' | 'settings' | 'cancel';
type ShowDialog = (
	returnFocusTo?: HTMLElement | null,
) => Promise< IntroResult >;

const DIALOGS: Array< [ string, ShowDialog ] > = [
	[ 'Posts', showPostsIntroDialog ],
	[ 'Pages', showPagesIntroDialog ],
	[ 'Users', showUsersIntroDialog ],
	[ 'Plugins', showPluginsIntroDialog ],
	[ 'Comments', showCommentsIntroDialog ],
];

function pressEscape(): void {
	document.dispatchEvent(
		new KeyboardEvent( 'keydown', {
			key: 'Escape',
			bubbles: true,
			cancelable: true,
		} ),
	);
}

function pressTab( shiftKey = false ): void {
	document.dispatchEvent(
		new KeyboardEvent( 'keydown', {
			key: 'Tab',
			shiftKey,
			bubbles: true,
			cancelable: true,
		} ),
	);
}

/** The dialog element currently on screen, whichever window opened it. */
function openDialog(): HTMLElement {
	const el = document.querySelector< HTMLElement >( '[role="dialog"]' );
	if ( ! el ) {
		throw new Error( 'no dialog mounted' );
	}
	return el;
}

describe.each( DIALOGS )( '%s intro dialog', ( _name, show ) => {
	let windowRoot: HTMLElement;
	let behind: HTMLButtonElement;

	beforeEach( () => {
		document.body.innerHTML = '';
		behind = document.createElement( 'button' );
		behind.textContent = 'a control on the desk behind';
		windowRoot = document.createElement( 'div' );
		document.body.append( behind, windowRoot );
		behind.focus();
	} );

	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'opens with focus on a control inside the dialog', async () => {
		const result = show( windowRoot );
		const dialog = openDialog();
		const active = document.activeElement as HTMLElement;
		expect( dialog.contains( active ) ).toBe( true );
		expect( active.tagName ).toBe( 'BUTTON' );

		pressEscape();
		await expect( result ).resolves.toBe( 'cancel' );
	} );

	test( 'Tab cannot reach a control behind the dialog', async () => {
		const result = show( windowRoot );
		const dialog = openDialog();

		// Forwards off the end, and backwards off the front. Both wrap.
		for ( let i = 0; i < 4; i++ ) {
			pressTab();
		}
		expect( dialog.contains( document.activeElement ) ).toBe( true );
		for ( let i = 0; i < 4; i++ ) {
			pressTab( true );
		}
		expect( dialog.contains( document.activeElement ) ).toBe( true );

		pressEscape();
		await result;
	} );

	test( 'focus that lands behind the dialog is pulled back', async () => {
		const result = show( windowRoot );
		const dialog = openDialog();

		behind.focus();
		expect( dialog.contains( document.activeElement ) ).toBe( true );

		pressEscape();
		await result;
	} );

	test( 'Escape resolves cancel and returns focus to the window', async () => {
		const result = show( windowRoot );
		pressEscape();
		await expect( result ).resolves.toBe( 'cancel' );
		expect( document.querySelector( '[role="dialog"]' ) ).toBeNull();
		expect( document.activeElement ).toBe( windowRoot );
	} );

	test( 'the primary button resolves confirm and returns focus to the window', async () => {
		const result = show( windowRoot );
		( document.activeElement as HTMLButtonElement ).click();
		await expect( result ).resolves.toBe( 'confirm' );
		expect( document.activeElement ).toBe( windowRoot );
	} );

	test( 'without a return target, focus goes back to whatever opened it', async () => {
		const result = show();
		pressEscape();
		await result;
		expect( document.activeElement ).toBe( behind );
	} );
} );

/**
 * Nothing serialises the five intros: each window gates its own, so
 * opening two never-seen windows back to back — two dock clicks, or a
 * session restoring several windows — mounts two dialogs at once.
 * They have to stack rather than fight.
 */
describe( 'two intro dialogs open at once', () => {
	let postsRoot: HTMLElement;
	let usersRoot: HTMLElement;

	beforeEach( () => {
		document.body.innerHTML = '';
		postsRoot = document.createElement( 'div' );
		usersRoot = document.createElement( 'div' );
		document.body.append( postsRoot, usersRoot );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'the second dialog holds focus, and Escape closes one at a time', async () => {
		const posts = showPostsIntroDialog( postsRoot );
		const users = showUsersIntroDialog( usersRoot );

		const dialogs = document.querySelectorAll< HTMLElement >(
			'[role="dialog"]',
		);
		expect( dialogs ).toHaveLength( 2 );
		const [ postsDialog, usersDialog ] = Array.from( dialogs );

		// The one that opened last owns focus — and getting here at all
		// means the two scopes did not recurse into each other.
		expect( usersDialog.contains( document.activeElement ) ).toBe( true );

		// One Escape, one dismissal: the dialog behind must not be
		// closed — and marked seen — before the user has seen it.
		pressEscape();
		await expect( users ).resolves.toBe( 'cancel' );
		expect( document.body.contains( usersDialog ) ).toBe( false );
		expect( document.body.contains( postsDialog ) ).toBe( true );
		// Focus came forward to the dialog that is now frontmost.
		expect( postsDialog.contains( document.activeElement ) ).toBe( true );

		pressEscape();
		await expect( posts ).resolves.toBe( 'cancel' );
		expect( document.activeElement ).toBe( postsRoot );
	} );
} );
