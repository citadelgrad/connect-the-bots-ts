package Attractor::Agent::Tool::GlobTool;

use strict;
use warnings;
use parent 'Attractor::Agent::Tool::Base';

sub name { 'glob' }

sub description {
    'Find files matching a glob pattern. Returns a list of matching file paths.'
}

sub parameters {
    return {
        type       => 'object',
        properties => {
            pattern => {
                type        => 'string',
                description => 'The glob pattern to match (e.g. "**/*.py", "src/**/*.js")',
            },
        },
        required => ['pattern'],
    };
}

sub execute {
    my ($self, $args) = @_;
    my $matches = $self->{env}->glob_files($args->{pattern});
    return join("\n", @$matches);
}

1;
