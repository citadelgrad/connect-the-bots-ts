package Attractor::Agent::Tool::ReadFile;

use strict;
use warnings;
use parent 'Attractor::Agent::Tool::Base';

sub name { 'read_file' }

sub description {
    'Read the contents of a file at the given path. Returns the file content as text.'
}

sub parameters {
    return {
        type       => 'object',
        properties => {
            path => {
                type        => 'string',
                description => 'The path to the file to read',
            },
            offset => {
                type        => 'integer',
                description => 'Line number to start reading from (0-indexed)',
            },
            limit => {
                type        => 'integer',
                description => 'Maximum number of lines to read',
            },
        },
        required => ['path'],
    };
}

sub execute {
    my ($self, $args) = @_;
    my $content = $self->{env}->read_file($args->{path});

    if (defined $args->{offset} || defined $args->{limit}) {
        my @lines = split /\n/, $content, -1;
        my $offset = $args->{offset} // 0;
        my $limit  = $args->{limit}  // scalar @lines;
        @lines = splice(@lines, $offset, $limit);
        $content = join("\n", @lines);
    }

    return $content;
}

1;
