package Attractor::LLM::Types;

use strict;
use warnings;

use Scalar::Util qw(blessed);

# Roles for messages
use constant {
    ROLE_SYSTEM    => 'system',
    ROLE_USER      => 'user',
    ROLE_ASSISTANT => 'assistant',
    ROLE_TOOL      => 'tool',
    ROLE_DEVELOPER => 'developer',
};

# Content part types
use constant {
    PART_TEXT              => 'text',
    PART_IMAGE             => 'image',
    PART_AUDIO             => 'audio',
    PART_DOCUMENT          => 'document',
    PART_TOOL_CALL         => 'tool_call',
    PART_TOOL_RESULT       => 'tool_result',
    PART_THINKING          => 'thinking',
    PART_REDACTED_THINKING => 'redacted_thinking',
};

# Finish reasons
use constant {
    FINISH_STOP       => 'stop',
    FINISH_TOOL_USE   => 'tool_use',
    FINISH_LENGTH     => 'length',
    FINISH_ERROR      => 'error',
};

# Stream event types
use constant {
    STREAM_START      => 'start',
    STREAM_DELTA      => 'delta',
    STREAM_END        => 'end',
    STREAM_TOOL_START => 'tool_start',
    STREAM_TOOL_DELTA => 'tool_delta',
    STREAM_TOOL_END   => 'tool_end',
};

sub new_content_part {
    my (%args) = @_;
    return {
        type => $args{type} // PART_TEXT,
        text => $args{text},
        ($args{source}    ? (source    => $args{source})    : ()),
        ($args{tool_call} ? (tool_call => $args{tool_call}) : ()),
        ($args{tool_result} ? (tool_result => $args{tool_result}) : ()),
    };
}

sub new_message {
    my (%args) = @_;
    my $content = $args{content};
    if (!ref $content) {
        $content = [new_content_part(type => PART_TEXT, text => $content)];
    }
    return {
        role    => $args{role} // ROLE_USER,
        content => $content,
    };
}

sub new_tool_call {
    my (%args) = @_;
    return {
        id        => $args{id} // _generate_id(),
        name      => $args{name},
        arguments => $args{arguments} // {},
    };
}

sub new_tool_result {
    my (%args) = @_;
    return {
        tool_call_id => $args{tool_call_id},
        content      => $args{content} // '',
        is_error     => $args{is_error} // 0,
    };
}

sub new_tool_def {
    my (%args) = @_;
    return {
        name        => $args{name},
        description => $args{description} // '',
        parameters  => $args{parameters} // { type => 'object', properties => {} },
    };
}

sub new_usage {
    my (%args) = @_;
    return {
        input_tokens       => $args{input_tokens}       // 0,
        output_tokens      => $args{output_tokens}      // 0,
        reasoning_tokens   => $args{reasoning_tokens}   // 0,
        cache_read_tokens  => $args{cache_read_tokens}   // 0,
        cache_write_tokens => $args{cache_write_tokens}  // 0,
    };
}

sub _generate_id {
    my @chars = ('a'..'z', '0'..'9');
    my $id = 'call_';
    $id .= $chars[rand @chars] for 1..24;
    return $id;
}

# Extract plain text from a message
sub message_text {
    my ($msg) = @_;
    return '' unless $msg && $msg->{content};
    if (!ref $msg->{content}) {
        return $msg->{content};
    }
    return join('', map { $_->{text} // '' }
        grep { $_->{type} eq PART_TEXT } @{$msg->{content}});
}

# Extract tool calls from a message
sub message_tool_calls {
    my ($msg) = @_;
    return [] unless $msg && $msg->{content};
    return [
        map { $_->{tool_call} }
        grep { $_->{type} eq PART_TOOL_CALL && $_->{tool_call} }
        @{$msg->{content}}
    ];
}

1;
