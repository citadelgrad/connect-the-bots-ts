package Attractor::Agent::Tool::WriteFile;

use strict;
use warnings;
use parent 'Attractor::Agent::Tool::Base';

sub name { 'write_file' }

sub description {
    'Write content to a file at the given path. Creates the file if it does not exist.'
}

sub parameters {
    return {
        type       => 'object',
        properties => {
            path => {
                type        => 'string',
                description => 'The path to write the file to',
            },
            content => {
                type        => 'string',
                description => 'The content to write to the file',
            },
        },
        required => ['path', 'content'],
    };
}

sub execute {
    my ($self, $args) = @_;
    $self->{env}->write_file($args->{path}, $args->{content});
    return "File written: $args->{path}";
}

1;
