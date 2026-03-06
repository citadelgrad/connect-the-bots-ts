package Attractor::Pipeline::Validator;

use strict;
use warnings;

use Attractor::Pipeline::Condition;

# Severity levels
use constant {
    SEV_ERROR   => 'ERROR',
    SEV_WARNING => 'WARNING',
    SEV_INFO    => 'INFO',
};

sub new {
    my ($class) = @_;
    return bless {
        condition_evaluator => Attractor::Pipeline::Condition->new(),
    }, $class;
}

sub validate {
    my ($self, $graph) = @_;
    my @diagnostics;

    push @diagnostics, $self->_check_start_node($graph);
    push @diagnostics, $self->_check_exit_node($graph);
    push @diagnostics, $self->_check_start_no_incoming($graph);
    push @diagnostics, $self->_check_exit_no_outgoing($graph);
    push @diagnostics, $self->_check_reachability($graph);
    push @diagnostics, $self->_check_edge_targets($graph);
    push @diagnostics, $self->_check_conditions($graph);

    return \@diagnostics;
}

sub has_errors {
    my ($self, $diagnostics) = @_;
    return scalar grep { $_->{severity} eq SEV_ERROR } @$diagnostics;
}

sub _check_start_node {
    my ($self, $graph) = @_;
    my @starts = grep {
        ($graph->{nodes}{$_}{attributes}{shape} // '') eq 'Mdiamond'
    } keys %{$graph->{nodes}};

    return () if @starts == 1;
    return {
        severity => SEV_ERROR,
        message  => @starts == 0
            ? 'No start node found (need shape=Mdiamond)'
            : 'Multiple start nodes found: ' . join(', ', @starts),
        rule => 'single_start',
    };
}

sub _check_exit_node {
    my ($self, $graph) = @_;
    my @exits = grep {
        ($graph->{nodes}{$_}{attributes}{shape} // '') eq 'Msquare'
    } keys %{$graph->{nodes}};

    return () if @exits == 1;
    return {
        severity => SEV_ERROR,
        message  => @exits == 0
            ? 'No exit node found (need shape=Msquare)'
            : 'Multiple exit nodes found: ' . join(', ', @exits),
        rule => 'single_exit',
    };
}

sub _check_start_no_incoming {
    my ($self, $graph) = @_;
    my ($start) = grep {
        ($graph->{nodes}{$_}{attributes}{shape} // '') eq 'Mdiamond'
    } keys %{$graph->{nodes}};
    return () unless $start;

    my @incoming = grep { $_->{to} eq $start } @{$graph->{edges}};
    return () unless @incoming;
    return {
        severity => SEV_ERROR,
        message  => "Start node '$start' has incoming edges",
        rule     => 'start_no_incoming',
    };
}

sub _check_exit_no_outgoing {
    my ($self, $graph) = @_;
    my ($exit) = grep {
        ($graph->{nodes}{$_}{attributes}{shape} // '') eq 'Msquare'
    } keys %{$graph->{nodes}};
    return () unless $exit;

    my @outgoing = grep { $_->{from} eq $exit } @{$graph->{edges}};
    return () unless @outgoing;
    return {
        severity => SEV_ERROR,
        message  => "Exit node '$exit' has outgoing edges",
        rule     => 'exit_no_outgoing',
    };
}

sub _check_reachability {
    my ($self, $graph) = @_;
    my ($start) = grep {
        ($graph->{nodes}{$_}{attributes}{shape} // '') eq 'Mdiamond'
    } keys %{$graph->{nodes}};
    return () unless $start;

    # BFS from start
    my %visited;
    my @queue = ($start);
    while (@queue) {
        my $node = shift @queue;
        next if $visited{$node};
        $visited{$node} = 1;
        for my $edge (@{$graph->{edges}}) {
            push @queue, $edge->{to} if $edge->{from} eq $node;
        }
    }

    my @unreachable = grep { !$visited{$_} } keys %{$graph->{nodes}};
    return () unless @unreachable;
    return {
        severity => SEV_ERROR,
        message  => 'Unreachable nodes: ' . join(', ', sort @unreachable),
        rule     => 'reachability',
    };
}

sub _check_edge_targets {
    my ($self, $graph) = @_;
    my @diags;
    for my $edge (@{$graph->{edges}}) {
        for my $end ('from', 'to') {
            unless (exists $graph->{nodes}{$edge->{$end}}) {
                push @diags, {
                    severity => SEV_ERROR,
                    message  => "Edge references non-existent node: $edge->{$end}",
                    rule     => 'edge_target_exists',
                };
            }
        }
    }
    return @diags;
}

sub _check_conditions {
    my ($self, $graph) = @_;
    my @diags;
    for my $edge (@{$graph->{edges}}) {
        my $cond = $edge->{attributes}{condition};
        next unless defined $cond && length $cond;
        my $result = $self->{condition_evaluator}->validate($cond);
        unless ($result->{valid}) {
            push @diags, {
                severity => SEV_ERROR,
                message  => "Invalid condition on edge $edge->{from} -> $edge->{to}: $result->{error}",
                rule     => 'valid_condition',
            };
        }
    }
    return @diags;
}

1;
