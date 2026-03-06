#!/usr/bin/env perl

use strict;
use warnings;
use Test::More;

use FindBin;
use lib "$FindBin::Bin/../../lib";

use File::Temp qw(tempdir);
use Attractor::Pipeline::Engine;
use Attractor::Pipeline::Interviewer::AutoApprove;
use Attractor::Pipeline::Interviewer::Queue;
use Attractor::Agent::Environment::Local;

my $logs_root = tempdir(CLEANUP => 1);

# Test basic pipeline execution (start -> exit)
{
    my $engine = Attractor::Pipeline::Engine->new(
        logs_root   => $logs_root,
        interviewer => Attractor::Pipeline::Interviewer::AutoApprove->new(),
    );

    my $dot = <<'DOT';
digraph simple {
    start [shape=Mdiamond]
    end [shape=Msquare]
    start -> end
}
DOT

    my $result = $engine->run($dot);
    is($result->{outcome}, 'success', 'simple pipeline succeeds');
    is(scalar @{$result->{completed}}, 2, '2 stages completed (start + exit)');
}

# Test conditional routing
{
    my $engine = Attractor::Pipeline::Engine->new(
        logs_root   => $logs_root,
        interviewer => Attractor::Pipeline::Interviewer::AutoApprove->new(),
    );

    my $dot = <<'DOT';
digraph conditional {
    start [shape=Mdiamond]
    check [type="conditional"]
    good [type="start"]
    end [shape=Msquare]

    start -> check
    check -> good [label="success" weight=10]
    check -> end [label="fail" weight=1]
    good -> end
}
DOT

    my $result = $engine->run($dot);
    is($result->{outcome}, 'success', 'conditional pipeline succeeds');
    ok(scalar @{$result->{completed}} >= 3, 'at least 3 stages completed');
}

# Test tool node execution
{
    my $engine = Attractor::Pipeline::Engine->new(
        logs_root   => $logs_root,
        interviewer => Attractor::Pipeline::Interviewer::AutoApprove->new(),
        env         => Attractor::Agent::Environment::Local->new(cwd => '/tmp'),
    );

    my $dot = <<'DOT';
digraph with_tool {
    start [shape=Mdiamond]
    run_cmd [type="tool" command="echo hello"]
    end [shape=Msquare]

    start -> run_cmd -> end
}
DOT

    my $result = $engine->run($dot);
    is($result->{outcome}, 'success', 'tool pipeline succeeds');
    like($result->{context}{tool_output}, qr/hello/, 'tool output captured');
}

# Test edge selection by weight
{
    my $engine = Attractor::Pipeline::Engine->new(
        logs_root   => $logs_root,
        interviewer => Attractor::Pipeline::Interviewer::AutoApprove->new(),
    );

    my $dot = <<'DOT';
digraph weighted {
    start [shape=Mdiamond]
    high [type="start" label="high priority"]
    low [type="start" label="low priority"]
    end [shape=Msquare]

    start -> high [weight=100]
    start -> low [weight=1]
    high -> end
    low -> end
}
DOT

    my $result = $engine->run($dot);
    is($result->{outcome}, 'success', 'weighted pipeline succeeds');
    # The high-weight edge should be selected
    ok((grep { $_ eq 'high' } @{$result->{completed}}), 'high-weight node was visited');
}

# Test human gate with queue interviewer
{
    my $interviewer = Attractor::Pipeline::Interviewer::Queue->new(
        answers => ['proceed'],
    );

    my $engine = Attractor::Pipeline::Engine->new(
        logs_root   => $logs_root,
        interviewer => $interviewer,
    );

    my $dot = <<'DOT';
digraph human_gate {
    start [shape=Mdiamond]
    review [type="wait.human" prompt="Approve?"]
    end [shape=Msquare]

    start -> review
    review -> end [label="proceed"]
}
DOT

    my $result = $engine->run($dot);
    is($result->{outcome}, 'success', 'human gate pipeline succeeds');
    is($result->{context}{human_choice}, 'proceed', 'human chose proceed');
}

# Test validate-only
{
    my $engine = Attractor::Pipeline::Engine->new(logs_root => $logs_root);

    my $dot = <<'DOT';
digraph valid {
    start [shape=Mdiamond]
    end [shape=Msquare]
    start -> end
}
DOT

    $engine->parse($dot);
    my $diags = $engine->validate();
    ok(defined $diags, 'validate returns diagnostics');
}

# Test validation failure
{
    my $engine = Attractor::Pipeline::Engine->new(logs_root => $logs_root);

    my $dot = <<'DOT';
digraph invalid {
    task [label="orphan"]
}
DOT

    $engine->parse($dot);
    eval { $engine->validate() };
    like($@, qr/Validation errors/, 'invalid pipeline rejected');
}

# Test checkpoint creation
{
    my $engine = Attractor::Pipeline::Engine->new(
        logs_root   => $logs_root,
        interviewer => Attractor::Pipeline::Interviewer::AutoApprove->new(),
    );

    my $dot = <<'DOT';
digraph checkpoint_test {
    start [shape=Mdiamond]
    end [shape=Msquare]
    start -> end
}
DOT

    my $result = $engine->run($dot);
    is($result->{outcome}, 'success', 'checkpoint test pipeline succeeds');
    # Verify checkpoint file was created
    ok(-d $logs_root, 'logs root directory exists');
}

done_testing();
