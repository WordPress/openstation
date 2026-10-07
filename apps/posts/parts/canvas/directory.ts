import { __, _n, html, sprintf } from '@openstation/app';
import { render } from '../../../../src/ui/core';
import '../../../../src/ui/components/os-button/os-button';
import '../../../../src/ui/components/os-text-field/os-text-field';
import '../../../../src/ui/components/os-select/os-select';
import { decodeHTML } from '../../../../src/utils';
import type { TermRow } from '../types';
import type { CanvasChrome } from './chrome';

export function directoryTerms( terms: TermRow[], search: string, unused: boolean ): TermRow[] {
	const q = search.trim().toLocaleLowerCase();
	return terms.filter( ( term ) => ( ! unused || term.count === 0 ) && decodeHTML( term.name ).toLocaleLowerCase().includes( q ) )
		.sort( ( a, b ) => decodeHTML( a.name ).localeCompare( decodeHTML( b.name ) ) );
}

export function mountTermDirectory( chrome: CanvasChrome, terms: () => TermRow[], select: ( id: number ) => void ): () => void {
	const toggle = document.createElement( 'os-button' );
	toggle.setAttribute( 'variant', 'secondary' );
	toggle.textContent = __( 'Browse topics' );
	toggle.className = 'os-term-directory__toggle';
	chrome.toolbar.insertBefore( toggle, chrome.searchWrap );
	const panel = document.createElement( 'section' );
	panel.className = 'os-term-directory';
	panel.setAttribute( 'aria-label', __( 'Topic directory' ) );
	panel.hidden = true;
	chrome.stage.appendChild( panel );
	let query = '';
	let unused = false;
	let limit = 50;
	const focusToggle = (): void => toggle.shadowRoot?.querySelector< HTMLButtonElement >( 'button' )?.focus();
	const close = (): void => {
		panel.hidden = true;
		toggle.setAttribute( 'aria-expanded', 'false' );
		toggle.shadowRoot?.querySelector( 'button' )?.setAttribute( 'aria-expanded', 'false' );
		focusToggle();
	};
	const paint = (): void => {
		const all = terms();
		const matches = directoryTerms( all, query, unused );
		render( html`<header><h3>${ __( 'Your topics' ) }</h3><os-button variant="ghost" @click=${ close }>${ __( 'Close' ) }</os-button></header>
			<os-text-field label=${ __( 'Find a topic' ) } value=${ query } placeholder=${ __( 'Find a topic…' ) }
				@os-input-change=${ ( e: Event ) => {
 query = ( e as CustomEvent ).detail.value; limit = 50; paint();
} }></os-text-field>
			<os-select label=${ __( 'Show topics' ) } value=${ unused ? 'unused' : 'all' }
				@os-pick=${ ( e: Event ) => {
 unused = ( e as CustomEvent ).detail.value === 'unused'; limit = 50; paint();
} }>
				<os-option value="all">${ __( 'All topics' ) }</os-option><os-option value="unused">${ __( 'No posts yet' ) }</os-option>
			</os-select>
			<p class="os-term-directory__count" role="status">${ sprintf( _n( '%d topic', '%d topics', matches.length ), matches.length ) }</p>
			<div class="os-term-directory__items">${ matches.slice( 0, limit ).map( ( term ) => html`<os-button variant="ghost" data-topic-id=${ term.id } @click=${ () => {
 close(); select( term.id );
} }><span>${ decodeHTML( term.name ) }</span><small>${ sprintf( _n( '%d post', '%d posts', term.count ), term.count ) }</small></os-button>` ) }
				${ matches.length === 0 ? html`<p>${ __( 'No matching topics. Try another search or filter.' ) }</p>` : '' }
				${ matches.length > limit ? html`<os-button variant="secondary" @click=${ () => {
 limit += 50; paint();
} }>${ __( 'Show more' ) }</os-button>` : '' }
			</div>`, panel );
	};
	const open = (): void => {
		if ( ! panel.hidden ) {
			close(); return;
		}
		paint();
		panel.hidden = false;
		toggle.setAttribute( 'aria-expanded', 'true' );
		toggle.shadowRoot?.querySelector( 'button' )?.setAttribute( 'aria-expanded', 'true' );
		queueMicrotask( () => panel.querySelector( 'os-text-field' )?.shadowRoot?.querySelector< HTMLInputElement >( 'input' )?.focus() );
	};
	const escape = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' ) {
			e.stopPropagation(); close();
		}
	};
	toggle.addEventListener( 'click', open );
	panel.addEventListener( 'keydown', escape );
	return () => {
		toggle.removeEventListener( 'click', open );
		panel.removeEventListener( 'keydown', escape );
		toggle.remove();
		panel.remove();
	};
}
