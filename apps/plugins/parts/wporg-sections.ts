/**
 * Plugins app — the Changelog and FAQ sections of a wp.org payload.
 *
 * Part of the `desktop-mode-plugins` client view. wp.org ships both
 * as loose HTML — `<h4>1.2.3</h4>` or `= 1.2.3 =` headings for a
 * changelog, malformed `<dt>Question</h4><p>Answer` for a FAQ — so the
 * detail panel parses them into version cards and an accordion, and
 * falls back to the sanitised HTML when no structure is found.
 *
 * @public
 */

import { __ } from '@openstation/app';
import { osIconSvg } from '../../../src/ui/icons';
// Painted inside `<os-table>`'s shadow root — the tags register here.
import '../../../src/ui/components/os-badge/os-badge';
import '../../../src/ui/components/os-card/os-card';
import '../../../src/ui/components/os-stack/os-stack';
import { escapeHtml, htmlBlock, parseHtml } from './html';
import { emptyState, loadingLine } from './reviews';
import type { WpOrgPluginInfo } from './types';

export interface ChangelogEntry {
	version: string;
	body: string;
}

export interface FaqPair {
	question: string;
	answer: string;
}

const detailHtml = ( html: string ): HTMLElement => htmlBlock( html, 'os-plugins__detail-html' );

/**
 * Group nodes under each recognised version heading (an `<hN>` whose
 * text carries a version number, `=` fences stripped). No heading
 * means an empty list, and the caller shows the plain HTML.
 */
export function parseChangelogEntries( html: string ): ChangelogEntry[] {
	const body = parseHtml( html );
	const entries: ChangelogEntry[] = [];
	let current: { version: string; html: string } | null = null;
	const versionRegex = /([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[\w.+-]*)?)/;
	const flush = (): void => {
		if ( current ) {
			entries.push( { version: current.version, body: current.html.trim() } );
			current = null;
		}
	};
	for ( const node of Array.from( body.childNodes ) ) {
		if ( node.nodeType === Node.ELEMENT_NODE ) {
			const el = node as Element;
			const isHeading = /^H[1-6]$/.test( el.tagName );
			const cleaned = ( el.textContent ?? '' ).trim().replace( /^=+\s*|\s*=+$/g, '' ).trim();
			if ( isHeading && versionRegex.test( cleaned ) ) {
				flush();
				current = { version: cleaned, html: '' };
				continue;
			}
			if ( current ) {
				current.html += el.outerHTML;
			}
			continue;
		}
		if ( node.nodeType === Node.TEXT_NODE && current ) {
			appendText( current, node.textContent ?? '' );
		}
	}
	flush();
	return entries;
}

function appendText( current: { html: string }, text: string ): void {
	if ( text.trim() === '' ) {
		if ( current.html !== '' ) {
			current.html += text;
		}
		return;
	}
	current.html += `<p>${ escapeHtml( text ) }</p>`;
}

/**
 * wp.org ships MALFORMED HTML for FAQ: `<dt>Question</h4><p><p>Answer…`
 * — the HTML5 parser opens a `<dt>`, ignores the stray close tag, and
 * files the answer paragraphs as children of the `<dt>` until the next
 * `<dt>`. Strategy 1 splits every top-level `<dt>` on its first child
 * element. Real `<dl><dt>…</dt><dd>…</dd></dl>` pairs and conventional
 * `<h4>Q</h4><p>A</p>` siblings are handled as fallbacks.
 */
export function parseFaqPairs( html: string ): FaqPair[] {
	const body = parseHtml( html );

	const dts = Array.from( body.querySelectorAll( ':scope > dt' ) );
	if ( dts.length > 0 ) {
		return dts.map( splitDtIntoPair ).filter( ( p ) => p.question !== '' );
	}

	const dl = body.querySelector( ':scope > dl' );
	if ( dl ) {
		const pairs: FaqPair[] = [];
		let current: { q: string; html: string } | null = null;
		for ( const node of Array.from( dl.children ) ) {
			if ( node.tagName === 'DT' ) {
				if ( current ) {
					pairs.push( { question: current.q, answer: current.html.trim() } );
				}
				current = { q: ( node.textContent ?? '' ).trim(), html: '' };
			} else if ( current ) {
				current.html += node.tagName === 'DD' ? node.innerHTML : node.outerHTML;
			}
		}
		if ( current ) {
			pairs.push( { question: current.q, answer: current.html.trim() } );
		}
		return pairs.filter( ( p ) => p.question !== '' );
	}

	const pairs: FaqPair[] = [];
	let current: { q: string; html: string } | null = null;
	const flush = (): void => {
		if ( current ) {
			pairs.push( { question: current.q, answer: current.html.trim() } );
			current = null;
		}
	};
	for ( const node of Array.from( body.childNodes ) ) {
		if ( node.nodeType === Node.ELEMENT_NODE ) {
			const el = node as Element;
			const text = ( el.textContent ?? '' ).trim();
			if ( /^H[1-6]$/.test( el.tagName ) && text ) {
				flush();
				current = { q: text, html: '' };
				continue;
			}
			if ( current ) {
				current.html += el.outerHTML;
			}
			continue;
		}
		if ( node.nodeType === Node.TEXT_NODE && current ) {
			appendText( current, node.textContent ?? '' );
		}
	}
	flush();
	return pairs.filter( ( p ) => p.question !== '' );
}

/** Leading text is the question; from the first substantive element on, the answer. */
function splitDtIntoPair( dt: Element ): FaqPair {
	let question = '';
	let answerHtml = '';
	let seenElement = false;
	for ( const child of Array.from( dt.childNodes ) ) {
		if ( child.nodeType === Node.TEXT_NODE ) {
			const txt = child.textContent ?? '';
			if ( ! seenElement ) {
				question += txt;
			} else if ( txt.trim() !== '' ) {
				answerHtml += `<p>${ escapeHtml( txt ) }</p>`;
			}
			continue;
		}
		if ( child.nodeType !== Node.ELEMENT_NODE ) {
			continue;
		}
		const el = child as Element;
		// Empty `<p></p>` fragments left by the broken nesting.
		if ( el.tagName === 'P' && ( el.textContent ?? '' ).trim() === '' ) {
			continue;
		}
		seenElement = true;
		answerHtml += el.outerHTML;
	}
	return { question: question.replace( /\s+/g, ' ' ).trim(), answer: answerHtml.trim() };
}

/** The Changelog tab: a card per version, the latest badged. */
export function renderChangelog( info: WpOrgPluginInfo | null ): HTMLElement {
	if ( ! info ) {
		return loadingLine( __( 'Loading from WordPress.org…', 'desktop-mode' ) );
	}
	const html = info.sections?.changelog;
	if ( ! html ) {
		return emptyState( 'list-view', __( 'No changelog', 'desktop-mode' ), __( 'This plugin doesn’t ship a changelog.', 'desktop-mode' ) );
	}
	const entries = parseChangelogEntries( html );
	if ( entries.length === 0 ) {
		return detailHtml( html );
	}
	const stack = document.createElement( 'os-stack' );
	stack.setAttribute( 'gap', '12' );
	stack.className = 'os-plugins__detail-changelog';
	entries.forEach( ( entry, i ) => {
		const card = document.createElement( 'os-card' );
		card.className = 'os-plugins__detail-changelog-entry';
		const head = document.createElement( 'div' );
		head.setAttribute( 'slot', 'header' );
		head.className = 'os-plugins__detail-changelog-head';
		const ver = document.createElement( 'os-badge' );
		ver.setAttribute( 'tone', i === 0 ? 'success' : 'neutral' );
		ver.textContent = entry.version;
		head.appendChild( ver );
		if ( i === 0 ) {
			const latest = document.createElement( 'span' );
			latest.className = 'os-plugins__detail-changelog-latest';
			latest.textContent = __( 'Latest', 'desktop-mode' );
			head.appendChild( latest );
		}
		card.appendChild( head );
		card.appendChild( detailHtml( entry.body ) );
		stack.appendChild( card );
	} );
	return stack;
}

/** The FAQ tab: an accordion, the first question open. */
export function renderFaq( info: WpOrgPluginInfo | null ): HTMLElement {
	if ( ! info ) {
		return loadingLine( __( 'Loading from WordPress.org…', 'desktop-mode' ) );
	}
	const html = info.sections?.faq;
	if ( ! html ) {
		return emptyState( 'editor-help', __( 'No FAQ', 'desktop-mode' ), __( 'This plugin doesn’t ship an FAQ.', 'desktop-mode' ) );
	}
	const pairs = parseFaqPairs( html );
	if ( pairs.length === 0 ) {
		return detailHtml( html );
	}
	const stack = document.createElement( 'os-stack' );
	stack.setAttribute( 'gap', '8' );
	stack.className = 'os-plugins__detail-faq';
	pairs.forEach( ( pair, i ) => {
		const item = document.createElement( 'details' );
		item.className = 'os-plugins__detail-faq-item';
		if ( i === 0 ) {
			item.setAttribute( 'open', '' );
		}
		const summary = document.createElement( 'summary' );
		summary.className = 'os-plugins__detail-faq-q';
		const qText = document.createElement( 'span' );
		qText.className = 'os-plugins__detail-faq-q-text';
		qText.textContent = pair.question;
		const chevron = document.createElement( 'span' );
		chevron.className = 'os-plugins__detail-faq-chevron';
		chevron.setAttribute( 'aria-hidden', 'true' );
		chevron.innerHTML = osIconSvg( 'chevron-right', { size: 16, rotate: 90 } );
		summary.append( qText, chevron );
		const body = detailHtml( pair.answer );
		body.classList.add( 'os-plugins__detail-faq-a' );
		item.append( summary, body );
		stack.appendChild( item );
	} );
	return stack;
}
