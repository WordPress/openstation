# Tune the AI model config

Every AI turn OpenStation generates (Copilot search, the command follow-up, the comment scorer, the Agents runner, the Drafts writing assistant) passes its model config through [`openstation_ai_model_config`](../hooks-reference.md#openstation_ai_model_config--experimental) first. It defaults to empty: OpenStation pins neither provider nor model.

```php
apply_filters( 'openstation_ai_model_config', array $config, array $context );
```

| Key | Type | Notes |
|---|---|---|
| `model` | `string\|ModelInterface` | Model id, or an SDK model instance. Anything else is ignored. |
| `max_tokens` | `int` | Output-token ceiling. Must be > 0. |
| `temperature` | `float` | Sampling randomness. `0.0` is valid. Anthropic's Claude Opus 4.7 and later and Claude Sonnet 5 reject any non-default value with a 400, so leave it unset for those models. |
| `custom_options` | `array<string, mixed>` | Provider-native parameters, forwarded verbatim. Also feeds model discovery. |

## Model and ceiling

```php
add_filter(
	'openstation_ai_model_config',
	function ( $config, $context ) {
		$config['model']      = 'claude-sonnet-5';
		$config['max_tokens'] = 16000;

		return $config;
	},
	10,
	2
);
```

## Reasoning effort (`custom_options`)

```php
add_filter(
	'openstation_ai_model_config',
	function ( $config, $context ) {
		$config['max_tokens']     = 16000;
		$config['custom_options'] = array(
			'thinking'      => array( 'type' => 'adaptive' ),
			'output_config' => array( 'effort' => 'low' ),
		);

		return $config;
	},
	10,
	2
);
```

That pair is the Anthropic Claude 5 shape; older Anthropic models reject it and want `thinking: { type: 'enabled', budget_tokens: N }` instead. Check your provider's reference before copying — this is why OpenStation ships no default.

Thinking tokens count toward `max_tokens`. A ceiling sized for a reply without thinking can end the turn inside its reasoning, with no answer text, so leave headroom.

## Spend effort only where it pays

`$context['source']` names the calling path, so a long agent run and the background comment scorer need not share a setting:

```php
add_filter(
	'openstation_ai_model_config',
	function ( $config, $context ) {
		// Short, schema-constrained classification gets the least effort;
		// a long agent run gets the most.
		$effort = 'low';
		if ( 'agents/runner' === $context['source'] ) {
			$effort = 'medium';
		}

		$config['max_tokens']     = 16000;
		$config['custom_options'] = array(
			'thinking'      => array( 'type' => 'adaptive' ),
			'output_config' => array( 'effort' => $effort ),
		);

		return $config;
	},
	10,
	2
);
```

`source` is one of `ai-copilot/search`, `ai-copilot/followup`, `ai-copilot/comment-analysis`, `agents/runner`, `agents/draft`, `widgets/drafts-suggestions`, `mio/window`. The rest of `$context`: `user_id`, `request_id` (the `/ai/search` correlation UUID, `''` where the path mints none), `has_tools`, `has_schema`.
