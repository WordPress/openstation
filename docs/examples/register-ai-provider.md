# Register a custom AI provider

The shell ships with the OpenAI Responses API as the default provider. Other back-ends — Anthropic Claude, Google Gemini, a self-hosted Ollama instance — register through the same registry that powers OpenAI. The shell drives the agentic loop, observability, and tool dispatch; the provider is responsible only for translating the shell's normalized request into its vendor's wire format and back.

This page walks through a minimal Anthropic implementation. The same shape applies to any provider.

## What you implement

Three callables, all small:

- `make_turn_input( $kind, $payload )` — build whatever you'd like to receive in `agentic_call` next turn. Opaque to the shell.
- `agentic_call( $api_key, $turn_input, $tools, $text_format, $instructions, $state )` — one turn of the agentic loop.
- `structured_request( $api_key, $messages, $schema, $schema_name, $model )` — single-shot structured-output request (used by the post / term / comment analysis jobs).

Plus metadata: a label, a link to where the user gets an API key, an optional default model.

## Registration

```php
add_action( 'wp_desktop_ai_register_providers', function () {
    wp_register_desktop_ai_provider( 'anthropic', array(
        'label'              => 'Anthropic Claude',
        'description'        => 'Anthropic Messages API.',
        'api_key_label'      => 'Anthropic API key',
        'api_key_link'       => 'https://console.anthropic.com/settings/keys',
        'default_model'      => 'claude-sonnet-4-6',
        'capabilities'       => array( 'tools', 'structured_output' ),
        'make_turn_input'    => 'my_anthropic_make_turn_input',
        'agentic_call'       => 'my_anthropic_agentic_call',
        'structured_request' => 'my_anthropic_structured_request',
    ) );
} );
```

Use `wp_desktop_ai_register_providers` rather than `init` directly — registration runs lazily on first lookup, so order doesn't depend on plugin load priority.

## Building turn inputs

```php
/**
 * @param string $kind    'user_message' | 'tool_results'
 * @param mixed  $payload string for 'user_message'; array of {call_id, output} for 'tool_results'.
 */
function my_anthropic_make_turn_input( $kind, $payload ) {
    if ( 'user_message' === $kind ) {
        return array(
            array( 'role' => 'user', 'content' => (string) $payload ),
        );
    }

    if ( 'tool_results' === $kind && is_array( $payload ) ) {
        // Anthropic carries tool results in a user-role message containing
        // tool_result content blocks.
        $blocks = array();
        foreach ( $payload as $r ) {
            $blocks[] = array(
                'type'        => 'tool_result',
                'tool_use_id' => (string) ( $r['call_id'] ?? '' ),
                'content'     => (string) ( $r['output'] ?? '' ),
            );
        }
        return array( array( 'role' => 'user', 'content' => $blocks ) );
    }

    return array();
}
```

The shell never inspects the return value — it just hands it back to your `agentic_call` for the next turn.

## One agentic turn

```php
function my_anthropic_agentic_call(
    $api_key,
    $turn_input,
    array $tools,
    $text_format,
    $instructions,
    $state = null
) {
    // Anthropic doesn't have OpenAI's `previous_response_id` — accumulate
    // the full message history in $state instead.
    $messages = is_array( $state['messages'] ?? null ) ? $state['messages'] : array();
    $messages = array_merge( $messages, (array) $turn_input );

    $response = wp_remote_post(
        'https://api.anthropic.com/v1/messages',
        array(
            'timeout' => 30,
            'headers' => array(
                'Content-Type'      => 'application/json',
                'x-api-key'         => $api_key,
                'anthropic-version' => '2023-06-01',
            ),
            'body' => wp_json_encode( array(
                'model'       => apply_filters( 'wp_desktop_ai_model', 'claude-sonnet-4-6', 'agentic_search' ),
                'system'      => $instructions,
                'messages'    => $messages,
                'tools'       => my_anthropic_translate_tools( $tools ),
                'max_tokens'  => 4096,
            ) ),
        )
    );

    if ( is_wp_error( $response ) ) {
        return $response;
    }

    $code = (int) wp_remote_retrieve_response_code( $response );
    $body = json_decode( wp_remote_retrieve_body( $response ), true );

    if ( 200 !== $code || ! is_array( $body ) ) {
        return new WP_Error(
            'my_anthropic_http',
            isset( $body['error']['message'] ) ? $body['error']['message'] : "HTTP {$code}.",
            array( 'status' => $code )
        );
    }

    // Pull text + tool calls out of Anthropic's content blocks.
    $text           = null;
    $function_calls = array();
    $assistant_msg  = array( 'role' => 'assistant', 'content' => $body['content'] ?? array() );

    foreach ( (array) ( $body['content'] ?? array() ) as $block ) {
        if ( 'text' === ( $block['type'] ?? '' ) ) {
            $text = $block['text'];
        }
        if ( 'tool_use' === ( $block['type'] ?? '' ) ) {
            $function_calls[] = array(
                'name'      => (string) ( $block['name'] ?? '' ),
                'call_id'   => (string) ( $block['id'] ?? '' ),
                'arguments' => wp_json_encode( $block['input'] ?? new stdClass() ),
            );
        }
    }

    return array(
        'text'           => $text,
        'function_calls' => $function_calls,
        // Anthropic needs full history every turn — stash it in state.
        'next_state'     => array( 'messages' => array_merge( $messages, array( $assistant_msg ) ) ),
        'raw'            => $body,
    );
}
```

`my_anthropic_translate_tools()` is a small helper that reshapes the OpenAI Responses API tool list (the format the shell ships) into Anthropic's `{ name, description, input_schema }` shape. Keep it next to your provider for clarity.

## Single-shot structured output

```php
function my_anthropic_structured_request(
    $api_key,
    array $messages,
    array $schema,
    $schema_name,
    $model = ''
) {
    // Anthropic doesn't ship native structured output today; emulate it
    // by passing a single tool whose only purpose is to return the data
    // shape, and reading the tool_use block off the response.
    $tool = array(
        'name'         => (string) $schema_name,
        'description'  => 'Return the structured analysis.',
        'input_schema' => $schema,
    );
    // … same wp_remote_post call as agentic_call, with this single tool
    // and tool_choice forced to it; pull the input off the tool_use block.
    return array( /* parsed JSON object */ );
}
```

## API keys

Each provider gets its own slot in OS Settings → AI. Users can keep keys for several providers and switch between them without losing any. The active key resolves through:

1. Per-user `apiKeys[<provider_id>]` (preferred).
2. Per-user legacy `apiKey` field — only honoured for `openai` (backwards compat).
3. Platform `apiKeys[<provider_id>]`.
4. Platform legacy `apiKey` — only for `openai`.

You don't have to do anything to participate; the shell already plumbs the resolved key into your callbacks via the `$api_key` argument.

## Picking the active provider per-request

If you want to route specific requests to a specific provider — say, "force admins to use Anthropic" — filter `wp_desktop_ai_active_provider`:

```php
add_filter( 'wp_desktop_ai_active_provider', function ( $id, $user_id ) {
    return user_can( $user_id, 'manage_options' ) ? 'anthropic' : $id;
}, 10, 2 );
```

The filter runs every time the system asks "which provider for this user?", so you can branch on `$_REQUEST`, `request_id` from the AI observability hooks, or anything else in scope.

## Built-in providers

The OpenAI provider lives in `includes/ai-copilot/openai.php`. It's the reference implementation — read it whenever you need a template for what each callback returns.
