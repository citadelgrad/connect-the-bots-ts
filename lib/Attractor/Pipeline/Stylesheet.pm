package Attractor::Pipeline::Stylesheet;

use strict;
use warnings;

# CSS-like model stylesheet for LLM configuration.
# Specificity: universal (*) < class (.code) < ID (#critical)

sub new {
    my ($class) = @_;
    return bless { rules => [] }, $class;
}

sub parse {
    my ($self, $source) = @_;
    return unless defined $source && length $source;

    # Parse rules: selector { property: value; ... } or selector [property: value]
    while ($source =~ /([*#.\w]+)\s*[\{\[]\s*([^}\]]*)\s*[\}\]]/g) {
        my ($selector, $body) = ($1, $2);
        my %props;
        while ($body =~ /([\w_]+)\s*:\s*([^;}\]]+)/g) {
            my ($prop, $val) = ($1, $2);
            $val =~ s/^\s+|\s+$//g;
            $props{$prop} = $val;
        }
        push @{$self->{rules}}, {
            selector    => $selector,
            specificity => $self->_specificity($selector),
            properties  => \%props,
        };
    }

    # Sort by specificity (ascending, so later = higher priority)
    @{$self->{rules}} = sort { $a->{specificity} <=> $b->{specificity} } @{$self->{rules}};
}

sub resolve {
    my ($self, $node) = @_;
    my $id     = $node->{id} // '';
    my $class  = $node->{attributes}{class} // '';
    my %result;

    for my $rule (@{$self->{rules}}) {
        my $sel = $rule->{selector};
        my $matches = 0;

        if ($sel eq '*') {
            $matches = 1;
        }
        elsif ($sel =~ /^\.(.+)$/) {
            $matches = 1 if $class eq $1;
        }
        elsif ($sel =~ /^#(.+)$/) {
            $matches = 1 if $id eq $1;
        }
        elsif ($sel eq $id) {
            $matches = 1;
        }

        if ($matches) {
            %result = (%result, %{$rule->{properties}});
        }
    }

    return \%result;
}

sub _specificity {
    my ($self, $selector) = @_;
    return 0 if $selector eq '*';
    return 1 if $selector =~ /^\./;
    return 2 if $selector =~ /^#/;
    return 1; # bare name treated as class-level
}

1;
