package Attractor::Pipeline::Handler::WaitHuman;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Handler::Base';

# Blocks until a human selects from edge options.

sub type { 'wait.human' }

sub execute {
    my ($self, $node, $context) = @_;

    my $engine = $self->{engine};
    my $interviewer = $engine->{interviewer};

    unless ($interviewer) {
        return $self->_fail(notes => 'No interviewer configured for human gate');
    }

    # Derive choices from outgoing edge labels
    my @edges = grep { $_->{from} eq $node->{id} } @{$engine->{graph}{edges}};
    my @choices = map {
        $_->{attributes}{label} // $_->{to}
    } @edges;

    unless (@choices) {
        return $self->_fail(notes => 'No choices available for human gate');
    }

    # Present choices to interviewer
    my $prompt = $node->{attributes}{prompt}
              // $node->{attributes}{label}
              // "Select next action:";

    my $selected = $interviewer->ask($prompt, \@choices);

    return $self->_success(
        preferred_label => $selected,
        notes           => "Human selected: $selected",
        context_updates => { human_choice => $selected },
    );
}

1;
