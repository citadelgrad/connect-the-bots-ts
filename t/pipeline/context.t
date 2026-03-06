#!/usr/bin/env perl

use strict;
use warnings;
use Test::More;

use FindBin;
use lib "$FindBin::Bin/../../lib";

use Attractor::Pipeline::Context;

# Basic operations
{
    my $ctx = Attractor::Pipeline::Context->new(foo => 'bar', num => 42);
    is($ctx->get('foo'), 'bar', 'get existing key');
    is($ctx->get('num'), 42, 'get numeric value');
    is($ctx->get('missing'), undef, 'get missing key');
}

# Set
{
    my $ctx = Attractor::Pipeline::Context->new();
    $ctx->set('key', 'value');
    is($ctx->get('key'), 'value', 'set then get');
}

# Merge
{
    my $ctx = Attractor::Pipeline::Context->new(a => 1);
    $ctx->merge({ b => 2, c => 3 });
    is($ctx->get('a'), 1, 'original preserved');
    is($ctx->get('b'), 2, 'merged key b');
    is($ctx->get('c'), 3, 'merged key c');

    # Merge overwrites
    $ctx->merge({ a => 'new' });
    is($ctx->get('a'), 'new', 'merge overwrites');
}

# Clone isolation
{
    my $ctx = Attractor::Pipeline::Context->new(x => 'original');
    my $clone = $ctx->clone;
    $clone->set('x', 'modified');
    is($ctx->get('x'), 'original', 'original not affected by clone');
    is($clone->get('x'), 'modified', 'clone has modified value');
}

# Snapshot
{
    my $ctx = Attractor::Pipeline::Context->new(a => 1, b => 2);
    my $snap = $ctx->snapshot;
    is(ref $snap, 'HASH', 'snapshot is a hash');
    is($snap->{a}, 1, 'snapshot a');
    is($snap->{b}, 2, 'snapshot b');

    # Modifying snapshot doesn't affect context
    $snap->{a} = 999;
    is($ctx->get('a'), 1, 'snapshot isolation');
}

# to_hash
{
    my $ctx = Attractor::Pipeline::Context->new(x => 'y');
    my $hash = $ctx->to_hash;
    is($hash->{x}, 'y', 'to_hash returns data');
}

done_testing();
