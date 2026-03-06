package Attractor::LLM::Request;

use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    return bless {
        model            => $args{model},
        messages         => $args{messages}         // [],
        tools            => $args{tools}            // [],
        temperature      => $args{temperature},
        max_tokens       => $args{max_tokens},
        response_format  => $args{response_format},
        reasoning_effort => $args{reasoning_effort},
        provider_options => $args{provider_options} // {},
        system           => $args{system},
    }, $class;
}

sub model            { $_[0]->{model} }
sub messages         { $_[0]->{messages} }
sub tools            { $_[0]->{tools} }
sub temperature      { $_[0]->{temperature} }
sub max_tokens       { $_[0]->{max_tokens} }
sub response_format  { $_[0]->{response_format} }
sub reasoning_effort { $_[0]->{reasoning_effort} }
sub provider_options { $_[0]->{provider_options} }
sub system           { $_[0]->{system} }

sub has_tools { scalar @{$_[0]->{tools}} > 0 }

1;
