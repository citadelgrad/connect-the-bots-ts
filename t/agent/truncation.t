#!/usr/bin/env perl

use strict;
use warnings;
use Test::More;

use FindBin;
use lib "$FindBin::Bin/../../lib";

use Attractor::Agent::Truncation;

my $trunc = Attractor::Agent::Truncation->new();

# Short output not truncated
{
    my $output = "Hello, world!";
    is($trunc->truncate($output, 'read_file'), $output, 'short output not truncated');
}

# Character truncation
{
    my $output = 'x' x 100_000;
    my $result = $trunc->truncate($output, 'read_file');
    ok(length($result) < length($output), 'long output was truncated');
    like($result, qr/truncated/, 'truncation marker present');
    # Verify head and tail are preserved
    like($result, qr/^x+/, 'head preserved');
    like($result, qr/x+$/, 'tail preserved');
}

# Line truncation
{
    my $output = join("\n", map { "line $_" } 1..500);
    my $result = $trunc->truncate($output, 'shell');
    ok($result =~ /truncated/, 'line truncation applied for shell');
}

# Undef input
{
    is($trunc->truncate(undef, 'read_file'), '', 'undef returns empty string');
}

# Custom limits
{
    my $trunc2 = Attractor::Agent::Truncation->new(
        char_limits => { default => 100 },
    );
    my $output = 'y' x 200;
    my $result = $trunc2->truncate($output, 'unknown_tool');
    ok(length($result) < 200, 'custom char limit applied');
}

done_testing();
