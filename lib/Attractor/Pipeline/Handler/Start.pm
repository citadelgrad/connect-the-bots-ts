package Attractor::Pipeline::Handler::Start;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Handler::Base';

sub type { 'start' }

sub execute {
    my ($self, $node, $context) = @_;
    return $self->_success(notes => 'Pipeline started');
}

1;
