package Attractor::Pipeline::Handler::Codergen;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Handler::Base';

# LLM task handler: builds a prompt, calls the LLM backend, writes prompt/response.

sub type { 'codergen' }

sub execute {
    my ($self, $node, $context) = @_;
    my $attrs = $node->{attributes};

    # Build prompt from node attributes and context
    my $prompt = $attrs->{prompt} // $attrs->{label} // "Execute task: $node->{id}";

    # Expand context variables in prompt
    $prompt = $self->_expand_vars($prompt, $context);

    # Get LLM config from stylesheet or node attributes
    my $model = $attrs->{llm_model} // 'claude-sonnet-4-5';

    # Save prompt
    my $checkpoint = $self->{engine}{checkpoint};
    $checkpoint->save_prompt($node->{id}, $prompt) if $checkpoint;

    # Call LLM via the engine's agent session
    my $session = $self->{engine}{session};
    unless ($session) {
        return $self->_fail(notes => 'No agent session available for LLM call');
    }

    my $result = eval { $session->process_input($prompt) };
    if ($@) {
        return $self->_fail(
            notes           => "LLM call failed: $@",
            context_updates => { error => "$@" },
        );
    }

    my $response_text = $result->{text} // '';

    # Save response
    $checkpoint->save_response($node->{id}, $response_text) if $checkpoint;

    return $self->_success(
        notes           => "LLM response received",
        context_updates => {
            response      => $response_text,
            llm_model     => $model,
        },
    );
}

sub _expand_vars {
    my ($self, $text, $context) = @_;
    $text =~ s/\$\{(\w+)\}/$context->get($1) \/\/ "\${$1}"/ge;
    $text =~ s/\$(\w+)/$context->get($1) \/\/ "\$$1"/ge;
    return $text;
}

1;
