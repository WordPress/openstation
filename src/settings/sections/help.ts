/**
 * Help tab — developer-facing component reference.
 *
 * Iterates `WPD_COMPONENT_TAGS`, looks up each registered custom
 * element on `customElements.get( tag )`, and reads the optional
 * `static help: WpdHelp` descriptor off the class. Components without
 * a descriptor still render with a minimal fallback built from
 * `static props`, so the tab is useful on day one and grows richer as
 * authors fill in descriptors.
 *
 * Admin-gated alongside Extended Options — surfacing the component
 * library to every editor would be noise. The descriptors live next
 * to their components so renaming a prop forces a descriptor update
 * in the same diff (no separate docs file to drift).
 *
 * @since 0.16.0
 */

import { __ } from '../../i18n';
import { html, render, type WpdHelp } from '../../ui/core';
import { WPD_COMPONENT_TAGS } from '../../ui/components/tags';

type CtorWithHelp = CustomElementConstructor & {
	help?: WpdHelp;
	props?: readonly string[];
};

interface ComponentEntry {
	tag: string;
	title: string;
	help: WpdHelp | null;
	props: readonly string[];
}

/**
 * Module-level guard so the "intentional demo" console banner is
 * logged exactly once per page lifetime, no matter how many times
 * the Components tab is opened or repainted.
 */
let demoBannerLogged = false;

function logDemoBanner(): void {
	if ( demoBannerLogged ) {
		return;
	}
	demoBannerLogged = true;

	const headingStyle = [
		'background: #ffb400',
		'color: #1a1a1a',
		'font-weight: 700',
		'font-size: 12px',
		'padding: 4px 8px',
		'border-radius: 3px',
	].join( ';' );
	const bodyStyle = [
		'color: #b25c00',
		'font-weight: 500',
	].join( ';' );

	// eslint-disable-next-line no-console
	console.log(
		'%c⚠ wp.desktop — INTENTIONAL DEMO%c\n' +
			'The next three console.error entries are fired ON PURPOSE by the\n' +
			'OS Settings → Components tab to demonstrate the <wpd-*> missing-\n' +
			'import warner. They are not real bugs.\n\n' +
			'  1. <wpd-example-console-fail-due-to-unregistered-component>\n' +
			'  2. <wpd-buton>   (typo of <wpd-button>)\n' +
			'  3. <wpd-totally-made-up-thing>\n\n' +
			'Source: src/settings/sections/help.ts — the "Missing-import\n' +
			'warner — live demo" section. Remove that section in your fork\n' +
			'if you want a quieter Components tab.',
		headingStyle,
		bodyStyle,
	);
}

export function buildHelpSection(): HTMLElement {
	const entries = collectEntries();
	const el = document.createElement( 'div' );
	el.classList.add( 'desktop-mode-os-settings__help' );
	logDemoBanner();

	let activeTag = entries[ 0 ]?.tag ?? '';

	const paint = (): void => {
		const active = entries.find( ( e ) => e.tag === activeTag ) ?? entries[ 0 ];
		render(
			html`
				<wpd-section
					heading=${ __( 'Component library' ) }
					description=${ __(
						'Every <wpd-*> web component shipped by this plugin, with its props, slots, and a live example. Descriptors live next to each component class — the list stays in sync with the code.',
					) }
				>
					<p class="desktop-mode-os-settings__help-count">
						${ String( entries.length ) } ${ __( 'components registered.' ) }
					</p>
				</wpd-section>

				<wpd-section
					heading=${ __( 'Missing-import warner — live demo' ) }
					description=${ __(
						'The three <wpd-*> tags below are intentionally bogus. Open the browser console: within ~2 seconds you should see three console.error entries from the framework, each pointing the developer at the fix (typo with "did you mean", and unknown tags). The tags are kept off-screen so they do not affect layout. Remove this section in your fork if you want a quieter Components tab.',
					) }
				>
					<div
						class="desktop-mode-os-settings__help-warner-demo"
						aria-hidden="true"
						style="position:absolute;width:0;height:0;overflow:hidden;clip:rect(0 0 0 0);"
					>
						<!--
							Case 1 — invented name, nothing close in the registry.
							Triggers the "no component by that name exists" branch.
						-->
						<wpd-example-console-fail-due-to-unregistered-component></wpd-example-console-fail-due-to-unregistered-component>

						<!--
							Case 2 — typo within Levenshtein distance of a real tag.
							Triggers the "Did you mean <wpd-button>?" branch.
						-->
						<wpd-buton></wpd-buton>

						<!--
							Case 3 — looks plausible but is not in the registry.
							Triggers the unknown-tag branch with no suggestion.
						-->
						<wpd-totally-made-up-thing></wpd-totally-made-up-thing>
					</div>
				</wpd-section>

				<div class="desktop-mode-os-settings__help-layout">
					<nav
						class="desktop-mode-os-settings__help-nav"
						aria-label=${ __( 'Components' ) }
					>
						${ entries.map(
							( entry ) => html`
								<button
									type="button"
									class=${ classNames(
										'desktop-mode-os-settings__help-nav-item',
										entry.tag === ( active?.tag ?? '' )
											? 'is-active'
											: '',
									) }
									aria-pressed=${ entry.tag === ( active?.tag ?? '' )
										? 'true'
										: 'false' }
									@click=${ () => {
			activeTag = entry.tag;
			paint();
		} }
								>
									<span class="desktop-mode-os-settings__help-nav-title"
										>${ entry.title }</span
									>
									<span class="desktop-mode-os-settings__help-nav-tag"
										>&lt;${ entry.tag }&gt;</span
									>
								</button>
							`,
						) }
					</nav>
					<div class="desktop-mode-os-settings__help-detail">
						${ active ? renderDetail( active ) : renderEmpty() }
					</div>
				</div>
			`,
			el,
		);
	};

	paint();
	return el;
}

function renderDetail( entry: ComponentEntry ) {
	const help = entry.help;
	const status = help?.status ?? 'stable';
	const since = help?.since;

	return html`
		<header class="desktop-mode-os-settings__help-head">
			<h3 class="desktop-mode-os-settings__help-title">${ entry.title }</h3>
			<code class="desktop-mode-os-settings__help-code"
				>&lt;${ entry.tag }&gt;</code
			>
			<span
				class=${ classNames(
					'desktop-mode-os-settings__help-badge',
					`is-${ status }`,
				) }
				>${ statusLabel( status ) }</span
			>
			${ since
				? html`<span class="desktop-mode-os-settings__help-since"
						>${ __( 'Since' ) } ${ since }</span
					>`
				: html`` }
		</header>

		${ help?.summary
			? html`<p class="desktop-mode-os-settings__help-summary">
					${ help.summary }
				</p>`
			: html`` }

		${ help?.example
			? html`
					<section class="desktop-mode-os-settings__help-group">
						<h4>${ __( 'Example' ) }</h4>
						<div class="desktop-mode-os-settings__help-example">
							${ help.example }
						</div>
					</section>
				`
			: html`` }
		${ renderPropsTable( entry, help ) } ${ renderSlots( help ) }
		${ renderEvents( help ) } ${ renderParts( help ) }
		${ renderCssProps( help ) }
		${ ! help
			? html`<p class="desktop-mode-os-settings__help-note">
					${ __(
						'This component has no help descriptor yet. Add `static help` to its class for a fuller reference.',
					) }
				</p>`
			: html`` }
	`;
}

function renderPropsTable( entry: ComponentEntry, help: WpdHelp | null ) {
	const documented = help?.props ?? [];
	const documentedNames = new Set( documented.map( ( p ) => p.name ) );
	const undocumented = entry.props.filter( ( p ) => ! documentedNames.has( p ) );

	if ( documented.length === 0 && undocumented.length === 0 ) {
		return html``;
	}

	return html`
		<section class="desktop-mode-os-settings__help-group">
			<h4>${ __( 'Props' ) }</h4>
			<table class="desktop-mode-os-settings__help-table">
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
						( p ) => html`
							<tr>
								<td><code>${ p.name }</code></td>
								<td>${ p.type ?? '—' }</td>
								<td>${ p.default ?? '—' }</td>
								<td>${ p.description ?? '' }</td>
							</tr>
						`,
					) }
					${ undocumented.map(
						( name ) => html`
							<tr>
								<td><code>${ name }</code></td>
								<td>—</td>
								<td>—</td>
								<td>
									<em
										>${ __(
											'Undocumented — declared via static props.',
										) }</em
									>
								</td>
							</tr>
						`,
					) }
				</tbody>
			</table>
		</section>
	`;
}

function renderSlots( help: WpdHelp | null ) {
	if ( ! help?.slots?.length ) {
		return html``;
	}
	return html`
		<section class="desktop-mode-os-settings__help-group">
			<h4>${ __( 'Slots' ) }</h4>
			<ul class="desktop-mode-os-settings__help-list">
				${ help.slots.map(
					( s ) => html`
						<li>
							<code>${ s.name }</code>
							${ s.description
								? html` — ${ s.description }`
								: html`` }
						</li>
					`,
				) }
			</ul>
		</section>
	`;
}

function renderEvents( help: WpdHelp | null ) {
	if ( ! help?.events?.length ) {
		return html``;
	}
	return html`
		<section class="desktop-mode-os-settings__help-group">
			<h4>${ __( 'Events' ) }</h4>
			<ul class="desktop-mode-os-settings__help-list">
				${ help.events.map(
					( e ) => html`
						<li>
							<code>${ e.name }</code>
							${ e.detail
								? html` — <code>${ e.detail }</code>`
								: html`` }
							${ e.description ? html` — ${ e.description }` : html`` }
						</li>
					`,
				) }
			</ul>
		</section>
	`;
}

function renderParts( help: WpdHelp | null ) {
	if ( ! help?.parts?.length ) {
		return html``;
	}
	return html`
		<section class="desktop-mode-os-settings__help-group">
			<h4>${ __( 'Shadow parts' ) }</h4>
			<ul class="desktop-mode-os-settings__help-list">
				${ help.parts.map(
					( p ) => html`
						<li>
							<code>::part(${ p.name })</code>
							${ p.description ? html` — ${ p.description }` : html`` }
						</li>
					`,
				) }
			</ul>
		</section>
	`;
}

function renderCssProps( help: WpdHelp | null ) {
	if ( ! help?.cssProps?.length ) {
		return html``;
	}
	return html`
		<section class="desktop-mode-os-settings__help-group">
			<h4>${ __( 'CSS custom properties' ) }</h4>
			<ul class="desktop-mode-os-settings__help-list">
				${ help.cssProps.map(
					( v ) => html`
						<li>
							<code>${ v.name }</code>
							${ v.default
								? html`
										(${ __( 'default' ) }
										<code>${ v.default }</code>)
									`
								: html`` }
							${ v.description ? html` — ${ v.description }` : html`` }
						</li>
					`,
				) }
			</ul>
		</section>
	`;
}

function renderEmpty() {
	return html`<p>${ __( 'No components registered.' ) }</p>`;
}

function collectEntries(): ComponentEntry[] {
	const entries: ComponentEntry[] = [];
	for ( const tag of WPD_COMPONENT_TAGS ) {
		const ctor = customElements.get( tag ) as CtorWithHelp | undefined;
		if ( ! ctor ) {
			continue;
		}
		const help = ctor.help ?? null;
		const title = help?.title ?? defaultTitleFromTag( tag );
		const props = ctor.props ?? [];
		entries.push( { tag, title, help, props } );
	}
	// Stable alphabetical sort by title so plugin authors can find
	// components without having to memorise registration order.
	entries.sort( ( a, b ) => a.title.localeCompare( b.title ) );
	return entries;
}

function defaultTitleFromTag( tag: string ): string {
	// "wpd-text-field" → "Text field".
	const bare = tag.replace( /^wpd-/, '' ).replace( /-/g, ' ' );
	return bare.charAt( 0 ).toUpperCase() + bare.slice( 1 );
}

function statusLabel( status: NonNullable<WpdHelp[ 'status' ]> ): string {
	switch ( status ) {
		case 'experimental':
			return __( 'Experimental' );
		case 'planned':
			return __( 'Planned' );
		case 'stable':
		default:
			return __( 'Stable' );
	}
}

function classNames( ...parts: Array<string | false | null | undefined> ): string {
	return parts.filter( Boolean ).join( ' ' );
}
