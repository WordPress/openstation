import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-select';

const tick = (): Promise< void > => Promise.resolve();

/** The rendered listbox rows, whether the popup is open or not. */
const rows = ( el: Element ): HTMLElement[] =>
	Array.from( el.shadowRoot!.querySelectorAll( '[role="option"]' ) );

const trigger = ( el: Element ): HTMLButtonElement =>
	el.shadowRoot!.querySelector( '.os-select__trigger' ) as HTMLButtonElement;

const popup = ( el: Element ): HTMLElement =>
	el.shadowRoot!.querySelector( '.os-select__popup' ) as HTMLElement;

describe( '<os-select> + <os-option>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders each option as a listbox row with the current value selected', async () => {
		host.innerHTML = `
			<os-select value="usd" label="Currency">
				<os-option value="eur">Euro</os-option>
				<os-option value="usd">US Dollar</os-option>
				<os-option value="jpy">Japanese Yen</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		const opts = rows( el );
		expect( opts.length ).toBe( 3 );
		expect(
			opts.map( ( o ) =>
				o.querySelector( '.os-select__option-label' )!.textContent?.trim(),
			),
		).toEqual( [ 'Euro', 'US Dollar', 'Japanese Yen' ] );
		expect(
			opts.map( ( o ) => o.getAttribute( 'aria-selected' ) ),
		).toEqual( [ 'false', 'true', 'false' ] );
		// The trigger names the selection.
		expect( trigger( el ).textContent ).toContain( 'US Dollar' );
	} );

	test( 'emits os-pick with { value } on option click and reflects value into the attribute', async () => {
		host.innerHTML = `
			<os-select value="eur">
				<os-option value="eur">Euro</os-option>
				<os-option value="usd">US Dollar</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		let heard: string | null = null;
		el.addEventListener( 'os-pick', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );

		trigger( el ).click();
		await tick();
		rows( el )[ 1 ].click();

		expect( heard ).toBe( 'usd' );
		expect( el.getAttribute( 'value' ) ).toBe( 'usd' );
	} );

	test( 'trigger click opens and closes the popup, with aria-expanded in step', async () => {
		host.innerHTML = `
			<os-select value="eur">
				<os-option value="eur">Euro</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		expect( trigger( el ).getAttribute( 'aria-expanded' ) ).toBe( 'false' );

		trigger( el ).click();
		await tick();
		// jsdom has no Popover API, so the component takes the
		// fallback path and stamps data-open.
		expect( popup( el ).hasAttribute( 'data-open' ) ).toBe( true );
		expect( trigger( el ).getAttribute( 'aria-expanded' ) ).toBe( 'true' );

		trigger( el ).click();
		await tick();
		expect( popup( el ).hasAttribute( 'data-open' ) ).toBe( false );
		expect( trigger( el ).getAttribute( 'aria-expanded' ) ).toBe( 'false' );
	} );

	test( 'keyboard: ArrowDown opens, ArrowDown + Enter commits the next option', async () => {
		host.innerHTML = `
			<os-select value="eur" label="Currency">
				<os-option value="eur">Euro</os-option>
				<os-option value="usd">US Dollar</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		let heard: string | null = null;
		el.addEventListener( 'os-pick', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );

		const key = ( k: string ) =>
			trigger( el ).dispatchEvent(
				new KeyboardEvent( 'keydown', { key: k, bubbles: true } ),
			);

		key( 'ArrowDown' ); // opens, active = current (Euro)
		await tick();
		key( 'ArrowDown' ); // active = US Dollar
		await tick();
		key( 'Enter' ); // commits

		expect( heard ).toBe( 'usd' );
		expect( el.getAttribute( 'value' ) ).toBe( 'usd' );
	} );

	test( 'Escape closes the popup without committing', async () => {
		host.innerHTML = `
			<os-select value="eur">
				<os-option value="eur">Euro</os-option>
				<os-option value="usd">US Dollar</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		let heard = false;
		el.addEventListener( 'os-pick', () => {
			heard = true;
		} );

		trigger( el ).click();
		await tick();
		trigger( el ).dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		await tick();

		expect( popup( el ).hasAttribute( 'data-open' ) ).toBe( false );
		expect( heard ).toBe( false );
		expect( el.getAttribute( 'value' ) ).toBe( 'eur' );
	} );

	test( 'placeholder shows in the trigger when no value is set', async () => {
		host.innerHTML = `
			<os-select placeholder="Select a currency">
				<os-option value="eur">Euro</os-option>
				<os-option value="usd">US Dollar</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		const value = el.shadowRoot!.querySelector( '.os-select__value' )!;
		expect( value.textContent?.trim() ).toBe( 'Select a currency' );
		expect(
			value.classList.contains( 'os-select__value--placeholder' ),
		).toBe( true );
	} );

	test( 'late-added options trigger a re-render via the mutation observer', async () => {
		host.innerHTML = `<os-select value=""></os-select>`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		expect( rows( el ).length ).toBe( 0 );

		const o = document.createElement( 'os-option' );
		o.setAttribute( 'value', 'cad' );
		o.textContent = 'Canadian Dollar';
		el.appendChild( o );

		// Two microtasks for: mutation-observer callback → requestUpdate
		// → queued render.
		await tick();
		await tick();

		const opts = rows( el );
		expect( opts.length ).toBe( 1 );
		expect( opts[ 0 ].textContent ).toContain( 'Canadian Dollar' );
	} );

	test( 'disabled attribute disables the trigger', async () => {
		host.innerHTML = `
			<os-select value="eur" disabled>
				<os-option value="eur">Euro</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		expect( trigger( host.querySelector( 'os-select' )! ).disabled ).toBe(
			true,
		);
	} );

	test( 'a disabled option is marked aria-disabled and its click does not commit', async () => {
		host.innerHTML = `
			<os-select value="eur">
				<os-option value="eur">Euro</os-option>
				<os-option value="btc" disabled>Bitcoin (coming soon)</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		let heard = false;
		el.addEventListener( 'os-pick', () => {
			heard = true;
		} );

		const opts = rows( el );
		expect( opts[ 0 ].getAttribute( 'aria-disabled' ) ).toBe( 'false' );
		expect( opts[ 1 ].getAttribute( 'aria-disabled' ) ).toBe( 'true' );

		trigger( el ).click();
		await tick();
		rows( el )[ 1 ].click();
		expect( heard ).toBe( false );
		expect( el.getAttribute( 'value' ) ).toBe( 'eur' );
	} );

	test( 'label attribute reflects onto aria-label on the host and the trigger', async () => {
		host.innerHTML = `
			<os-select label="Currency" value="eur">
				<os-option value="eur">Euro</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		expect( el.getAttribute( 'aria-label' ) ).toBe( 'Currency' );
		expect( trigger( el ).getAttribute( 'aria-label' ) ).toBe( 'Currency' );
	} );

	test( '.items setter replaces options and preserves value when it still resolves', async () => {
		host.innerHTML = `<os-select value="usd" label="Currency"></os-select>`;
		await tick();

		const sel = host.querySelector( 'os-select' ) as HTMLElement & {
			items: ReadonlyArray< { value: string; label: string } >;
		};
		sel.items = [
			{ value: 'eur', label: 'Euro' },
			{ value: 'usd', label: 'US Dollar' },
			{ value: 'jpy', label: 'Japanese Yen' },
		];
		await tick();
		await tick();

		expect( rows( sel ).length ).toBe( 3 );
		expect( sel.getAttribute( 'value' ) ).toBe( 'usd' );
		expect( trigger( sel ).textContent ).toContain( 'US Dollar' );
	} );

	test( '.items setter resets value to the first item when the prior value no longer matches', async () => {
		host.innerHTML = `<os-select value="btc"></os-select>`;
		await tick();

		const sel = host.querySelector( 'os-select' ) as HTMLElement & {
			items: ReadonlyArray< { value: string; label: string } >;
		};
		sel.items = [
			{ value: 'eur', label: 'Euro' },
			{ value: 'usd', label: 'US Dollar' },
		];
		await tick();
		await tick();

		expect( sel.getAttribute( 'value' ) ).toBe( 'eur' );
	} );

	// Regression guard mirroring the calculator-plugin path that
	// triggered the empty-select bug: the element is created
	// via innerHTML and populated via `.items` IN THE SAME TICK
	// (template-clone-then-wire), so the connect-time render
	// microtask hasn't run yet when the setter appends options. The
	// render must still pick the options up.
	test( 'same-tick innerHTML + .items populates the listbox', async () => {
		host.innerHTML = `<os-select label="From"></os-select>`;
		const sel = host.querySelector( 'os-select' ) as HTMLElement & {
			items: ReadonlyArray< { value: string; label: string } >;
		};
		// No await here — same tick as the innerHTML parse.
		sel.items = [
			{ value: 'm', label: 'Metres' },
			{ value: 'km', label: 'Kilometres' },
		];
		sel.setAttribute( 'value', 'm' );

		await tick();
		await tick();

		expect( rows( sel ).length ).toBe( 2 );
		expect( trigger( sel ).textContent ).toContain( 'Metres' );
	} );

	test( 'two same-tick .items assignments on sibling selects both populate', async () => {
		host.innerHTML = `
			<os-select data-role="from" label="From"></os-select>
			<os-select data-role="to"   label="To"></os-select>
		`;
		const from = host.querySelector(
			'os-select[data-role="from"]',
		) as HTMLElement & {
			items: ReadonlyArray< { value: string; label: string } >;
		};
		const to = host.querySelector(
			'os-select[data-role="to"]',
		) as HTMLElement & {
			items: ReadonlyArray< { value: string; label: string } >;
		};

		const units = [
			{ value: 'm', label: 'Metres' },
			{ value: 'km', label: 'Kilometres' },
			{ value: 'mi', label: 'Miles' },
		];
		from.items = units;
		to.items = units;
		from.setAttribute( 'value', 'm' );
		to.setAttribute( 'value', 'km' );

		await tick();
		await tick();

		expect( rows( from ).length ).toBe( 3 );
		expect( rows( to ).length ).toBe( 3 );
		expect( trigger( from ).textContent ).toContain( 'Metres' );
		expect( trigger( to ).textContent ).toContain( 'Kilometres' );
	} );

	// Regression for the missing-chevron report: the earlier build
	// used a dashicons-classed span, which never paints inside a
	// shadow root because the global Dashicons font stylesheet can't
	// cross the boundary. Inline SVG is the fix.
	test( 'shadow-DOM chevron is rendered as inline SVG (not a dashicons span)', async () => {
		host.innerHTML = `<os-select value="eur">
			<os-option value="eur">Euro</os-option>
		</os-select>`;
		await tick();
		await tick();

		const sel = host.querySelector( 'os-select' )!;
		const svg = sel.shadowRoot!.querySelector( 'svg.os-select__chevron' );
		expect( svg ).not.toBeNull();
		// Path is inside the SVG, not a dashicons font character.
		expect( svg!.querySelector( 'path' ) ).not.toBeNull();
		// No stray dashicons span that won't render.
		expect( sel.shadowRoot!.querySelector( '.dashicons' ) ).toBeNull();
	} );

	test( 'the selected row is the only one showing its check', async () => {
		host.innerHTML = `<os-select value="usd">
			<os-option value="eur">Euro</os-option>
			<os-option value="usd">US Dollar</os-option>
		</os-select>`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		const checks = rows( el ).map(
			( o ) => o.querySelector( 'svg.os-select__check' ) !== null,
		);
		// Every row reserves the check column so labels align; CSS
		// shows it only on aria-selected="true".
		expect( checks ).toEqual( [ true, true ] );
		expect(
			rows( el ).map( ( o ) => o.getAttribute( 'aria-selected' ) ),
		).toEqual( [ 'false', 'true' ] );
	} );

	// Auto-id: deterministic slug derived from window + tab + label
	// ancestry. Plugin authors that pass `id="…"` keep full control.
	test( 'auto-id picks up window + tab + label ancestry', async () => {
		// Simulate a native-window body with a tabpanel, per shell
		// rendering conventions.
		host.innerHTML = `
			<div id="wp-window-calculator">
				<os-tabpanel for="convert">
					<os-select label="From unit">
						<os-option value="m">Metres</os-option>
					</os-select>
				</os-tabpanel>
			</div>
		`;
		await tick();
		await tick();

		const sel = host.querySelector( 'os-select' ) as HTMLElement;
		expect( sel.id ).toBe( 'os-calculator-tab-convert-from-unit' );
	} );

	test( 'trigger carries the derived id for <label for> pairing', async () => {
		host.innerHTML = `
			<div id="wp-window-calc">
				<os-select label="Amount">
					<os-option value="1">one</os-option>
				</os-select>
			</div>
		`;
		await tick();
		await tick();

		const sel = host.querySelector( 'os-select' ) as HTMLElement;
		const label = sel.shadowRoot!.querySelector(
			'label.os-select__label',
		) as HTMLLabelElement;

		expect( sel.id ).toBe( 'os-calc-amount' );
		expect( trigger( sel ).id ).toBe( 'os-calc-amount__trigger' );
		expect( label.getAttribute( 'for' ) ).toBe( 'os-calc-amount__trigger' );
	} );

	test( 'explicit id on the host wins over auto-id', async () => {
		host.innerHTML = `
			<div id="wp-window-x">
				<os-select id="my-custom-id" label="Ignored"></os-select>
			</div>
		`;
		await tick();
		await tick();

		const sel = host.querySelector( 'os-select' ) as HTMLElement;
		expect( sel.id ).toBe( 'my-custom-id' );
		expect( trigger( sel ).id ).toBe( 'my-custom-id__trigger' );
	} );

	// Regression guard for the native-window render-before-mount bug:
	// populating `.items` while the element is still in a detached
	// subtree used to leave the setter unreached — the class wasn't
	// on the prototype yet, so the assignment created an own data
	// property that shadowed the real setter after upgrade. Mounting
	// the detached tree into the document must cause the upgrade to
	// pick up the pre-set options and render them into the listbox.
	test( '.items set on a disconnected os-select still populates on mount', async () => {
		const detachedHost = document.createElement( 'div' );
		detachedHost.innerHTML = `<os-select label="From"></os-select>`;
		const sel = detachedHost.querySelector( 'os-select' ) as HTMLElement & {
			items: ReadonlyArray< { value: string; label: string } >;
		};
		// Element is NOT yet connected to the document, like a
		// native-window body before mount.
		sel.items = [
			{ value: 'm', label: 'Metres' },
			{ value: 'km', label: 'Kilometres' },
		];
		// Now mount. HTML spec: custom elements upgrade on
		// connection. The shell calls the plugin's render AFTER
		// this point (0.12+), so by the time any plugin code reads
		// `.items` the element is a real OsSelect instance.
		document.body.appendChild( detachedHost );

		await tick();
		await tick();

		expect( rows( sel ).length ).toBe( 2 );

		detachedHost.remove();
	} );
} );
