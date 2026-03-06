package Attractor::Pipeline::Condition;

use strict;
use warnings;

# Minimal boolean expression language for edge conditions.
# Supports: = (equals), != (not equals), && (AND conjunction)
# Variables: outcome, preferred_label, context.*

sub new {
    my ($class) = @_;
    return bless {}, $class;
}

sub evaluate {
    my ($self, $expression, $context) = @_;

    return 1 unless defined $expression && length $expression;

    # Split on && and evaluate each clause
    my @clauses = split /\s*&&\s*/, $expression;
    for my $clause (@clauses) {
        $clause =~ s/^\s+|\s+$//g;
        return 0 unless $self->_evaluate_clause($clause, $context);
    }
    return 1;
}

sub _evaluate_clause {
    my ($self, $clause, $context) = @_;

    if ($clause =~ /^(.+?)\s*!=\s*(.+)$/) {
        my ($var, $val) = ($1, $2);
        $var =~ s/^\s+|\s+$//g;
        $val =~ s/^\s+|\s+$//g;
        $val =~ s/^"(.*)"$/$1/;
        my $resolved = $self->_resolve_var($var, $context);
        return (defined $resolved && $resolved ne $val) ? 1 : 0;
    }
    elsif ($clause =~ /^(.+?)\s*=\s*(.+)$/) {
        my ($var, $val) = ($1, $2);
        $var =~ s/^\s+|\s+$//g;
        $val =~ s/^\s+|\s+$//g;
        $val =~ s/^"(.*)"$/$1/;
        my $resolved = $self->_resolve_var($var, $context);
        return (defined $resolved && $resolved eq $val) ? 1 : 0;
    }

    die "Invalid condition clause: '$clause'";
}

sub _resolve_var {
    my ($self, $var, $context) = @_;

    if ($var eq 'outcome') {
        return $context->{outcome};
    }
    elsif ($var eq 'preferred_label') {
        return $context->{preferred_label};
    }
    elsif ($var =~ /^context\.(.+)$/) {
        return $context->{$1};
    }

    return $context->{$var};
}

# Validate condition syntax without evaluating
sub validate {
    my ($self, $expression) = @_;
    return { valid => 1 } unless defined $expression && length $expression;

    my @clauses = split /\s*&&\s*/, $expression;
    for my $clause (@clauses) {
        $clause =~ s/^\s+|\s+$//g;
        unless ($clause =~ /^.+?\s*(!?=)\s*.+$/) {
            return { valid => 0, error => "Invalid clause: '$clause'" };
        }
    }
    return { valid => 1 };
}

1;
