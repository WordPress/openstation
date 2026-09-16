import { afterEach, describe, expect, test } from 'vitest';
import { bestSearchMatch } from './search';

afterEach( () => document.body.replaceChildren() );

describe( 'Preferences best control matching', () => {
	test( 'an exact control label beats earlier prefix, section and description matches', () => {
		document.body.innerHTML = `<div class="os-settings">
			<os-tabpanel for="first">
				<os-section heading="Delivery" description="Courier">
					<os-select label="Provider"></os-select>
				</os-section>
				<os-section heading="Courier"><os-select label="Service"></os-select></os-section>
				<os-select label="Courier priority"></os-select>
			</os-tabpanel>
			<os-tabpanel for="second"><os-select label="Courier"></os-select></os-tabpanel>
		</div>`;
		expect( bestSearchMatch( document.body, 'courier' )?.page ).toBe( 'second' );
		document.querySelector( 'os-tabpanel[for="second"]' )!.remove();
		expect( bestSearchMatch( document.body, 'courier' )?.control.getAttribute( 'label' ) ).toBe( 'Courier priority' );
		document.querySelector( 'os-select[label="Courier priority"]' )!.remove();
		expect( bestSearchMatch( document.body, 'courier' )?.control.getAttribute( 'label' ) ).toBe( 'Service' );
	} );

	test( 'searches inactive pages and ignores hidden controls and demo content', () => {
		document.body.innerHTML = `<div class="os-settings">
			<os-tabpanel for="extension" hidden>
				<os-section heading="Delivery">
					<os-select label="Courier"></os-select>
					<div hidden><os-select label="Courier"></os-select></div>
					<div aria-hidden="true"><os-select label="Courier"></os-select></div>
					<div os-preserve><os-select label="Courier"></os-select></div>
				</os-section>
			</os-tabpanel>
		</div>`;
		const match = bestSearchMatch( document.body, 'courier' );
		expect( match?.page ).toBe( 'extension' );
		expect( match?.section?.getAttribute( 'heading' ) ).toBe( 'Delivery' );
	} );

	test( 'finds standalone swatches and option labels inside a composite picker', () => {
		document.body.innerHTML = `<div class="os-settings">
			<os-tabpanel for="appearance">
				<os-section heading="Wallpaper"><os-swatch label="Galaxy"></os-swatch></os-section>
				<os-section heading="Accent"><os-swatch-grid aria-label="Color">
					<os-swatch label="Lagoon"></os-swatch>
				</os-swatch-grid></os-section>
			</os-tabpanel>
		</div>`;
		expect( bestSearchMatch( document.body, 'galaxy' )?.control.localName ).toBe( 'os-swatch' );
		expect( bestSearchMatch( document.body, 'lagoon' )?.control.localName ).toBe( 'os-swatch-grid' );
		expect( bestSearchMatch( document.body, 'color' )?.control.localName ).toBe( 'os-swatch-grid' );
	} );

	test( 'counts a composite picker once even when several options match', () => {
		document.body.innerHTML = `<div class="os-settings">
			<os-tabpanel for="extension">
				<os-section heading="Delivery">
					<os-select label="Courier">
						<os-option>Express courier</os-option><os-option>Local courier</os-option>
					</os-select>
				</os-section>
			</os-tabpanel>
		</div>`;
		expect( bestSearchMatch( document.body, 'courier' )?.control.localName ).toBe( 'os-select' );
		const duplicate = document.querySelector( 'os-tabpanel' )!.cloneNode( true ) as HTMLElement;
		duplicate.setAttribute( 'for', 'another-extension' );
		document.querySelector( '.os-settings' )!.append( duplicate );
		expect( bestSearchMatch( document.body, 'courier' )?.page ).toBe( 'extension' );
		duplicate.remove();
		expect( bestSearchMatch( document.body, 'courier' )?.page ).toBe( 'extension' );
	} );
} );
