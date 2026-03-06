package Attractor::LLM::Response;

use strict;
use warnings;

use Attractor::LLM::Types;

sub new {
    my ($class, %args) = @_;
    return bless {
        message       => $args{message},
        finish_reason => $args{finish_reason} // Attractor::LLM::Types::FINISH_STOP,
        usage         => $args{usage} // Attractor::LLM::Types::new_usage(),
        raw           => $args{raw},
    }, $class;
}

sub message       { $_[0]->{message} }
sub finish_reason { $_[0]->{finish_reason} }
sub usage         { $_[0]->{usage} }
sub raw           { $_[0]->{raw} }

sub text {
    my ($self) = @_;
    return Attractor::LLM::Types::message_text($self->{message});
}

sub tool_calls {
    my ($self) = @_;
    return Attractor::LLM::Types::message_tool_calls($self->{message});
}

sub has_tool_calls {
    my ($self) = @_;
    return scalar @{$self->tool_calls} > 0;
}

1;
