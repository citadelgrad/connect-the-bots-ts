#!/usr/bin/env perl

use strict;
use warnings;
use Test::More;

use FindBin;
use lib "$FindBin::Bin/../../lib";

use Attractor::Pipeline::Parser;

my $parser = Attractor::Pipeline::Parser->new();

# Test basic digraph parsing
{
    my $dot = <<'DOT';
digraph test_pipeline {
    start [shape=Mdiamond]
    end [shape=Msquare]
    task1 [label="Do something" type="codergen"]

    start -> task1
    task1 -> end
}
DOT

    my $graph = $parser->parse($dot);
    is($graph->{name}, 'test_pipeline', 'graph name');
    ok(exists $graph->{nodes}{start}, 'start node exists');
    ok(exists $graph->{nodes}{end}, 'end node exists');
    ok(exists $graph->{nodes}{task1}, 'task1 node exists');
    is($graph->{nodes}{start}{attributes}{shape}, 'Mdiamond', 'start shape');
    is($graph->{nodes}{end}{attributes}{shape}, 'Msquare', 'end shape');
    is($graph->{nodes}{task1}{attributes}{label}, 'Do something', 'task1 label');
    is(scalar @{$graph->{edges}}, 2, 'two edges');
    is($graph->{edges}[0]{from}, 'start', 'first edge from');
    is($graph->{edges}[0]{to}, 'task1', 'first edge to');
}

# Test edge attributes
{
    my $dot = <<'DOT';
digraph attrs {
    start [shape=Mdiamond]
    end [shape=Msquare]
    start -> end [label="go" weight=10 condition="outcome=success"]
}
DOT

    my $graph = $parser->parse($dot);
    my $edge = $graph->{edges}[0];
    is($edge->{attributes}{label}, 'go', 'edge label');
    is($edge->{attributes}{weight}, 10, 'edge weight');
    is($edge->{attributes}{condition}, 'outcome=success', 'edge condition');
}

# Test graph attributes
{
    my $dot = <<'DOT';
digraph with_attrs {
    goal = "Build the app"
    fidelity = "compact"

    start [shape=Mdiamond]
    end [shape=Msquare]
    start -> end
}
DOT

    my $graph = $parser->parse($dot);
    is($graph->{attributes}{goal}, 'Build the app', 'graph attribute goal');
    is($graph->{attributes}{fidelity}, 'compact', 'graph attribute fidelity');
}

# Test boolean coercion
{
    my $dot = <<'DOT';
digraph bools {
    start [shape=Mdiamond goal_gate=true]
    end [shape=Msquare]
    start -> end
}
DOT

    my $graph = $parser->parse($dot);
    is($graph->{nodes}{start}{attributes}{goal_gate}, 1, 'true coerced to 1');
}

# Test edge chain (a -> b -> c)
{
    my $dot = <<'DOT';
digraph chain {
    start [shape=Mdiamond]
    mid [label="Middle"]
    end [shape=Msquare]
    start -> mid -> end
}
DOT

    my $graph = $parser->parse($dot);
    is(scalar @{$graph->{edges}}, 2, 'chain produces 2 edges');
    is($graph->{edges}[0]{from}, 'start', 'chain edge 1 from');
    is($graph->{edges}[0]{to}, 'mid', 'chain edge 1 to');
    is($graph->{edges}[1]{from}, 'mid', 'chain edge 2 from');
    is($graph->{edges}[1]{to}, 'end', 'chain edge 2 to');
}

# Test duration values
{
    my $dot = <<'DOT';
digraph durations {
    start [shape=Mdiamond timeout=30s]
    end [shape=Msquare]
    start -> end
}
DOT

    my $graph = $parser->parse($dot);
    is($graph->{nodes}{start}{attributes}{timeout}, 30, 'duration 30s');
}

# Test comment handling
{
    my $dot = <<'DOT';
digraph comments {
    // This is a comment
    start [shape=Mdiamond]
    /* Multi-line
       comment */
    end [shape=Msquare]
    start -> end
}
DOT

    my $graph = $parser->parse($dot);
    is(scalar keys %{$graph->{nodes}}, 2, 'comments stripped');
}

# Test invalid DOT
{
    eval { $parser->parse("not a digraph") };
    like($@, qr/Invalid DOT/, 'rejects invalid DOT');
}

done_testing();
