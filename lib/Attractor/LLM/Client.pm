package Attractor::LLM::Client;

use strict;
use warnings;

use Attractor::LLM::Types;
use Attractor::LLM::Request;
use Attractor::LLM::Response;
use Attractor::LLM::Provider::OpenAI;
use Attractor::LLM::Provider::Anthropic;
use Attractor::LLM::Provider::Gemini;

# Model catalog mapping model names/aliases to providers
my %MODEL_CATALOG = (
    # Anthropic models
    'claude-opus-4-6'              => { provider => 'anthropic' },
    'claude-sonnet-4-5'            => { provider => 'anthropic' },
    'claude-sonnet-4-5-20250514'   => { provider => 'anthropic' },
    'claude-haiku-4-5-20251001'    => { provider => 'anthropic' },

    # OpenAI models
    'gpt-4o'                       => { provider => 'openai' },
    'gpt-4o-mini'                  => { provider => 'openai' },
    'o1'                           => { provider => 'openai' },
    'o1-mini'                      => { provider => 'openai' },
    'o3'                           => { provider => 'openai' },
    'o3-mini'                      => { provider => 'openai' },

    # Gemini models
    'gemini-2.5-pro'               => { provider => 'gemini' },
    'gemini-2.5-flash'             => { provider => 'gemini' },
    'gemini-2.0-flash'             => { provider => 'gemini' },
);

sub new {
    my ($class, %args) = @_;
    my $self = bless {
        providers   => {},
        default     => $args{default_provider},
        middleware  => $args{middleware} // [],
    }, $class;

    # Auto-register providers based on available API keys
    if ($ENV{ANTHROPIC_API_KEY} || $args{anthropic_api_key}) {
        $self->register_provider(Attractor::LLM::Provider::Anthropic->new(
            api_key => $args{anthropic_api_key},
        ));
    }
    if ($ENV{OPENAI_API_KEY} || $args{openai_api_key}) {
        $self->register_provider(Attractor::LLM::Provider::OpenAI->new(
            api_key => $args{openai_api_key},
        ));
    }
    if ($ENV{GEMINI_API_KEY} || $args{gemini_api_key}) {
        $self->register_provider(Attractor::LLM::Provider::Gemini->new(
            api_key => $args{gemini_api_key},
        ));
    }

    return $self;
}

sub register_provider {
    my ($self, $provider) = @_;
    my $name = $provider->name;
    $self->{providers}{$name} = $provider;
    $self->{default} //= $name;
}

sub complete {
    my ($self, $request) = @_;

    # Apply middleware (request phase)
    for my $mw (@{$self->{middleware}}) {
        $request = $mw->on_request($request) if $mw->can('on_request');
    }

    my $provider = $self->_resolve_provider($request->model);
    my $response = $provider->complete($request);

    # Apply middleware (response phase, reverse order)
    for my $mw (reverse @{$self->{middleware}}) {
        $response = $mw->on_response($response) if $mw->can('on_response');
    }

    return $response;
}

# High-level generate: runs tool loop automatically
sub generate {
    my ($self, %args) = @_;
    my $request      = $args{request};
    my $tool_handler = $args{tool_handler};
    my $max_rounds   = $args{max_rounds} // 20;

    my $total_usage = Attractor::LLM::Types::new_usage();
    my $round = 0;

    while ($round < $max_rounds) {
        $round++;
        my $response = $self->complete($request);
        _merge_usage($total_usage, $response->usage);

        if (!$response->has_tool_calls) {
            return {
                response    => $response,
                total_usage => $total_usage,
                rounds      => $round,
            };
        }

        last unless $tool_handler;

        # Execute tool calls
        my @tool_results;
        for my $call (@{$response->tool_calls}) {
            my $result = eval { $tool_handler->($call) };
            if ($@) {
                push @tool_results, Attractor::LLM::Types::new_tool_result(
                    tool_call_id => $call->{id},
                    content      => "Error: $@",
                    is_error     => 1,
                );
            } else {
                push @tool_results, Attractor::LLM::Types::new_tool_result(
                    tool_call_id => $call->{id},
                    content      => $result // '',
                );
            }
        }

        # Append assistant message and tool results
        push @{$request->{messages}}, $response->message;
        push @{$request->{messages}}, Attractor::LLM::Types::new_message(
            role    => Attractor::LLM::Types::ROLE_TOOL,
            content => [map {
                Attractor::LLM::Types::new_content_part(
                    type        => Attractor::LLM::Types::PART_TOOL_RESULT,
                    tool_result => $_,
                )
            } @tool_results],
        );
    }

    die "Max tool rounds ($max_rounds) exceeded";
}

sub _resolve_provider {
    my ($self, $model) = @_;

    # Check catalog first
    if (my $entry = $MODEL_CATALOG{$model}) {
        my $name = $entry->{provider};
        return $self->{providers}{$name}
            || die "Provider '$name' not registered for model '$model'";
    }

    # Heuristic fallback
    my $name = $model =~ /^claude/   ? 'anthropic'
             : $model =~ /^gemini/   ? 'gemini'
             : $model =~ /^gpt|^o\d/ ? 'openai'
             : $self->{default};

    die "Cannot resolve provider for model '$model'" unless $name;
    return $self->{providers}{$name}
        || die "Provider '$name' not registered";
}

sub _merge_usage {
    my ($total, $add) = @_;
    for my $key (keys %$add) {
        $total->{$key} = ($total->{$key} // 0) + ($add->{$key} // 0);
    }
}

1;
