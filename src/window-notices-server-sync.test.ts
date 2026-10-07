import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	listWindowNotices,
	registerWindowNotice,
	_resetWindowNoticesForTests,
} from './window-notices';
import { applyServerWindowNotices } from './window-notices-server-sync';
import { slotsForWindow } from './window-chrome/slots/registry';
import type { Window as DesktopWindow } from './window';
import type { DesktopWindowNoticeServerEntry } from './types';

function fakeWindow(
	id: string,
	url: string = '',
): DesktopWindow {
	return {
		id,
		config: { id, url, title: id, icon: 'dashicons-admin-generic' },
	} as unknown as DesktopWindow;
}

function matcherFor( noticeId: string ) {
	const slotId = `os-notice/${ noticeId }`;

	return ( win: DesktopWindow ) =>
		slotsForWindow( win, 'after-titlebar' ).some( ( def ) => def.id === slotId );
}

describe( 'window-notices-server-sync — buildMatcher', () => {
	beforeEach( () => {
		_resetWindowNoticesForTests();
	} );
	afterEach( () => {
		_resetWindowNoticesForTests();
	} );

	test( 'no match → renders on every window', () => {
		applyServerWindowNotices( [
			{
				id: 'plugin/everywhere',
				message: 'Hello',
				tone: 'info',
				dismissible: true,
			},
		] );
		const matches = matcherFor( 'plugin/everywhere' );
		expect( matches( fakeWindow( 'edit-php' ) ) ).toBe( true );
		expect( matches( fakeWindow( 'plugins' ) ) ).toBe( true );
		expect( matches( fakeWindow( 'whatever' ) ) ).toBe( true );
	} );

	test( 'window selector matches only the named id', () => {
		applyServerWindowNotices( [
			{
				id: 'plugin/posts-only',
				message: 'Hi',
				tone: 'info',
				dismissible: true,
				match: { window: 'edit-php' },
			},
		] );
		const matches = matcherFor( 'plugin/posts-only' );
		expect( matches( fakeWindow( 'edit-php' ) ) ).toBe( true );
		expect( matches( fakeWindow( 'plugins' ) ) ).toBe( false );
	} );

	test( 'windows array selector matches any of the listed ids (OR)', () => {
		applyServerWindowNotices( [
			{
				id: 'plugin/content',
				message: 'Hi',
				tone: 'info',
				dismissible: true,
				match: { windows: [ 'edit-php', 'edit-php-page', 'upload-php' ] },
			},
		] );
		const matches = matcherFor( 'plugin/content' );
		expect( matches( fakeWindow( 'edit-php' ) ) ).toBe( true );
		expect( matches( fakeWindow( 'edit-php-page' ) ) ).toBe( true );
		expect( matches( fakeWindow( 'upload-php' ) ) ).toBe( true );
		expect( matches( fakeWindow( 'plugins' ) ) ).toBe( false );
	} );

	test( 'window + windows are unioned into a single OR set', () => {
		applyServerWindowNotices( [
			{
				id: 'plugin/union',
				message: 'Hi',
				tone: 'info',
				dismissible: true,
				match: { window: 'edit-php', windows: [ 'plugins' ] },
			},
		] );
		const matches = matcherFor( 'plugin/union' );
		expect( matches( fakeWindow( 'edit-php' ) ) ).toBe( true );
		expect( matches( fakeWindow( 'plugins' ) ) ).toBe( true );
		expect( matches( fakeWindow( 'upload-php' ) ) ).toBe( false );
	} );

	test( 'urlContains selector matches case-insensitively', () => {
		applyServerWindowNotices( [
			{
				id: 'plugin/wc',
				message: 'Hi',
				tone: 'info',
				dismissible: true,
				match: { urlContains: 'WC-ADMIN' },
			},
		] );
		const matches = matcherFor( 'plugin/wc' );
		expect(
			matches(
				fakeWindow( 'whatever', 'http://example.com/wp-admin/admin.php?page=wc-admin' ),
			),
		).toBe( true );
		expect(
			matches(
				fakeWindow( 'whatever', 'http://example.com/wp-admin/edit.php' ),
			),
		).toBe( false );
	} );

	test( 'urlContains tolerates an empty config.url', () => {
		applyServerWindowNotices( [
			{
				id: 'plugin/wc-strict',
				message: 'Hi',
				tone: 'info',
				dismissible: true,
				match: { urlContains: 'wc-admin' },
			},
		] );
		const matches = matcherFor( 'plugin/wc-strict' );
		expect( matches( fakeWindow( 'no-url' ) ) ).toBe( false );
	} );

	test( 'id selector + urlContains are AND-ed', () => {
		applyServerWindowNotices( [
			{
				id: 'plugin/wc-posts',
				message: 'Hi',
				tone: 'info',
				dismissible: true,
				match: { window: 'edit-php', urlContains: 'wc-admin' },
			},
		] );
		const matches = matcherFor( 'plugin/wc-posts' );

		expect(
			matches(
				fakeWindow( 'edit-php', 'http://example.com/wp-admin/edit.php?page=wc-admin' ),
			),
		).toBe( true );

		expect(
			matches(
				fakeWindow( 'plugins', 'http://example.com/wp-admin/plugins.php?page=wc-admin' ),
			),
		).toBe( false );

		expect(
			matches(
				fakeWindow( 'edit-php', 'http://example.com/wp-admin/edit.php' ),
			),
		).toBe( false );
	} );
} );

describe( 'window-notices-server-sync — applyServerWindowNotices', () => {
	beforeEach( () => {
		_resetWindowNoticesForTests();
	} );
	afterEach( () => {
		_resetWindowNoticesForTests();
	} );

	test( 'adds entries on first call', () => {
		const initial: DesktopWindowNoticeServerEntry[] = [
			{
				id: 'plugin/a',
				message: 'A',
				tone: 'info',
				dismissible: true,
			},
			{
				id: 'plugin/b',
				message: 'B',
				tone: 'warning',
				dismissible: false,
			},
		];
		applyServerWindowNotices( initial );

		const list = listWindowNotices().map( ( e ) => e.id );
		expect( list ).toContain( 'plugin/a' );
		expect( list ).toContain( 'plugin/b' );
	} );

	test( 'updates an existing entry when the message changes', () => {
		applyServerWindowNotices( [
			{ id: 'plugin/c', message: 'old', tone: 'info', dismissible: true },
		] );
		applyServerWindowNotices( [
			{ id: 'plugin/c', message: 'new', tone: 'warning', dismissible: false },
		] );

		const entry = listWindowNotices().find( ( e ) => e.id === 'plugin/c' );
		expect( entry ).toBeDefined();
		expect( entry!.message ).toBe( 'new' );
		expect( entry!.tone ).toBe( 'warning' );
		expect( entry!.dismissible ).toBe( false );
	} );

	test( 'drops server entries no longer in the payload', () => {
		applyServerWindowNotices( [
			{ id: 'plugin/keep', message: 'K', tone: 'info', dismissible: true },
			{ id: 'plugin/drop', message: 'D', tone: 'info', dismissible: true },
		] );
		applyServerWindowNotices( [
			{ id: 'plugin/keep', message: 'K', tone: 'info', dismissible: true },
		] );

		const ids = listWindowNotices().map( ( e ) => e.id );
		expect( ids ).toContain( 'plugin/keep' );
		expect( ids ).not.toContain( 'plugin/drop' );
	} );

	test( 'JS-registered (non-server) entries survive a server sync', () => {
		registerWindowNotice( {
			id: 'plugin/js',
			message: 'JS',
			tone: 'info',
		} );

		applyServerWindowNotices( [
			{ id: 'plugin/server', message: 'S', tone: 'info', dismissible: true },
		] );
		applyServerWindowNotices( [] );

		const ids = listWindowNotices().map( ( e ) => e.id );
		expect( ids ).toContain( 'plugin/js' );
		expect( ids ).not.toContain( 'plugin/server' );
	} );

	test( 'ignores entries with missing or non-string id', () => {
		applyServerWindowNotices( [

			{ id: '', message: 'x', tone: 'info', dismissible: true },

			{ message: 'x', tone: 'info', dismissible: true } as unknown as Parameters< typeof applyServerWindowNotices >[ 0 ][ number ],
			{ id: 'plugin/ok', message: 'ok', tone: 'info', dismissible: true },
		] );

		const ids = listWindowNotices().map( ( e ) => e.id );
		expect( ids ).toEqual( [ 'plugin/ok' ] );
	} );
} );
