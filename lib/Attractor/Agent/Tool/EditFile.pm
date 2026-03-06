package Attractor::Agent::Tool::EditFile;

use strict;
use warnings;
use parent 'Attractor::Agent::Tool::Base';

sub name { 'edit_file' }

sub description {
    'Edit a file by replacing an exact string match with new content. '
    . 'The old_string must match exactly one location in the file.'
}

sub parameters {
    return {
        type       => 'object',
        properties => {
            path => {
                type        => 'string',
                description => 'The path to the file to edit',
            },
            old_string => {
                type        => 'string',
                description => 'The exact string to find and replace',
            },
            new_string => {
                type        => 'string',
                description => 'The replacement string',
            },
        },
        required => ['path', 'old_string', 'new_string'],
    };
}

sub execute {
    my ($self, $args) = @_;
    my $content = $self->{env}->read_file($args->{path});

    my $old = $args->{old_string};
    my $new = $args->{new_string};

    # Count occurrences
    my $count = 0;
    my $pos = 0;
    while (($pos = index($content, $old, $pos)) >= 0) {
        $count++;
        $pos += length($old);
    }

    die "old_string not found in $args->{path}" if $count == 0;
    die "old_string found $count times in $args->{path} (must be unique)" if $count > 1;

    $content =~ s/\Q$old\E/$new/;
    $self->{env}->write_file($args->{path}, $content);
    return "File edited: $args->{path}";
}

1;
