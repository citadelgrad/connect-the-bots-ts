#!/usr/bin/env perl

use strict;
use warnings;
use Test::More;

use FindBin;
use lib "$FindBin::Bin/../../lib";

use Attractor::Pipeline::Stylesheet;

my $ss = Attractor::Pipeline::Stylesheet->new();

# Test parsing and resolution
{
    $ss->parse('* { llm_model: claude-sonnet-4-5; } .code { llm_model: claude-opus-4-6; }');

    # Universal match
    my $props = $ss->resolve({ id => 'generic', attributes => {} });
    is($props->{llm_model}, 'claude-sonnet-4-5', 'universal selector matches');

    # Class match overrides universal
    $props = $ss->resolve({ id => 'coding_task', attributes => { class => 'code' } });
    is($props->{llm_model}, 'claude-opus-4-6', 'class selector overrides universal');
}

# Test ID selector (highest specificity)
{
    my $ss2 = Attractor::Pipeline::Stylesheet->new();
    $ss2->parse('* { llm_model: default; } #critical [llm_model: special]');

    my $props = $ss2->resolve({ id => 'critical', attributes => {} });
    is($props->{llm_model}, 'special', 'ID selector highest specificity');

    $props = $ss2->resolve({ id => 'other', attributes => {} });
    is($props->{llm_model}, 'default', 'non-matching ID gets universal');
}

# Test multiple properties
{
    my $ss3 = Attractor::Pipeline::Stylesheet->new();
    $ss3->parse('* { llm_model: base; temperature: 0.7; max_tokens: 4096; }');

    my $props = $ss3->resolve({ id => 'any', attributes => {} });
    is($props->{llm_model}, 'base', 'multi-prop model');
    is($props->{temperature}, '0.7', 'multi-prop temperature');
    is($props->{max_tokens}, '4096', 'multi-prop max_tokens');
}

# Test empty stylesheet
{
    my $ss4 = Attractor::Pipeline::Stylesheet->new();
    $ss4->parse('');
    my $props = $ss4->resolve({ id => 'test', attributes => {} });
    is(scalar keys %$props, 0, 'empty stylesheet produces no props');
}

done_testing();
