import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import './os-select';

const tick = (): Promise<void> => Promise.resolve();

describe( '<os-select> + <os-option>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => host.remove() );

	test( 'renders each option as a native <option> with the current value selected', async () => {
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
		const native = el.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native ).not.toBeNull();
		expect( native.value ).toBe( 'usd' );
		const opts = Array.from( native.options ).map( ( o ) => o.value );
		expect( opts ).toEqual( [ 'eur', 'usd', 'jpy' ] );
	} );

	test( 'emits os-pick with { value } on change and reflects value into the attribute', async () => {
		host.innerHTML = `
			<os-select value="eur">
				<os-option value="eur">Euro</os-option>
				<os-option value="usd">US Dollar</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		const native = el.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		let heard: string | null = null;
		el.addEventListener( 'os-pick', ( e ) => {
			heard = ( e as CustomEvent ).detail.value;
		} );

		native.value = 'usd';
		native.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		expect( heard ).toBe( 'usd' );
		expect( el.getAttribute( 'value' ) ).toBe( 'usd' );
	} );

	test( 'placeholder renders as a disabled stub when no value is set', async () => {
		host.innerHTML = `
			<os-select placeholder="Select a currency">
				<os-option value="eur">Euro</os-option>
				<os-option value="usd">US Dollar</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		const native = el.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		const stub = native.options[ 0 ];
		expect( stub.textContent?.trim() ).toBe( 'Select a currency' );
		expect( stub.disabled ).toBe( true );
		expect( stub.selected ).toBe( true );
	} );

	test( 'late-added options trigger a re-render via the mutation observer', async () => {
		host.innerHTML = `<os-select value=""></os-select>`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		let native = el.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native.options.length ).toBe( 0 );

		const o = document.createElement( 'os-option' );
		o.setAttribute( 'value', 'cad' );
		o.textContent = 'Canadian Dollar';
		el.appendChild( o );

		// Two microtasks for: mutation-observer callback → requestUpdate
		// → queued render.
		await tick();
		await tick();

		native = el.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native.options.length ).toBe( 1 );
		expect( native.options[ 0 ].value ).toBe( 'cad' );
		expect( native.options[ 0 ].textContent?.trim() ).toBe(
			'Canadian Dollar',
		);
	} );

	test( 'disabled attribute propagates to the native select', async () => {
		host.innerHTML = `
			<os-select value="eur" disabled>
				<os-option value="eur">Euro</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const native = host
			.querySelector( 'os-select' )!
			.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native.disabled ).toBe( true );
	} );

	test( 'individual option disabled attribute flags that <option> as disabled', async () => {
		host.innerHTML = `
			<os-select value="eur">
				<os-option value="eur">Euro</os-option>
				<os-option value="btc" disabled>Bitcoin (coming soon)</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const native = host
			.querySelector( 'os-select' )!
			.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native.options[ 0 ].disabled ).toBe( false );
		expect( native.options[ 1 ].disabled ).toBe( true );
	} );

	test( 'label attribute reflects onto aria-label on the host', async () => {
		host.innerHTML = `
			<os-select label="Currency" value="eur">
				<os-option value="eur">Euro</os-option>
			</os-select>
		`;
		await tick();
		await tick();

		const el = host.querySelector( 'os-select' )!;
		expect( el.getAttribute( 'aria-label' ) ).toBe( 'Currency' );
	} );

	test( '.items setter replaces options and preserves value when it still resolves', async () => {
		host.innerHTML = `<os-select value="usd" label="Currency"></os-select>`;
		await tick();

		const sel = host.querySelector( 'os-select' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		};
		sel.items = [
			{ value: 'eur', label: 'Euro' },
			{ value: 'usd', label: 'US Dollar' },
			{ value: 'jpy', label: 'Japanese Yen' },
		];
		await tick();
		await tick();

		const native = sel.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native.options.length ).toBe( 3 );
		expect( native.value ).toBe( 'usd' );
	} );

	test( '.items setter resets value to the first item when the prior value no longer matches', async () => {
		host.innerHTML = `<os-select value="btc"></os-select>`;
		await tick();

		const sel = host.querySelector( 'os-select' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
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
	test( 'same-tick innerHTML + .items populates the native <select>', async () => {
		host.innerHTML = `<os-select label="From"></os-select>`;
		const sel = host.querySelector( 'os-select' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		};
		// No await here — same tick as the innerHTML parse.
		sel.items = [
			{ value: 'm', label: 'Metres' },
			{ value: 'km', label: 'Kilometres' },
		];
		sel.setAttribute( 'value', 'm' );

		await tick();
		await tick();

		const native = sel.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native.options.length ).toBe( 2 );
		expect( native.value ).toBe( 'm' );
	} );

	test( 'two same-tick .items assignments on sibling selects both populate', async () => {
		host.innerHTML = `
			<os-select data-role="from" label="From"></os-select>
			<os-select data-role="to"   label="To"></os-select>
		`;
		const from = host.querySelector( 'os-select[data-role="from"]' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		};
		const to = host.querySelector( 'os-select[data-role="to"]' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
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

		const fromSelect = from.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		const toSelect = to.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( fromSelect.options.length ).toBe( 3 );
		expect( toSelect.options.length ).toBe( 3 );
		expect( fromSelect.value ).toBe( 'm' );
		expect( toSelect.value ).toBe( 'km' );
	} );

	test( 'label forwards to the native <select> as aria-label (issue #2 a11y fix)', async () => {
		host.innerHTML = `<os-select label="Currency" value="eur">
			<os-option value="eur">Euro</os-option>
		</os-select>`;
		await tick();
		await tick();

		const native = host
			.querySelector( 'os-select' )!
			.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native.getAttribute( 'aria-label' ) ).toBe( 'Currency' );
	} );

	test( 'name attribute forwards to the native <select>', async () => {
		host.innerHTML = `<os-select name="currency" value="eur">
			<os-option value="eur">Euro</os-option>
		</os-select>`;
		await tick();
		await tick();

		const native = host
			.querySelector( 'os-select' )!
			.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native.getAttribute( 'name' ) ).toBe( 'currency' );
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
		expect(
			sel.shadowRoot!.querySelector( '.dashicons' ),
		).toBeNull();
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
		expect( sel.id ).toBe(
			'os-calculator-tab-convert-from-unit',
		);
	} );

	test( 'inner <select> carries the derived input id for <label for> pairing', async () => {
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
		const native = sel.shadowRoot!.querySelector(
			'select',
		) as HTMLSelectElement;
		const label = sel.shadowRoot!.querySelector(
			'label.os-select__label',
		) as HTMLLabelElement;

		expect( sel.id ).toBe( 'os-calc-amount' );
		expect( native.id ).toBe( 'os-calc-amount__input' );
		expect( label.getAttribute( 'for' ) ).toBe(
			'os-calc-amount__input',
		);
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
		const native = sel.shadowRoot!.querySelector(
			'select',
		) as HTMLSelectElement;
		expect( native.id ).toBe( 'my-custom-id__input' );
	} );

	// Regression guard for the native-window render-before-mount bug:
	// populating `.items` while the element is still in a detached
	// subtree (the shape native windows had before the mount-then-
	// hydrate refactor) used to leave the setter unreached — the
	// class wasn't on the prototype yet, so the assignment created
	// an own data property that shadowed the real setter after
	// upgrade. Mounting the detached tree into the document must
	// cause the upgrade to pick up the pre-set options and render
	// them into the shadow `<select>`.
	test( '.items set on a disconnected os-select still populates on mount', async () => {
		const detachedHost = document.createElement( 'div' );
		detachedHost.innerHTML = `<os-select label="From"></os-select>`;
		const sel = detachedHost.querySelector( 'os-select' ) as HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
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

		const native = sel.shadowRoot!.querySelector( 'select' ) as HTMLSelectElement;
		expect( native.options.length ).toBe( 2 );

		detachedHost.remove();
	} );
} );
