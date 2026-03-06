package Attractor::Pipeline::Handler::StackManager;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Handler::Base';

# Supervisor that polls for child pipeline completion.

sub type { 'stack.manager_loop' }

sub execute {
    my ($self, $node, $context) = @_;

    my $attrs = $node->{attributes};
    my $child_pipeline = $attrs->{child_pipeline};

    unless ($child_pipeline) {
        return $self->_fail(notes => 'No child_pipeline specified');
    }

    # Check if child pipeline result is in context
    my $child_status = $context->get("child.$child_pipeline.status");

    if (defined $child_status) {
        if ($child_status eq 'success') {
            return $self->_success(
                notes           => "Child pipeline '$child_pipeline' completed successfully",
                context_updates => {
                    child_outcome => 'success',
                },
            );
        }
        else {
            return $self->_fail(
                notes           => "Child pipeline '$child_pipeline' failed: $child_status",
                context_updates => {
                    child_outcome => $child_status,
                },
            );
        }
    }

    # If no status yet, this indicates the child pipeline needs to be launched
    return $self->_success(
        notes           => "Waiting for child pipeline '$child_pipeline'",
        preferred_label => 'pending',
        context_updates => {
            'child.pipeline'   => $child_pipeline,
            'child.status'     => 'pending',
        },
    );
}

1;
