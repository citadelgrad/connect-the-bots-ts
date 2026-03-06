package Attractor::Pipeline::Handler::Conditional;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Handler::Base';

# Pass-through node. The engine evaluates edge conditions for routing.

sub type { 'conditional' }

sub execute {
    my ($self, $node, $context) = @_;
    return $self->_success(notes => 'Conditional pass-through');
}

1;
