
<?php
/**
 * Tests for `open_station_component()` — the helper that plugin
 * authors use from PHP to emit safely-escaped `<os-*>` markup,
 * including the `style => [...]` array form for inline styles.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-components
 */
class Tests_OpenStation_Component extends WP_UnitTestCase {

	/**
	 * Capture the component's echo'd output into a string so we can
	 * assert against the rendered HTML.
	 */
	private function render( $tag, $attrs = array(), $content = '' ) {
		ob_start();
		open_station_component( $tag, $attrs, $content );
		return (string) ob_get_clean();
	}

	// ---------------------------------------------------------------
	// Style array — the 0.13 ergonomic path
	// ---------------------------------------------------------------

	/**
	 * @covers ::open_station_component
	 */
	public function test_style_array_serializes_to_inline_declarations() {
		$html = $this->render( 'os-stack', array(
			'gap'   => 12,
			'style' => array(
				'padding'    => 0,
				'background' => 'rgba(0,0,0,0.04)',
			),
		) );

		$this->assertStringContainsString( 'gap="12"', $html );
		$this->assertStringContainsString(
			'style="padding: 0; background: rgba(0,0,0,0.04)"',
			$html
		);
	}

	/**
	 * Bare integers on length-shaped properties auto-unit to `px` so
	 * `'padding' => 16` produces `padding: 16px`. The literal `0`
	 * passes through unit-less because `0` is dimensionally valid on
	 * every CSS property.
	 *
	 * @covers ::open_station_format_css_value
	 */
	public function test_style_array_auto_units_length_properties() {
		$html = $this->render( 'os-stack', array(
			'style' => array(
				'padding'    => 16,
				'margin-top' => 24,
				'width'      => 200,
				'z-index'    => 5,    // non-length, no unit
				'opacity'    => 0.75, // non-length, no unit
				'padding-bottom' => 0, // still 0, not 0px
			),
		) );

		$this->assertStringContainsString( 'padding: 16px', $html );
		$this->assertStringContainsString( 'margin-top: 24px', $html );
		$this->assertStringContainsString( 'width: 200px', $html );
		$this->assertStringContainsString( 'z-index: 5', $html );
		$this->assertStringContainsString( 'opacity: 0.75', $html );
		$this->assertStringContainsString( 'padding-bottom: 0', $html );
		$this->assertStringNotContainsString( 'padding-bottom: 0px', $html );
	}

	/**
	 * @covers ::open_station_component
	 */
	public function test_style_array_with_unit_strings_passes_through() {
		$html = $this->render( 'os-stack', array(
			'style' => array(
				'padding' => '1rem',
				'width'   => 'calc(100% - 20px)',
				'color'   => 'rebeccapurple',
			),
		) );
		$this->assertStringContainsString( 'padding: 1rem', $html );
		$this->assertStringContainsString( 'width: calc(100% - 20px)', $html );
		$this->assertStringContainsString( 'color: rebeccapurple', $html );
	}

	/**
	 * @covers ::open_station_component
	 */
	public function test_style_string_value_still_works() {
		$html = $this->render( 'os-stack', array(
			'style' => 'padding: 12px; margin: 0',
		) );
		$this->assertStringContainsString(
			'style="padding: 12px; margin: 0"',
			$html
		);
	}

	/**
	 * Malformed property names (whitespace, special characters, JS
	 * injection attempts) are dropped silently. The rest of the
	 * declarations still render.
	 *
	 * @covers ::open_station_serialize_style_array
	 */
	public function test_style_array_drops_malformed_property_names() {
		$html = $this->render( 'os-stack', array(
			'style' => array(
				'padding'         => 16,
				'color; expression(alert(1))' => 'red', // malformed
				''                => 'ignored',
				'margin'          => 8,
			),
		) );
		$this->assertStringContainsString( 'padding: 16px', $html );
		$this->assertStringContainsString( 'margin: 8px', $html );
		$this->assertStringNotContainsString( 'expression', $html );
	}

	/**
	 * Null / false values on individual style entries are dropped.
	 * Useful for conditional styling: `'padding' => $dense ? 0 : null`.
	 *
	 * @covers ::open_station_serialize_style_array
	 */
	public function test_style_array_drops_null_and_false_values() {
		$html = $this->render( 'os-stack', array(
			'style' => array(
				'padding' => 16,
				'margin'  => null,
				'color'   => false,
				'gap'     => 8,
			),
		) );
		$this->assertStringContainsString( 'padding: 16px', $html );
		$this->assertStringContainsString( 'gap: 8px', $html );
		$this->assertStringNotContainsString( 'margin:', $html );
		$this->assertStringNotContainsString( 'color:', $html );
	}

	/**
	 * Empty style array produces no `style` attribute at all —
	 * avoids a dangling `style=""` in the rendered HTML.
	 *
	 * @covers ::open_station_component
	 */
	public function test_empty_style_array_produces_no_attribute() {
		$html = $this->render( 'os-stack', array(
			'gap'   => 12,
			'style' => array(),
		) );
		$this->assertStringNotContainsString( 'style=', $html );
		$this->assertStringContainsString( 'gap="12"', $html );
	}

	/**
	 * The style array is HTML-escaped — a caller trying to break
	 * out of the `style` attribute via injection is neutralised.
	 * The literal text may still appear inside the attribute's
	 * escaped value (`onclick=&quot;…&quot;`), but the quote
	 * escaping prevents it from becoming a new attribute.
	 *
	 * @covers ::open_station_component
	 */
	public function test_style_array_output_is_escaped() {
		$html = $this->render( 'os-stack', array(
			'style' => array(
				'background' => '" onclick="alert(1)"',
			),
		) );
		// Quotes escaped — the payload can't break out of the
		// style="…" attribute.
		$this->assertStringContainsString( '&quot;', $html );
		// `onclick=` as a bare attribute (with `=` right after it)
		// never appears. What's in the output is the escaped form
		// `onclick=&quot;…&quot;` inside the style attribute value.
		$this->assertStringNotContainsString( '" onclick="', $html );
	}

	// ---------------------------------------------------------------
	// Backwards-compat surface
	// ---------------------------------------------------------------

	/**
	 * @covers ::open_station_component
	 */
	public function test_boolean_attribute_renders_bare() {
		$html = $this->render( 'os-stack', array(
			'hidden' => true,
		) );
		$this->assertMatchesRegularExpression( '/<os-stack\s+hidden>/', $html );
	}

	/**
	 * @covers ::open_station_component
	 */
	public function test_numeric_zero_value_renders_as_padding_0() {
		// The developer's original repro case — integer 0 as a
		// regular attribute (not inside a style array) should render
		// literal `padding="0"` on the element.
		$html = $this->render( 'os-stack', array(
			'padding' => 0,
		) );
		$this->assertStringContainsString( 'padding="0"', $html );
	}

	/**
	 * @covers ::open_station_component
	 */
	public function test_content_is_echoed_verbatim() {
		$html = $this->render( 'os-stack', array(), '<p>inner</p>' );
		$this->assertStringContainsString( '<p>inner</p>', $html );
	}

	/**
	 * @covers ::open_station_format_css_value
	 */
	public function test_format_css_value_handles_edge_values() {
		$this->assertSame( '', open_station_format_css_value( 'padding', null ) );
		$this->assertSame( '', open_station_format_css_value( 'padding', false ) );
		$this->assertSame( '', open_station_format_css_value( 'padding', '' ) );
		$this->assertSame( '', open_station_format_css_value( 'padding', '  ' ) );
		$this->assertSame( '12px', open_station_format_css_value( 'padding', 12 ) );
		$this->assertSame( '12px', open_station_format_css_value( 'padding', '12' ) );
		$this->assertSame( '1.5', open_station_format_css_value( 'opacity', 1.5 ) );
		$this->assertSame( '0', open_station_format_css_value( 'padding', 0 ) );
	}
}
