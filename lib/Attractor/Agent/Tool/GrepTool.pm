package Attractor::Agent::Tool::GrepTool;

use strict;
use warnings;
use parent 'Attractor::Agent::Tool::Base';

sub name { 'grep' }

sub description {
    'Search for a pattern in files using ripgrep. Returns matching lines with file paths and line numbers.'
}

sub parameters {
    return {
        type       => 'object',
        properties => {
            pattern => {
                type        => 'string',
                description => 'The regex pattern to search for',
            },
            path => {
                type        => 'string',
                description => 'Directory or file to search in (default: current directory)',
            },
            glob => {
                type        => 'string',
                description => 'Glob pattern to filter files (e.g. "*.py")',
            },
            case_insensitive => {
                type        => 'boolean',
                description => 'Whether to search case-insensitively',
            },
        },
        required => ['pattern'],
    };
}

sub execute {
    my ($self, $args) = @_;
    return $self->{env}->grep_files(
        $args->{pattern},
        path             => $args->{path},
        glob             => $args->{glob},
        case_insensitive => $args->{case_insensitive},
    );
}

1;
