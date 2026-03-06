package Attractor::LLM::Provider::Anthropic;

use strict;
use warnings;
use parent 'Attractor::LLM::Provider::Base';

use Attractor::LLM::Types;
use Attractor::LLM::Response;

sub new {
    my ($class, %args) = @_;
    $args{api_key}  //= $ENV{ANTHROPIC_API_KEY};
    $args{base_url} //= 'https://api.anthropic.com';
    my $self = $class->SUPER::new(%args);
    $self->{api_version} = $args{api_version} // '2023-06-01';
    return $self;
}

sub name { 'anthropic' }

sub complete {
    my ($self, $request) = @_;

    my $body = $self->format_request($request);
    my $headers = {
        'Content-Type'      => 'application/json',
        'x-api-key'         => $self->{api_key},
        'anthropic-version' => $self->{api_version},
    };

    # Add beta headers for thinking
    if ($request->reasoning_effort) {
        $headers->{'anthropic-beta'} = 'interleaved-thinking-2025-05-14';
    }

    my $raw = $self->_request(
        url     => "$self->{base_url}/v1/messages",
        headers => $headers,
        body    => $body,
    );

    return $self->parse_response($raw);
}

sub format_request {
    my ($self, $request) = @_;

    my @messages;
    my $system_text;

    for my $msg (@{$request->messages}) {
        if ($msg->{role} eq Attractor::LLM::Types::ROLE_SYSTEM) {
            $system_text = Attractor::LLM::Types::message_text($msg);
            next;
        }
        push @messages, $self->_format_message($msg);
    }

    $system_text //= $request->system // '';

    # Ensure strict message alternation
    @messages = $self->_ensure_alternation(@messages);

    my %body = (
        model      => $request->model,
        messages   => \@messages,
        max_tokens => $request->max_tokens // 4096,
    );

    $body{system} = $system_text if $system_text;

    if (defined $request->temperature) {
        $body{temperature} = $request->temperature;
    }

    if ($request->has_tools) {
        $body{tools} = [map { $self->_format_tool($_) } @{$request->tools}];
    }

    if ($request->reasoning_effort) {
        $body{thinking} = {
            type          => 'enabled',
            budget_tokens => $self->_effort_to_budget($request->reasoning_effort),
        };
    }

    return \%body;
}

sub parse_response {
    my ($self, $raw) = @_;

    my @content;
    for my $block (@{$raw->{content} // []}) {
        if ($block->{type} eq 'text') {
            push @content, Attractor::LLM::Types::new_content_part(
                type => Attractor::LLM::Types::PART_TEXT,
                text => $block->{text},
            );
        }
        elsif ($block->{type} eq 'tool_use') {
            push @content, Attractor::LLM::Types::new_content_part(
                type      => Attractor::LLM::Types::PART_TOOL_CALL,
                tool_call => Attractor::LLM::Types::new_tool_call(
                    id        => $block->{id},
                    name      => $block->{name},
                    arguments => $block->{input},
                ),
            );
        }
        elsif ($block->{type} eq 'thinking') {
            push @content, Attractor::LLM::Types::new_content_part(
                type => Attractor::LLM::Types::PART_THINKING,
                text => $block->{thinking},
            );
        }
    }

    my $finish = $raw->{stop_reason} eq 'tool_use'
        ? Attractor::LLM::Types::FINISH_TOOL_USE
        : Attractor::LLM::Types::FINISH_STOP;

    my $usage_raw = $raw->{usage} // {};

    return Attractor::LLM::Response->new(
        message       => Attractor::LLM::Types::new_message(
            role    => Attractor::LLM::Types::ROLE_ASSISTANT,
            content => \@content,
        ),
        finish_reason => $finish,
        usage         => Attractor::LLM::Types::new_usage(
            input_tokens       => $usage_raw->{input_tokens} // 0,
            output_tokens      => $usage_raw->{output_tokens} // 0,
            cache_read_tokens  => $usage_raw->{cache_read_input_tokens} // 0,
            cache_write_tokens => $usage_raw->{cache_creation_input_tokens} // 0,
        ),
        raw => $raw,
    );
}

sub _format_message {
    my ($self, $msg) = @_;

    my $role = $msg->{role};
    $role = 'user' if $role eq Attractor::LLM::Types::ROLE_DEVELOPER;

    my @content;
    for my $part (@{$msg->{content}}) {
        if ($part->{type} eq Attractor::LLM::Types::PART_TEXT) {
            push @content, { type => 'text', text => $part->{text} };
        }
        elsif ($part->{type} eq Attractor::LLM::Types::PART_TOOL_CALL) {
            push @content, {
                type  => 'tool_use',
                id    => $part->{tool_call}{id},
                name  => $part->{tool_call}{name},
                input => $part->{tool_call}{arguments},
            };
        }
        elsif ($part->{type} eq Attractor::LLM::Types::PART_TOOL_RESULT) {
            push @content, {
                type       => 'tool_result',
                tool_use_id => $part->{tool_result}{tool_call_id},
                content    => $part->{tool_result}{content},
                ($part->{tool_result}{is_error} ? (is_error => JSON::true) : ()),
            };
        }
        elsif ($part->{type} eq Attractor::LLM::Types::PART_IMAGE) {
            push @content, {
                type   => 'image',
                source => $part->{source},
            };
        }
    }

    return {
        role    => $role,
        content => \@content,
    };
}

sub _format_tool {
    my ($self, $tool) = @_;
    return {
        name         => $tool->{name},
        description  => $tool->{description},
        input_schema => $tool->{parameters},
    };
}

sub _ensure_alternation {
    my ($self, @messages) = @_;
    my @result;
    for my $msg (@messages) {
        if (@result && $result[-1]{role} eq $msg->{role}) {
            # Merge content into previous message of same role
            my $prev = $result[-1];
            if (ref $prev->{content} eq 'ARRAY' && ref $msg->{content} eq 'ARRAY') {
                push @{$prev->{content}}, @{$msg->{content}};
            }
        } else {
            push @result, $msg;
        }
    }
    return @result;
}

sub _effort_to_budget {
    my ($self, $effort) = @_;
    my %budgets = (low => 1024, medium => 4096, high => 16384);
    return $budgets{$effort} // 4096;
}

1;
