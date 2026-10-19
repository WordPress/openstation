/**
 * Tests for the Bug Report native window — primarily the
 * GitHub-issue URL builder. The render path is covered by a small
 * integration test that confirms the form's structure.
 *
 * @group bug-report
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	buildGithubIssueUrl,
	composeSupportTopic,
	renderBugReport,
	SUPPORT_FORUM_URL,
} from '../../src/bug-report';

beforeEach( () => {
	// `collectMetadata()` reads navigator + window.location; jsdom
	// gives both deterministic values, so no setup needed beyond a
	// clean DOM.
	document.body.innerHTML = '';
} );

afterEach( () => {
	document.body.innerHTML = '';
} );

describe( 'buildGithubIssueUrl', () => {
	test( 'targets WordPress/openstation/issues/new', () => {
		const url = buildGithubIssueUrl( {
			type: 'bug',
			title: 'Something is broken',
			description: 'I expected X, got Y.',
			steps: '',
		} );
		expect( url.startsWith( 'https://github.com/WordPress/openstation/issues/new?' ) ).toBe(
			true,
		);
	} );

	test( 'encodes title + body + labels into query params', () => {
		const url = buildGithubIssueUrl( {
			type: 'bug',
			title: 'Window does not close',
			description: 'Closing leaves a ghost element.',
			steps: '1. open\n2. close',
		} );
		const params = new URL( url ).searchParams;
		expect( params.get( 'title' ) ).toBe( 'Window does not close' );
		expect( params.get( 'labels' ) ).toBe( 'bug' );
		const body = params.get( 'body' ) ?? '';
		expect( body ).toContain( 'Closing leaves a ghost element.' );
		expect( body ).toContain( '## Steps to reproduce' );
		expect( body ).toContain( '1. open' );
		expect( body ).toContain( '<details><summary>Environment</summary>' );
	} );

	test( 'omits "Steps to reproduce" section for non-bug types', () => {
		const url = buildGithubIssueUrl( {
			type: 'feature',
			title: 'Add dark mode',
			description: 'Auto-switch with the OS preference.',
			steps: '',
		} );
		const params = new URL( url ).searchParams;
		expect( params.get( 'labels' ) ).toBe( 'enhancement' );
		expect( params.get( 'body' ) ?? '' ).not.toContain( '## Steps to reproduce' );
	} );

	test( 'truncates oversized bodies with a note', () => {
		// GitHub URLs cap around 8KB; we cap body at ~6KB for safety.
		// Feeding 20KB of text exercises the truncation branch.
		const huge = 'x'.repeat( 20_000 );
		const url = buildGithubIssueUrl( {
			type: 'bug',
			title: 'Long report',
			description: huge,
			steps: '',
		} );
		const body = new URL( url ).searchParams.get( 'body' ) ?? '';
		expect( body.length ).toBeLessThan( 6_200 );
		expect( body ).toContain( 'truncated' );
	} );

	test( 'maps the three types to expected labels', () => {
		const labelFor = ( type: 'bug' | 'feature' | 'question' ): string =>
			new URL(
				buildGithubIssueUrl( {
					type,
					title: 't',
					description: 'd',
					steps: '',
				} ),
			).searchParams.get( 'labels' ) ?? '';
		expect( labelFor( 'bug' ) ).toBe( 'bug' );
		expect( labelFor( 'feature' ) ).toBe( 'enhancement' );
		expect( labelFor( 'question' ) ).toBe( 'question' );
	} );
} );

describe( 'renderBugReport', () => {
	test( 'renders the form with all expected fields', () => {
		const body = document.createElement( 'div' );
		document.body.appendChild( body );
		renderBugReport( body );

		expect( body.querySelector( '.os-bug-report__form' ) ).not.toBeNull();
		expect(
			body.querySelectorAll( 'input[ name = "type" ]' ).length,
		).toBe( 3 );
		expect( body.querySelector( 'input[ name = "title" ]' ) ).not.toBeNull();
		expect( body.querySelector( 'textarea[ name = "description" ]' ) ).not.toBeNull();
		expect( body.querySelector( 'textarea[ name = "steps" ]' ) ).not.toBeNull();
		expect( body.querySelector( '.os-bug-report__submit' ) ).not.toBeNull();
		expect( body.querySelector( '.os-bug-report__metadata' ) ).not.toBeNull();
	} );

	test( 'shows an inline error when title or description is empty', () => {
		const body = document.createElement( 'div' );
		document.body.appendChild( body );
		renderBugReport( body );

		const form = body.querySelector< HTMLFormElement >(
			'.os-bug-report__form',
		)!;
		// jsdom's HTMLFormElement.requestSubmit isn't always
		// implemented; fire `submit` directly so the handler runs.
		form.dispatchEvent( new Event( 'submit', { cancelable: true } ) );

		expect( body.querySelector( '.os-bug-report__error' ) ).not.toBeNull();
	} );
} );

describe( 'questions go to the WordPress.org support forum', () => {
	function renderFilled( type: 'bug' | 'feature' | 'question' ): HTMLFormElement {
		const body = document.createElement( 'div' );
		document.body.appendChild( body );
		renderBugReport( body );
		const form = body.querySelector< HTMLFormElement >( '.os-bug-report__form' )!;
		form.querySelector< HTMLInputElement >( `input[ name = "type" ][ value = "${ type }" ]` )!.checked = true;
		form.dispatchEvent( new Event( 'change' ) );
		form.querySelector< HTMLInputElement >( 'input[ name = "title" ]' )!.value = 'How do I pin a note?';
		form.querySelector< HTMLTextAreaElement >( 'textarea[ name = "description" ]' )!.value = 'I cannot find the Note Pad.';
		return form;
	}

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	test( 'the forum URL points at the desktop-mode support forum', () => {
		expect( SUPPORT_FORUM_URL ).toBe( 'https://wordpress.org/support/plugin/desktop-mode/#new-topic-0' );
	} );

	test( 'the submit button names the destination for the selected type', () => {
		const form = renderFilled( 'question' );
		const submit = form.querySelector( '.os-bug-report__submit' )!;
		expect( submit.textContent ).toBe( 'Ask on the WordPress.org support forum' );

		form.querySelector< HTMLInputElement >( 'input[ name = "type" ][ value = "bug" ]' )!.checked = true;
		form.dispatchEvent( new Event( 'change' ) );
		expect( submit.textContent ).toBe( 'Open issue on GitHub' );
	} );

	test( 'submitting a question copies it and opens the forum', () => {
		const open = vi.spyOn( window, 'open' ).mockReturnValue( null );
		const writeText = vi.fn().mockResolvedValue( undefined );
		Object.defineProperty( navigator, 'clipboard', { value: { writeText }, configurable: true } );

		const form = renderFilled( 'question' );
		form.dispatchEvent( new Event( 'submit', { cancelable: true } ) );

		expect( open ).toHaveBeenCalledWith( SUPPORT_FORUM_URL, '_blank', 'noopener' );
		expect( writeText ).toHaveBeenCalledTimes( 1 );
		expect( writeText.mock.calls[ 0 ][ 0 ] ).toContain( 'How do I pin a note?' );
	} );

	test( 'submitting a bug still opens a GitHub issue', () => {
		const open = vi.spyOn( window, 'open' ).mockReturnValue( null );

		const form = renderFilled( 'bug' );
		form.dispatchEvent( new Event( 'submit', { cancelable: true } ) );

		expect( String( open.mock.calls[ 0 ][ 0 ] ) ).toMatch( /^https:\/\/github\.com\/WordPress\/openstation\/issues\/new\?/ );
	} );

	test( 'composeSupportTopic puts title, description and environment in plain text', () => {
		const text = composeSupportTopic( {
			type: 'question',
			title: '  How do I pin a note?  ',
			description: 'I cannot find the Note Pad.',
			steps: '',
		} );
		const lines = text.split( '\n' );
		expect( lines[ 0 ] ).toBe( 'How do I pin a note?' );
		expect( text ).toContain( 'I cannot find the Note Pad.' );
		expect( text ).toContain( 'Environment:' );
		expect( text ).toContain( 'Plugin version:' );
		expect( text ).not.toContain( '<details>' );
	} );
} );
