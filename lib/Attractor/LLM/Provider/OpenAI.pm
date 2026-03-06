package Attractor::LLM::Provider::OpenAI;

use strict;
use warnings;
use parent 'Attractor::LLM::Provider::Base';

use JSON;
use Attractor::LLM::Types;
use Attractor::LLM::Response;

sub new {
    my ($class, %args) = @_;
    $args{api_key}  //= $ENV{OPENAI_API_KEY};
    $args{base_url} //= 'https://api.openai.com';
    return $class->SUPER::new(%args);
}

sub name { 'openai' }

sub complete {
    my ($self, $request) = @_;

    my $body = $self->format_request($request);
    my $raw = $self->_request(
        url     => "$self->{base_url}/v1/responses",
        headers => {
            'Content-Type'  => 'application/json',
            'Authorization' => "Bearer $self->{api_key}",
        },
        body => $body,
    );

    return $self->parse_response($raw);
}

sub format_request {
    my ($self, $request) = @_;

    my @input;
    for my $msg (@{$request->messages}) {
        push @input, $self->_format_message($msg);
    }

    my %body = (
        model => $request->model,
        input => \@input,
    );

    if ($request->system) {
        $body{instructions} = $request->system;
    }

    if (defined $request->temperature) {
        $body{temperature} = $request->temperature;
    }

    if (defined $request->max_tokens) {
        $body{max_output_tokens} = $request->max_tokens;
    }

    if ($request->has_tools) {
        $body{tools} = [map { $self->_format_tool($_) } @{$request->tools}];
    }

    if ($request->reasoning_effort) {
        $body{reasoning} = { effort => $request->reasoning_effort };
    }

    return \%body;
}

sub parse_response {
    my ($self, $raw) = @_;

    my @content;
    my $output = $raw->{output} // [];

    for my $item (@$output) {
        if ($item->{type} eq 'message') {
            for my $part (@{$item->{content} // []}) {
                if ($part->{type} eq 'output_text') {
                    push @content, Attractor::LLM::Types::new_content_part(
                        type => Attractor::LLM::Types::PART_TEXT,
                        text => $part->{text},
                    );
                }
            }
        }
        elsif ($item->{type} eq 'function_call') {
            my $args = $item->{arguments};
            $args = JSON->new->decode($args) if $args && !ref $args;
            push @content, Attractor::LLM::Types::new_content_part(
                type      => Attractor::LLM::Types::PART_TOOL_CALL,
                tool_call => Attractor::LLM::Types::new_tool_call(
                    id        => $item->{call_id} // $item->{id},
                    name      => $item->{name},
                    arguments => $args // {},
                ),
            );
        }
        elsif ($item->{type} eq 'reasoning') {
            for my $part (@{$item->{content} // []}) {
                push @content, Attractor::LLM::Types::new_content_part(
                    type => Attractor::LLM::Types::PART_THINKING,
                    text => $part->{text} // '[reasoning]',
                );
            }
        }
    }

    my $finish = $raw->{status} eq 'incomplete'
        ? Attractor::LLM::Types::FINISH_LENGTH
        : (grep { $_->{type} eq 'function_call' } @$output)
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
            input_tokens     => $usage_raw->{input_tokens} // 0,
            output_tokens    => $usage_raw->{output_tokens} // 0,
            reasoning_tokens => $usage_raw->{reasoning_tokens} // 0,
        ),
        raw => $raw,
    );
}

sub _format_message {
    my ($self, $msg) = @_;

    my $role = $msg->{role};
    $role = 'developer' if $role eq Attractor::LLM::Types::ROLE_SYSTEM;

    if ($role eq Attractor::LLM::Types::ROLE_TOOL) {
        # Tool results in OpenAI Responses API
        my @results;
        for my $part (@{$msg->{content}}) {
            if ($part->{type} eq Attractor::LLM::Types::PART_TOOL_RESULT) {
                push @results, {
                    type    => 'function_call_output',
                    call_id => $part->{tool_result}{tool_call_id},
                    output  => $part->{tool_result}{content},
                };
            }
        }
        return @results;
    }

    my $text = Attractor::LLM::Types::message_text($msg);
    return {
        role    => $role,
        content => $text,
    };
}

sub _format_tool {
    my ($self, $tool) = @_;
    return {
        type       => 'function',
        name       => $tool->{name},
        description => $tool->{description},
        parameters => $tool->{parameters},
    };
}

1;
