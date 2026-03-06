package Attractor::LLM::Provider::Gemini;

use strict;
use warnings;
use parent 'Attractor::LLM::Provider::Base';

use JSON;
use Attractor::LLM::Types;
use Attractor::LLM::Response;

sub new {
    my ($class, %args) = @_;
    $args{api_key}  //= $ENV{GEMINI_API_KEY};
    $args{base_url} //= 'https://generativelanguage.googleapis.com';
    return $class->SUPER::new(%args);
}

sub name { 'gemini' }

sub complete {
    my ($self, $request) = @_;

    my $body = $self->format_request($request);
    my $model = $request->model;
    my $url = "$self->{base_url}/v1beta/models/$model:generateContent?key=$self->{api_key}";

    my $raw = $self->_request(
        url     => $url,
        headers => { 'Content-Type' => 'application/json' },
        body    => $body,
    );

    return $self->parse_response($raw);
}

sub format_request {
    my ($self, $request) = @_;

    my @contents;
    my $system_instruction;

    for my $msg (@{$request->messages}) {
        if ($msg->{role} eq Attractor::LLM::Types::ROLE_SYSTEM) {
            $system_instruction = {
                parts => [{ text => Attractor::LLM::Types::message_text($msg) }],
            };
            next;
        }
        push @contents, $self->_format_message($msg);
    }

    if (!$system_instruction && $request->system) {
        $system_instruction = {
            parts => [{ text => $request->system }],
        };
    }

    my %body = (contents => \@contents);
    $body{systemInstruction} = $system_instruction if $system_instruction;

    my %generation_config;
    $generation_config{temperature}    = $request->temperature if defined $request->temperature;
    $generation_config{maxOutputTokens} = $request->max_tokens  if defined $request->max_tokens;
    $body{generationConfig} = \%generation_config if %generation_config;

    if ($request->has_tools) {
        $body{tools} = [{
            functionDeclarations => [
                map { $self->_format_tool($_) } @{$request->tools}
            ],
        }];
    }

    return \%body;
}

sub parse_response {
    my ($self, $raw) = @_;

    my @content;
    my $candidate = ($raw->{candidates} // [])->[0] // {};
    my $parts = $candidate->{content}{parts} // [];

    for my $part (@$parts) {
        if (exists $part->{text}) {
            push @content, Attractor::LLM::Types::new_content_part(
                type => Attractor::LLM::Types::PART_TEXT,
                text => $part->{text},
            );
        }
        elsif (exists $part->{functionCall}) {
            my $fc = $part->{functionCall};
            push @content, Attractor::LLM::Types::new_content_part(
                type      => Attractor::LLM::Types::PART_TOOL_CALL,
                tool_call => Attractor::LLM::Types::new_tool_call(
                    id        => $fc->{name} . '_' . int(rand(100000)),
                    name      => $fc->{name},
                    arguments => $fc->{args} // {},
                ),
            );
        }
        elsif (exists $part->{thought}) {
            push @content, Attractor::LLM::Types::new_content_part(
                type => Attractor::LLM::Types::PART_THINKING,
                text => $part->{thought},
            );
        }
    }

    my $finish_reason = $candidate->{finishReason} // 'STOP';
    my $finish = $finish_reason eq 'MAX_TOKENS'
        ? Attractor::LLM::Types::FINISH_LENGTH
        : (grep { exists $_->{functionCall} } @$parts)
            ? Attractor::LLM::Types::FINISH_TOOL_USE
            : Attractor::LLM::Types::FINISH_STOP;

    my $usage_raw = $raw->{usageMetadata} // {};

    return Attractor::LLM::Response->new(
        message       => Attractor::LLM::Types::new_message(
            role    => Attractor::LLM::Types::ROLE_ASSISTANT,
            content => \@content,
        ),
        finish_reason => $finish,
        usage         => Attractor::LLM::Types::new_usage(
            input_tokens  => $usage_raw->{promptTokenCount} // 0,
            output_tokens => $usage_raw->{candidatesTokenCount} // 0,
        ),
        raw => $raw,
    );
}

sub _format_message {
    my ($self, $msg) = @_;

    my $role = $msg->{role};
    $role = 'user'  if $role eq Attractor::LLM::Types::ROLE_DEVELOPER;
    $role = 'model' if $role eq Attractor::LLM::Types::ROLE_ASSISTANT;

    my @parts;
    for my $part (@{$msg->{content}}) {
        if ($part->{type} eq Attractor::LLM::Types::PART_TEXT) {
            push @parts, { text => $part->{text} };
        }
        elsif ($part->{type} eq Attractor::LLM::Types::PART_TOOL_CALL) {
            push @parts, {
                functionCall => {
                    name => $part->{tool_call}{name},
                    args => $part->{tool_call}{arguments},
                },
            };
        }
        elsif ($part->{type} eq Attractor::LLM::Types::PART_TOOL_RESULT) {
            push @parts, {
                functionResponse => {
                    name     => $part->{tool_result}{tool_call_id},
                    response => { result => $part->{tool_result}{content} },
                },
            };
        }
    }

    return {
        role  => $role,
        parts => \@parts,
    };
}

sub _format_tool {
    my ($self, $tool) = @_;
    return {
        name        => $tool->{name},
        description => $tool->{description},
        parameters  => $tool->{parameters},
    };
}

1;
