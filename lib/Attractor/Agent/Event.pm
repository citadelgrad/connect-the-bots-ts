package Attractor::Agent::Event;

use strict;
use warnings;

use Time::HiRes qw(gettimeofday);

# Event types
use constant {
    SESSION_START      => 'SESSION_START',
    USER_INPUT         => 'USER_INPUT',
    ASSISTANT_TEXT     => 'ASSISTANT_TEXT',
    TOOL_CALL_START    => 'TOOL_CALL_START',
    TOOL_CALL_END      => 'TOOL_CALL_END',
    STEERING_INJECTED  => 'STEERING_INJECTED',
    LOOP_DETECTION     => 'LOOP_DETECTION',
    TURN_LIMIT         => 'TURN_LIMIT',
    ERROR              => 'ERROR',
    SESSION_END        => 'SESSION_END',
};

sub new {
    my ($class, %args) = @_;
    my ($sec, $usec) = gettimeofday();
    return bless {
        type      => $args{type},
        data      => $args{data} // {},
        timestamp => $sec + $usec / 1_000_000,
    }, $class;
}

sub type      { $_[0]->{type} }
sub data      { $_[0]->{data} }
sub timestamp { $_[0]->{timestamp} }

# Simple event emitter
package Attractor::Agent::EventEmitter;

use strict;
use warnings;

sub new {
    my ($class) = @_;
    return bless { listeners => [] }, $class;
}

sub on {
    my ($self, $callback) = @_;
    push @{$self->{listeners}}, $callback;
}

sub emit {
    my ($self, $event) = @_;
    for my $listener (@{$self->{listeners}}) {
        eval { $listener->($event) };
        warn "Event listener error: $@" if $@;
    }
}

1;
