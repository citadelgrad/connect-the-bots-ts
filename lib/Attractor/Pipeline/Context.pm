package Attractor::Pipeline::Context;

use strict;
use warnings;

use Storable qw(dclone);

# Shared key-value store accessible to all handlers.

sub new {
    my ($class, %initial) = @_;
    return bless {
        data => {%initial},
    }, $class;
}

sub get {
    my ($self, $key) = @_;
    return $self->{data}{$key};
}

sub set {
    my ($self, $key, $value) = @_;
    $self->{data}{$key} = $value;
}

sub merge {
    my ($self, $updates) = @_;
    return unless ref $updates eq 'HASH';
    for my $key (keys %$updates) {
        $self->{data}{$key} = $updates->{$key};
    }
}

sub to_hash {
    my ($self) = @_;
    return dclone($self->{data});
}

sub clone {
    my ($self) = @_;
    return Attractor::Pipeline::Context->new(%{dclone($self->{data})});
}

sub snapshot {
    my ($self) = @_;
    return dclone($self->{data});
}

1;
