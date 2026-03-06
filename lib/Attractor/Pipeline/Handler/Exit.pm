package Attractor::Pipeline::Handler::Exit;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Handler::Base';

sub type { 'exit' }

sub execute {
    my ($self, $node, $context) = @_;
    return $self->_success(notes => 'Pipeline completed');
}

1;
