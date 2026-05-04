/**
 * Phase E tests — iframe → parent chrome bridge.
 *
 * The parent's `handleWindowMessage` routes three new message types
 * (`desktop-mode-chrome-theme/controls/slot`) to the matching
 * `Window.setAppearance*` methods. These tests stub a Window-shaped
 * receiver, post each message, and assert the right setter fired
 * with the right payload.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import { handleWindowMessage } from '../../src/window/iframe-bridge';

/**
 * Build a Window-shaped fake whose only job is to capture the
 * setAppearance* call that the bridge dispatches. The bridge's
 * origin gate compares against `window.location.origin`, and its
 * source gate compares against `win.iframe.contentWindow` — we
 * spoof the iframe with a contentWindow stub matching `event.source`.
 */
function buildFakeWindow() {
	const setAppearanceTheme = vi.fn();
	const setAppearanceControls = vi.fn();
	const setAppearanceSlot = vi.fn();
	const fakeContentWindow = {} as Window;
	return {
		win: {
			id: 'edit-post',
			iframe: { contentWindow: fakeContentWindow } as unknown as HTMLIFrameElement,
			setAppearanceTheme,
			setAppearanceControls,
			setAppearanceSlot,
			// Fields the bridge inspects but doesn't use in these tests.
			setTitle: vi.fn(),
		},
		fakeContentWindow,
		spies: { setAppearanceTheme, setAppearanceControls, setAppearanceSlot },
	};
}

function postFrom( source: Window, data: unknown ): MessageEvent {
	return new MessageEvent( 'message', {
		origin: window.location.origin,
		source,
		data,
	} );
}

beforeEach( () => {
	installHooksStub();
} );

afterEach( () => {
	clearHooksStub();
} );

describe( 'iframe-bridge — chrome messages', () => {
	test( 'desktop-mode-chrome-theme dispatches setAppearanceTheme(tokens)', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = postFrom( fakeContentWindow, {
			type: 'desktop-mode-chrome-theme',
			tokens: {
				'--desktop-mode-titlebar-bg': '#101820',
			},
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceTheme ).toHaveBeenCalledWith( {
			'--desktop-mode-titlebar-bg': '#101820',
		} );
	} );

	test( 'desktop-mode-chrome-controls dispatches setAppearanceControls(config)', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = postFrom( fakeContentWindow, {
			type: 'desktop-mode-chrome-controls',
			config: { hide: [ 'core/detach' ] },
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceControls ).toHaveBeenCalledWith( {
			hide: [ 'core/detach' ],
		} );
	} );

	test( 'desktop-mode-chrome-slot dispatches setAppearanceSlot(name, { html })', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = postFrom( fakeContentWindow, {
			type: 'desktop-mode-chrome-slot',
			slot: 'after-title',
			html: 'BETA',
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceSlot ).toHaveBeenCalledWith(
			'after-title',
			{ html: 'BETA' },
		);
	} );

	test( 'foreign origin is ignored', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = new MessageEvent( 'message', {
			origin: 'https://attacker.test',
			source: fakeContentWindow,
			data: {
				type: 'desktop-mode-chrome-theme',
				tokens: { '--bad': '1' },
			},
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceTheme ).not.toHaveBeenCalled();
	} );

	test( 'message from a different iframe (wrong source) is ignored', () => {
		const { win, spies } = buildFakeWindow();
		const otherSource = {} as Window;
		const ev = postFrom( otherSource, {
			type: 'desktop-mode-chrome-theme',
			tokens: { '--x': '1' },
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceTheme ).not.toHaveBeenCalled();
	} );

	test( 'malformed payload (missing tokens) is rejected', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = postFrom( fakeContentWindow, {
			type: 'desktop-mode-chrome-theme',
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceTheme ).not.toHaveBeenCalled();
	} );
} );
