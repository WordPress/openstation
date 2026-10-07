import '../../../src/ui/components';

import { __, html } from '@openstation/app';
import type { OsHelp } from '../../../src/ui/core';
import { OS_COMPONENT_TAGS } from '../../../src/ui/components/tags';
import { pickedValue, uiOf, type Ctx, type Section } from './types';

type CtorWithHelp = CustomElementConstructor & {
	help?: OsHelp;
	props?: readonly string[];
};

export interface ComponentEntry {
	tag: string;
	title: string;
	help: OsHelp | null;
	props: readonly string[];

	haystack: string;
}

function buildHaystack( tag: string, title: string, help: OsHelp | null, props: readonly string[] ): string {
	const parts: string[] = [ tag, title, ...props ];
	if ( help ) {
		parts.push( help.summary ?? '', help.status ?? '' );
		for ( const group of [ help.props, help.slots, help.events, help.parts, help.cssProps ] ) {
			for ( const entry of group ?? [] ) {
				const { name, description } = entry as { name?: string; description?: string };
				parts.push( name ?? '', description ?? '' );
			}
		}
	}
	return parts.join( ' ' ).toLowerCase();
}

function matchesQuery( entry: ComponentEntry, query: string ): boolean {
	const terms = query.toLowerCase().split( /\s+/ ).filter( Boolean );
	return terms.every( ( term ) => entry.haystack.includes( term ) );
}

function defaultTitleFromTag( tag: string ): string {
	const bare = tag.replace( /^os-/, '' ).replace( /-/g, ' ' );
	return bare.charAt( 0 ).toUpperCase() + bare.slice( 1 );
}

export function collectEntries(): ComponentEntry[] {
	const entries: ComponentEntry[] = [];
	for ( const tag of OS_COMPONENT_TAGS ) {
		const ctor = customElements.get( tag ) as CtorWithHelp | undefined;
		if ( ! ctor ) {
			continue;
		}
		const help = ctor.help ?? null;
		const title = help?.title ?? defaultTitleFromTag( tag );
		const props = ctor.props ?? [];
		entries.push( { tag, title, help, props, haystack: buildHaystack( tag, title, help, props ) } );
	}

	entries.sort( ( a, b ) => a.title.localeCompare( b.title ) );
	return entries;
}

const WARNER_DEMO_SNIPPET = [
	'                                                          ',
	'<os-example-console-fail-due-to-unregistered-component>',
	'</os-example-console-fail-due-to-unregistered-component>',
	'',
	'                                                     ',
	'<os-buton></os-buton>',
].join( '\n' );

let demoBannerLogged = false;

function logDemoBanner(): void {
	if ( demoBannerLogged ) {
		return;
	}
	demoBannerLogged = true;
	const headingStyle =
		'background: #ffb400;color: #1a1a1a;font-weight: 700;font-size: 12px;padding: 4px 8px;border-radius: 3px';
	const bodyStyle = 'color: #b25c00;font-weight: 500';

	console.log(
		'%c⚠ wp.os — INTENTIONAL DEMO%c\n' +
			'The next two console.error entries are fired ON PURPOSE by the\n' +
			'OpenStation Preferences → Components tab to demonstrate the <os-*> missing-\n' +
			'import warner. They are not real bugs.\n\n' +
			'  1. <os-example-console-fail-due-to-unregistered-component>\n' +
			'  2. <os-buton>   (typo of <os-button>)\n\n' +
			'Source: apps/os-settings/parts/components.ts — the "Missing-import\n' +
			'warner — live demo" section. Remove that section in your fork\n' +
			'if you want a quieter Components tab.',
		headingStyle,
		bodyStyle,
	);
}

const statusLabel = ( status: NonNullable< OsHelp[ 'status' ] > ): string => {
	switch ( status ) {
		case 'experimental':
			return __( 'Experimental' );
		case 'planned':
			return __( 'Planned' );
		default:
			return __( 'Stable' );
	}
};

const group = < T >( title: string, rows: readonly T[] | undefined, row: ( r: T ) => unknown ) =>
	rows?.length
		? html`<section class="os-settings__help-group">
			<h4>${ title }</h4>
			<ul class="os-settings__help-list">${ rows.map( ( r ) => html`<li>${ row( r ) }</li>` ) }</ul>
		</section>`
		: '';

const describe = ( text?: string ) => ( text ? html` — ${ text }` : '' );

function propsTable( entry: ComponentEntry ) {
	const documented = entry.help?.props ?? [];
	const names = new Set( documented.map( ( p ) => p.name ) );
	const undocumented = entry.props.filter( ( p ) => ! names.has( p ) );
	if ( documented.length === 0 && undocumented.length === 0 ) {
		return '';
	}
	return html`
		<section class="os-settings__help-group">
			<h4>${ __( 'Props' ) }</h4>
			<table class="os-settings__help-table">
				<thead>
					<tr>
						<th>${ __( 'Name' ) }</th>
						<th>${ __( 'Type' ) }</th>
						<th>${ __( 'Default' ) }</th>
						<th>${ __( 'Description' ) }</th>
					</tr>
				</thead>
				<tbody>
					${ documented.map(
						( p ) => html`<tr>
							<td><code>${ p.name }</code></td>
							<td>${ p.type ?? '—' }</td>
							<td>${ p.default ?? '—' }</td>
							<td>${ p.description ?? '' }</td>
						</tr>`,
					) }
					${ undocumented.map(
						( name ) => html`<tr>
							<td><code>${ name }</code></td>
							<td>—</td>
							<td>—</td>
							<td><em>${ __( 'Undocumented — declared via static props.' ) }</em></td>
						</tr>`,
					) }
				</tbody>
			</table>
		</section>
	`;
}

function detail( entry: ComponentEntry ) {
	const help = entry.help;
	const status = help?.status ?? 'stable';
	return html`
		<header class="os-settings__help-head">
			<h3 class="os-settings__help-title">${ entry.title }</h3>
			<code class="os-settings__help-code">&lt;${ entry.tag }&gt;</code>
			<span class="os-settings__help-badge is-${ status }">${ statusLabel( status ) }</span>
		</header>
		${ help?.summary ? html`<p class="os-settings__help-summary">${ help.summary }</p>` : '' }
		${ help?.example
			? html`<section class="os-settings__help-group">
				<h4>${ __( 'Example' ) }</h4>
				<div class="os-settings__help-example">${ help.example }</div>
			</section>`
			: '' }
		${ propsTable( entry ) }
		${ group( __( 'Slots' ), help?.slots, ( s ) => html`<code>${ s.name }</code>${ describe( s.description ) }` ) }
		${ group(
			__( 'Events' ),
			help?.events,
			( e ) => html`<code>${ e.name }</code>${ e.detail ? html` — <code>${ e.detail }</code>` : '' }${ describe( e.description ) }`,
		) }
		${ group( __( 'Shadow parts' ), help?.parts, ( p ) => html`<code>::part(${ p.name })</code>${ describe( p.description ) }` ) }
		${ group(
			__( 'CSS custom properties' ),
			help?.cssProps,
			( v ) => html`<code>${ v.name }</code>${ v.default ? html` (${ __( 'default' ) } <code>${ v.default }</code>)` : '' }${ describe( v.description ) }`,
		) }
		${ ! help
			? html`<p class="os-settings__help-note">
				${ __( 'This component has no help descriptor yet. Add `static help` to its class for a fuller reference.' ) }
			</p>`
			: '' }
	`;
}

const warnerDemo = () => html`
	<os-disclosure
		class="os-settings__help-warner-section"
		heading=${ __( 'Missing-import warner — live demo' ) }
		hint=${ __( 'Developer mode' ) }
	>
		<div class="os-settings__help-warner">
			<p class="os-settings__help-warner-text">
				${ __(
					'Both <os-*> tags in the next piece of code are intentionally bogus, one per answer the warner has. Open the browser console: within ~2 seconds you should see two console.error entries from the framework, each pointing the developer at the fix — a name nothing in the registry comes close to, and a typo the warner can suggest a fix for ("did you mean"). Live copies of the same two tags are rendered off-screen, so the demo fires without affecting layout — including while this section is folded away. Remove this section in your fork if you want a quieter Components tab.',
				) }
			</p>
			<pre class="os-settings__help-warner-code"><code>${ WARNER_DEMO_SNIPPET }</code></pre>
		</div>
	</os-disclosure>

	<div
		class="os-settings__help-warner-demo"
		aria-hidden="true"
		os-preserve
		style="position:absolute;width:0;height:0;overflow:hidden;clip:rect(0 0 0 0);"
	>
		<os-example-console-fail-due-to-unregistered-component></os-example-console-fail-due-to-unregistered-component>
		<os-buton></os-buton>
	</div>
`;

function entriesOf( ctx: Ctx ): ComponentEntry[] {
	const ui = uiOf( ctx ).components;
	ui.entries ??= collectEntries();
	return ui.entries;
}

function activeEntry( ctx: Ctx ): ComponentEntry | undefined {
	const ui = uiOf( ctx ).components;
	const visible = entriesOf( ctx ).filter( ( e ) => matchesQuery( e, ui.query ) );
	return visible.find( ( e ) => e.tag === ui.activeTag ) ?? visible[ 0 ];
}

export const renderComponents: Section = ( s, ctx ) => {
	const ui = uiOf( ctx ).components;
	if ( s.developerModeEnabled ) {
		logDemoBanner();
	}
	const visible = entriesOf( ctx ).filter( ( e ) => matchesQuery( e, ui.query ) );
	const active = activeEntry( ctx );
	return html`
		${ s.developerModeEnabled ? warnerDemo() : '' }
		<div class="os-settings__help-layout">
			<div class="os-settings__help-sidebar">
				<os-text-field
					class="os-settings__help-search"
					type="search"
					label=${ __( 'Search components' ) }
					placeholder=${ __( 'Name, tag, prop, event…' ) }
					autocomplete="off"
					value=${ ui.query }
					@os-input-change=${ ( e: Event ) => {
						ui.query = pickedValue( e ).trim();
						ctx.repaint();
					} }
				></os-text-field>
				<nav class="os-settings__help-nav" aria-label=${ __( 'Components' ) }>
					${ ! visible.length ? html`<p class="os-settings__help-nav-empty">${ __( 'No components match.' ) }</p>` : '' }
					${ visible.map(
						( entry ) => html`<button
							type="button"
							class=${ entry.tag === active?.tag ? 'os-settings__help-nav-item is-active' : 'os-settings__help-nav-item' }
							aria-pressed=${ entry.tag === active?.tag ? 'true' : 'false' }
							@click=${ () => {
								ui.activeTag = entry.tag;
								ctx.repaint();
							} }
						>
							<span class="os-settings__help-nav-title">${ entry.title }</span>
							<span class="os-settings__help-nav-tag">&lt;${ entry.tag }&gt;</span>
						</button>`,
					) }
				</nav>
			</div>
			<div class="os-settings__help-detail">
				${ active ? detail( active ) : html`<p>${ __( 'No components registered.' ) }</p>` }
			</div>
		</div>
	`;
};

export function afterComponentsRender( ctx: Ctx ): void {
	const ui = uiOf( ctx ).components;
	const pane = ctx.root.querySelector< HTMLElement >( '.os-settings__help-detail' );
	if ( ! pane ) {
		return;
	}
	const active = activeEntry( ctx );
	const tag = active?.tag ?? '';
	if ( tag !== ui.paintedTag ) {
		pane.scrollTop = 0;
		ui.paintedTag = tag;
	}
	const init = active?.help?.exampleInit;
	const host = pane.querySelector< HTMLElement >( '.os-settings__help-example' );
	if ( ! init || ! host || host.hasAttribute( 'data-os-example-ready' ) ) {
		return;
	}
	host.setAttribute( 'data-os-example-ready', '' );
	customElements.upgrade( host );
	try {
		init( host );
	} catch ( err ) {
		console.error( `[openstation] <${ tag }> exampleInit threw:`, err );
	}
}
