package Attractor::Agent::Tool::Base;

use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    return bless {
        env => $args{env},
    }, $class;
}

sub name        { die ref($_[0]) . "::name not implemented" }
sub description { die ref($_[0]) . "::description not implemented" }
sub parameters  { die ref($_[0]) . "::parameters not implemented" }

sub execute {
    die ref($_[0]) . "::execute not implemented";
}

sub definition {
    my ($self) = @_;
    return {
        name        => $self->name,
        description => $self->description,
        parameters  => $self->parameters,
    };
}

1;
