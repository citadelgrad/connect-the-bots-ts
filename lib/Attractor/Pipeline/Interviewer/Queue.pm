package Attractor::Pipeline::Interviewer::Queue;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Interviewer::Base';

# Deterministic testing interviewer with pre-loaded answers.

sub new {
    my ($class, %args) = @_;
    my $self = $class->SUPER::new(%args);
    $self->{queue} = $args{answers} // [];
    $self->{index} = 0;
    return $self;
}

sub enqueue {
    my ($self, @answers) = @_;
    push @{$self->{queue}}, @answers;
}

sub ask {
    my ($self, $prompt, $choices) = @_;

    if ($self->{index} < @{$self->{queue}}) {
        my $answer = $self->{queue}[$self->{index}++];
        # If the answer matches a choice label, use it; otherwise use first choice
        return $answer if grep { $_ eq $answer } @$choices;
        return $choices->[0];
    }

    die "QueueInterviewer exhausted: no more answers (prompt: $prompt)";
}

1;
