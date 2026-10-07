<?php

class Tests_OpenStation_Component extends WP_UnitTestCase {

	private function render( $tag, $attrs = array(), $content = '' ) {
		ob_start();
		openstation_component( $tag, $attrs, $content );
		return (string) ob_get_clean();
	}

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

	public function test_style_array_auto_units_length_properties() {
		$html = $this->render( 'os-stack', array(
			'style' => array(
				'padding'    => 16,
				'margin-top' => 24,
				'width'      => 200,
				'z-index'    => 5,
				'opacity'    => 0.75,
				'padding-bottom' => 0,
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

	public function test_style_string_value_still_works() {
		$html = $this->render( 'os-stack', array(
			'style' => 'padding: 12px; margin: 0',
		) );
		$this->assertStringContainsString(
			'style="padding: 12px; margin: 0"',
			$html
		);
	}

	public function test_style_array_drops_malformed_property_names() {
		$html = $this->render( 'os-stack', array(
			'style' => array(
				'padding'         => 16,
				'color; expression(alert(1))' => 'red',
				''                => 'ignored',
				'margin'          => 8,
			),
		) );
		$this->assertStringContainsString( 'padding: 16px', $html );
		$this->assertStringContainsString( 'margin: 8px', $html );
		$this->assertStringNotContainsString( 'expression', $html );
	}

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

	public function test_empty_style_array_produces_no_attribute() {
		$html = $this->render( 'os-stack', array(
			'gap'   => 12,
			'style' => array(),
		) );
		$this->assertStringNotContainsString( 'style=', $html );
		$this->assertStringContainsString( 'gap="12"', $html );
	}

	public function test_style_array_output_is_escaped() {
		$html = $this->render( 'os-stack', array(
			'style' => array(
				'background' => '" onclick="alert(1)"',
			),
		) );

		$this->assertStringContainsString( '&quot;', $html );

		$this->assertStringNotContainsString( '" onclick="', $html );
	}

	public function test_boolean_attribute_renders_bare() {
		$html = $this->render( 'os-stack', array(
			'hidden' => true,
		) );
		$this->assertMatchesRegularExpression( '/<os-stack\s+hidden>/', $html );
	}

	public function test_numeric_zero_value_renders_as_padding_0() {

		$html = $this->render( 'os-stack', array(
			'padding' => 0,
		) );
		$this->assertStringContainsString( 'padding="0"', $html );
	}

	public function test_content_is_echoed_verbatim() {
		$html = $this->render( 'os-stack', array(), '<p>inner</p>' );
		$this->assertStringContainsString( '<p>inner</p>', $html );
	}

	public function test_format_css_value_handles_edge_values() {
		$this->assertSame( '', openstation_format_css_value( 'padding', null ) );
		$this->assertSame( '', openstation_format_css_value( 'padding', false ) );
		$this->assertSame( '', openstation_format_css_value( 'padding', '' ) );
		$this->assertSame( '', openstation_format_css_value( 'padding', '  ' ) );
		$this->assertSame( '12px', openstation_format_css_value( 'padding', 12 ) );
		$this->assertSame( '12px', openstation_format_css_value( 'padding', '12' ) );
		$this->assertSame( '1.5', openstation_format_css_value( 'opacity', 1.5 ) );
		$this->assertSame( '0', openstation_format_css_value( 'padding', 0 ) );
	}
}
