#!/usr/bin/env perl

use strict;
use warnings;
use Test::More;

use FindBin;
use lib "$FindBin::Bin/../../lib";

use Attractor::Pipeline::Parser;
use Attractor::Pipeline::Validator;

my $parser    = Attractor::Pipeline::Parser->new();
my $validator = Attractor::Pipeline::Validator->new();

# Test valid pipeline
{
    my $dot = <<'DOT';
digraph valid {
    start [shape=Mdiamond]
    task [label="Do work"]
    end [shape=Msquare]
    start -> task -> end
}
DOT

    my $graph = $parser->parse($dot);
    my $diags = $validator->validate($graph);
    ok(!$validator->has_errors($diags), 'valid pipeline has no errors');
}

# Test missing start node
{
    my $dot = <<'DOT';
digraph no_start {
    task [label="Do work"]
    end [shape=Msquare]
    task -> end
}
DOT

    my $graph = $parser->parse($dot);
    my $diags = $validator->validate($graph);
    ok($validator->has_errors($diags), 'missing start is error');
    my @errors = grep { $_->{rule} eq 'single_start' } @$diags;
    ok(@errors, 'single_start rule triggered');
}

# Test missing exit node
{
    my $dot = <<'DOT';
digraph no_exit {
    start [shape=Mdiamond]
    task [label="Do work"]
    start -> task
}
DOT

    my $graph = $parser->parse($dot);
    my $diags = $validator->validate($graph);
    ok($validator->has_errors($diags), 'missing exit is error');
}

# Test unreachable node
{
    my $dot = <<'DOT';
digraph unreachable {
    start [shape=Mdiamond]
    end [shape=Msquare]
    orphan [label="Lonely"]
    start -> end
}
DOT

    my $graph = $parser->parse($dot);
    my $diags = $validator->validate($graph);
    ok($validator->has_errors($diags), 'unreachable node is error');
    my @errors = grep { $_->{rule} eq 'reachability' } @$diags;
    ok(@errors, 'reachability rule triggered');
}

# Test start with incoming edges
{
    my $dot = <<'DOT';
digraph bad_start {
    start [shape=Mdiamond]
    end [shape=Msquare]
    start -> end
    end -> start
}
DOT

    my $graph = $parser->parse($dot);
    my $diags = $validator->validate($graph);
    my @errors = grep { $_->{rule} eq 'start_no_incoming' || $_->{rule} eq 'exit_no_outgoing' } @$diags;
    ok(@errors, 'start with incoming or exit with outgoing detected');
}

# Test invalid condition
{
    my $dot = <<'DOT';
digraph bad_cond {
    start [shape=Mdiamond]
    end [shape=Msquare]
    start -> end [condition="invalid condition syntax here"]
}
DOT

    my $graph = $parser->parse($dot);
    my $diags = $validator->validate($graph);
    ok($validator->has_errors($diags), 'invalid condition is error');
}

done_testing();
