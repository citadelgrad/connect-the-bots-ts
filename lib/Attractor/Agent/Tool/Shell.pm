package Attractor::Agent::Tool::Shell;

use strict;
use warnings;
use parent 'Attractor::Agent::Tool::Base';

sub name { 'shell' }

sub description {
    'Execute a shell command and return its output. '
    . 'Commands run in the project working directory.'
}

sub parameters {
    return {
        type       => 'object',
        properties => {
            command => {
                type        => 'string',
                description => 'The shell command to execute',
            },
            timeout => {
                type        => 'integer',
                description => 'Timeout in seconds (default 10, max 600)',
            },
        },
        required => ['command'],
    };
}

sub execute {
    my ($self, $args) = @_;
    my $result = $self->{env}->exec_command(
        $args->{command},
        timeout => $args->{timeout},
    );

    my $output = $result->{output} // '';
    if ($result->{exit_code} != 0 && !$result->{timed_out}) {
        $output .= "\n[exit code: $result->{exit_code}]";
    }
    return $output;
}

1;
