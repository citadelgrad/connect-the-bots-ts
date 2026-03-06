#!/usr/bin/env perl

use strict;
use warnings;
use Test::More;

use FindBin;
use lib "$FindBin::Bin/../../lib";

use Attractor::Pipeline::Condition;

my $cond = Attractor::Pipeline::Condition->new();

# Empty condition always matches
ok($cond->evaluate('', {}), 'empty string matches');
ok($cond->evaluate(undef, {}), 'undef matches');

# Simple equality
ok($cond->evaluate('outcome=success', { outcome => 'success' }), 'outcome=success matches');
ok(!$cond->evaluate('outcome=success', { outcome => 'fail' }), 'outcome=success does not match fail');

# Not equals
ok($cond->evaluate('outcome!=fail', { outcome => 'success' }), 'outcome!=fail matches success');
ok(!$cond->evaluate('outcome!=fail', { outcome => 'fail' }), 'outcome!=fail does not match fail');

# AND conjunction
ok($cond->evaluate(
    'outcome=success && context.tests_passed=true',
    { outcome => 'success', tests_passed => 'true' },
), 'AND both true');

ok(!$cond->evaluate(
    'outcome=success && context.tests_passed=true',
    { outcome => 'success', tests_passed => 'false' },
), 'AND one false');

# Context variable resolution
ok($cond->evaluate(
    'context.env=production',
    { env => 'production' },
), 'context.* variable');

# Preferred label
ok($cond->evaluate(
    'preferred_label=approve',
    { preferred_label => 'approve' },
), 'preferred_label variable');

# Validation
{
    my $r = $cond->validate('outcome=success');
    ok($r->{valid}, 'valid condition');
}
{
    my $r = $cond->validate('outcome=success && context.x=y');
    ok($r->{valid}, 'valid AND condition');
}
{
    my $r = $cond->validate('garbage no operator');
    ok(!$r->{valid}, 'invalid condition detected');
}

done_testing();
