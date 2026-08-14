/**
 * Help tab — developer-facing component reference.
 *
 * Iterates `OS_COMPONENT_TAGS`, looks up each registered custom
 * element on `customElements.get( tag )`, and reads the optional
 * `static help: OsHelp` descriptor off the class. Components without
 * a descriptor still render with a minimal fallback built from
 * `static props`, so the tab is useful on day one and grows richer as
 * authors fill in descriptors.
 *
 * Admin-gated — surfacing the component library to every editor
 * would be noise. The descriptors live next
 * to their components so renaming a prop forces a descriptor update
 * in the same diff (no separate docs file to drift).
 *
 * The "Missing-import warner — live demo" section (and its console
 * banner) only renders when `developerModeEnabled` is on — see OS
 * Settings → Features. Off by default so a regular admin opening
 * this tab doesn't see intentional console.error noise.
 */

// Side-effect import of the whole kit. Feature code elsewhere
// imports components one file at a time, so a component nothing
// happens to use is tree-shaken out of every bundle — it never
// reaches `customElements`, and `collectEntries()` silently skips
// it. That made the tab a list of "components some other screen
// loaded" rather than "components this plugin ships". Importing
// the barrel here registers every tag in `OS_COMPONENT_TAGS`,
// which is also what makes the live `help.example` markup render
// instead of collapsing to unknown elements.
import '../../ui/components';

import { __ } from '../../i18n';
import { html, render, type OsHelp } from '../../ui/core';
import { OS_COMPONENT_TAGS } from '../../ui/components/tags';
import type { SettingsCtx } from '../types';
import type { OsSettingsSnapshot } from '../registry';

type CtorWithHelp = CustomElementConstructor & {
	help?: OsHelp;
	props?: readonly string[];
};

interface ComponentEntry {
	tag: string;
	title: string;
	help: OsHelp | null;
	props: readonly string[];
	/**
	 * Pre-flattened lowercase blob of everything worth searching on:
	 * title, tag, summary, status, and the name + description of every
	 * documented prop, slot, event, part, and CSS custom property.
	 * Built once in `collectEntries()` so filtering on each keystroke
	 * is a substring scan rather than a walk of the descriptor tree.
	 */
	haystack: string;
}

/**
 * Flatten a descriptor into the searchable blob stored on
 * {@link ComponentEntry.haystack}.
 *
 * Descriptions are included deliberately — searching "clipboard" or
 * "clamp" should surface the component that mentions it even when the
 * word appears in no name. `static props` names are folded in too, so
 * undocumented components (no `help`) stay findable by attribute.
 */
function buildHaystack(
	tag: string,
	title: string,
	help: OsHelp | null,
	props: readonly string[],
): string {
	const parts: string[] = [ tag, title, ...props ];
	if ( help ) {
		parts.push( help.summary ?? '', help.status ?? '' );
		const groups = [
			help.props,
			help.slots,
			help.events,
			help.parts,
			help.cssProps,
		];
		for ( const group of groups ) {
			for ( const item of group ?? [] ) {
				const entry = item as { name?: string; description?: string };
				parts.push( entry.name ?? '', entry.description ?? '' );
			}
		}
	}
	return parts.join( ' ' ).toLowerCase();
}

/**
 * Split a raw query into lowercase terms and AND them together, so
 * "field number" matches `<os-number-field>` regardless of the order
 * the words were typed.
 */
function matchesQuery( entry: ComponentEntry, query: string ): boolean {
	const terms = query.toLowerCase().split( /\s+/ ).filter( Boolean );
	if ( ! terms.length ) {
		return true;
	}
	return terms.every( ( term ) => entry.haystack.includes( term ) );
}

/**
 * Run the active component's `exampleInit` against its own container.
 *
 * Half the kit takes its data through a JS property rather than an
 * attribute — `segments`, `data`, `columns`, `entries`, `ratings` —
 * and those cannot be populated from markup at all. Their examples
 * rendered as empty shells until this hook existed.
 *
 * `customElements.upgrade()` first, and it is not optional. On the
 * FIRST paint this section is still detached — `buildHelpSection()`
 * returns `el` for the caller to append — so the custom elements the
 * renderer just created have not upgraded yet. Assigning `.segments`
 * to an un-upgraded element defines an OWN property, which then
 * permanently shadows the class accessor the upgrade installs on the
 * prototype: the setter never runs, and the component sits there
 * empty holding data it cannot see. Upgrading first makes the
 * accessor exist before anything is written through it.
 */
function runExampleInit(
	root: HTMLElement,
	active: ComponentEntry | undefined,
): void {
	const init = active?.help?.exampleInit;
	const host = root.querySelector< HTMLElement >(
		'.os-settings__help-example',
	);
	if ( ! init || ! host ) {
		return;
	}
	customElements.upgrade( host );
	try {
		init( host );
	} catch ( err ) {
		// An example is documentation. A broken one is worth a console
		// line, and is never worth taking the Components tab down with
		// it — the props, events and CSS tables below are still fine.
		// eslint-disable-next-line no-console
		console.error(
			`[openstation] <${ active?.tag }> exampleInit threw:`,
			err,
		);
	}
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
		'%c⚠ wp.os — INTENTIONAL DEMO%c\n' +
			'The next three console.error entries are fired ON PURPOSE by the\n' +
			'OpenStation Preferences → Components tab to demonstrate the <os-*> missing-\n' +
			'import warner. They are not real bugs.\n\n' +
			'  1. <os-example-console-fail-due-to-unregistered-component>\n' +
			'  2. <os-buton>   (typo of <os-button>)\n' +
			'  3. <os-totally-made-up-thing>\n\n' +
			'Source: src/settings/sections/help.ts — the "Missing-import\n' +
			'warner — live demo" section. Remove that section in your fork\n' +
			'if you want a quieter Components tab.',
		headingStyle,
		bodyStyle,
	);
}

export function buildHelpSection( ctx: SettingsCtx ): HTMLElement {
	const entries = collectEntries();
	const el = document.createElement( 'div' );
	el.classList.add( 'os-settings__help' );

	let activeTag = entries[ 0 ]?.tag ?? '';
	let query = '';
	/**
	 * Which component the detail pane last painted.
	 *
	 * The pane is its own scroll container, and `render()` diffs — so
	 * the same `<div>` survives every repaint and keeps its
	 * `scrollTop`. Picking a component while scrolled down through a
	 * long one (`<os-table>` has five sections) left the new one
	 * opened halfway down, which reads as a component with nothing at
	 * the top rather than as a scroll position.
	 *
	 * Compared rather than reset unconditionally, because typing in
	 * the filter box repaints too and yanking the pane to the top on
	 * every keystroke is its own bug.
	 */
	let paintedTag = '';

	const paint = (): void => {
		if ( ctx.state.developerModeEnabled ) {
			logDemoBanner();
		}
		const visible = entries.filter( ( e ) => matchesQuery( e, query ) );
		// Keep the selection when it survives the filter; otherwise fall
		// back to the first match so the detail pane never goes blank
		// while results exist.
		const active =
			visible.find( ( e ) => e.tag === activeTag ) ?? visible[ 0 ];
		render(
			html`
				<!--
					No intro card. The page header above already names the
					tab and says what it is, and a count of how many
					components are registered answered a question nobody
					asked while costing the two panes the height they
					actually need. This tab is the list; it starts at the
					list.
				-->
				${ ctx.state.developerModeEnabled
					? html`
						<os-section
							heading=${ __( 'Missing-import warner — live demo' ) }
							description=${ __(
								'The three <os-*> tags below are intentionally bogus. Open the browser console: within ~2 seconds you should see three console.error entries from the framework, each pointing the developer at the fix (typo with "did you mean", and unknown tags). The tags are kept off-screen so they do not affect layout. Remove this section in your fork if you want a quieter Components tab.',
							) }
						>
							<div
								class="os-settings__help-warner-demo"
								aria-hidden="true"
								style="position:absolute;width:0;height:0;overflow:hidden;clip:rect(0 0 0 0);"
							>
								<!--
									Case 1 — invented name, nothing close in the registry.
									Triggers the "no component by that name exists" branch.
								-->
								<os-example-console-fail-due-to-unregistered-component></os-example-console-fail-due-to-unregistered-component>

								<!--
									Case 2 — typo within Levenshtein distance of a real tag.
									Triggers the "Did you mean <os-button>?" branch.
								-->
								<os-buton></os-buton>

								<!--
									Case 3 — looks plausible but is not in the registry.
									Triggers the unknown-tag branch with no suggestion.
								-->
								<os-totally-made-up-thing></os-totally-made-up-thing>
							</div>
						</os-section>
					`
					: '' }

				<div class="os-settings__help-layout">
					<div class="os-settings__help-sidebar">
						<os-text-field
							class="os-settings__help-search"
							type="search"
							label=${ __( 'Search components' ) }
							placeholder=${ __( 'Name, tag, prop, event…' ) }
							autocomplete="off"
							value=${ query }
							@os-input-change=${ ( e: Event ) => {
			query = (
				( e as CustomEvent< { value: string } > ).detail?.value ?? ''
			).trim();
			paint();
		} }
						></os-text-field>
					<nav
						class="os-settings__help-nav"
						aria-label=${ __( 'Components' ) }
					>
						${ ! visible.length
							? html`<p
									class="os-settings__help-nav-empty"
								>
									${ __( 'No components match.' ) }
								</p>`
							: '' }
						${ visible.map(
							( entry ) => html`
								<button
									type="button"
									class=${ classNames(
										'os-settings__help-nav-item',
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
									<span class="os-settings__help-nav-title"
										>${ entry.title }</span
									>
									<span class="os-settings__help-nav-tag"
										>&lt;${ entry.tag }&gt;</span
									>
								</button>
							`,
						) }
					</nav>
					</div>
					<div class="os-settings__help-detail">
						${ active ? renderDetail( active ) : renderEmpty() }
					</div>
				</div>
			`,
			el,
		);

		const detail = el.querySelector< HTMLElement >(
			'.os-settings__help-detail',
		);
		if ( detail && ( active?.tag ?? '' ) !== paintedTag ) {
			detail.scrollTop = 0;
		}
		paintedTag = active?.tag ?? '';

		runExampleInit( el, active );
	};

	paint();

	// Repaint when developer mode flips in another tab of the SAME
	// already-open OpenStation Preferences window — `renderPanel()` only builds
	// this section once per window open, so without this the demo
	// section would stay stale until the window is closed and
	// reopened. Self-unsubscribes once the panel is torn down,
	// mirroring the Apps & Plugins section's `subscribeOsSettings`
	// pattern.
	const openStation = ( window as unknown as {
		wp?: {
			os?: {
				subscribeOsSettings?: (
					cb: ( snapshot: OsSettingsSnapshot ) => void,
				) => () => void;
			};
		};
	} ).wp?.os;
	if ( openStation?.subscribeOsSettings ) {
		const unsubscribe = openStation.subscribeOsSettings( () => {
			if ( ! el.isConnected ) {
				unsubscribe();
				return;
			}
			paint();
		} );
	}

	return el;
}

function renderDetail( entry: ComponentEntry ) {
	const help = entry.help;
	const status = help?.status ?? 'stable';

	return html`
		<header class="os-settings__help-head">
			<h3 class="os-settings__help-title">${ entry.title }</h3>
			<code class="os-settings__help-code"
				>&lt;${ entry.tag }&gt;</code
			>
			<span
				class=${ classNames(
					'os-settings__help-badge',
					`is-${ status }`,
				) }
				>${ statusLabel( status ) }</span
			>
		</header>

		${ help?.summary
			? html`<p class="os-settings__help-summary">
					${ help.summary }
				</p>`
			: html`` }

		${ help?.example
			? html`
					<section class="os-settings__help-group">
						<h4>${ __( 'Example' ) }</h4>
						<div class="os-settings__help-example">
							${ help.example }
						</div>
					</section>
				`
			: html`` }
		${ renderPropsTable( entry, help ) } ${ renderSlots( help ) }
		${ renderEvents( help ) } ${ renderParts( help ) }
		${ renderCssProps( help ) }
		${ ! help
			? html`<p class="os-settings__help-note">
					${ __(
						'This component has no help descriptor yet. Add `static help` to its class for a fuller reference.',
					) }
				</p>`
			: html`` }
	`;
}

function renderPropsTable( entry: ComponentEntry, help: OsHelp | null ) {
	const documented = help?.props ?? [];
	const documentedNames = new Set( documented.map( ( p ) => p.name ) );
	const undocumented = entry.props.filter( ( p ) => ! documentedNames.has( p ) );

	if ( documented.length === 0 && undocumented.length === 0 ) {
		return html``;
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

function renderSlots( help: OsHelp | null ) {
	if ( ! help?.slots?.length ) {
		return html``;
	}
	return html`
		<section class="os-settings__help-group">
			<h4>${ __( 'Slots' ) }</h4>
			<ul class="os-settings__help-list">
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

function renderEvents( help: OsHelp | null ) {
	if ( ! help?.events?.length ) {
		return html``;
	}
	return html`
		<section class="os-settings__help-group">
			<h4>${ __( 'Events' ) }</h4>
			<ul class="os-settings__help-list">
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

function renderParts( help: OsHelp | null ) {
	if ( ! help?.parts?.length ) {
		return html``;
	}
	return html`
		<section class="os-settings__help-group">
			<h4>${ __( 'Shadow parts' ) }</h4>
			<ul class="os-settings__help-list">
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

function renderCssProps( help: OsHelp | null ) {
	if ( ! help?.cssProps?.length ) {
		return html``;
	}
	return html`
		<section class="os-settings__help-group">
			<h4>${ __( 'CSS custom properties' ) }</h4>
			<ul class="os-settings__help-list">
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
	for ( const tag of OS_COMPONENT_TAGS ) {
		const ctor = customElements.get( tag ) as CtorWithHelp | undefined;
		if ( ! ctor ) {
			continue;
		}
		const help = ctor.help ?? null;
		const title = help?.title ?? defaultTitleFromTag( tag );
		const props = ctor.props ?? [];
		entries.push( {
			tag,
			title,
			help,
			props,
			haystack: buildHaystack( tag, title, help, props ),
		} );
	}
	// Stable alphabetical sort by title so plugin authors can find
	// components without having to memorise registration order.
	entries.sort( ( a, b ) => a.title.localeCompare( b.title ) );
	return entries;
}

function defaultTitleFromTag( tag: string ): string {
	// "os-text-field" → "Text field".
	const bare = tag.replace( /^os-/, '' ).replace( /-/g, ' ' );
	return bare.charAt( 0 ).toUpperCase() + bare.slice( 1 );
}

function statusLabel( status: NonNullable<OsHelp[ 'status' ]> ): string {
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
