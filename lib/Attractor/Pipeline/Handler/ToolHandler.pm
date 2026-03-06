package Attractor::Pipeline::Handler::ToolHandler;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Handler::Base';

# External command execution handler.

sub type { 'tool' }

sub execute {
    my ($self, $node, $context) = @_;
    my $attrs = $node->{attributes};

    my $command = $attrs->{command} // $attrs->{cmd};
    unless ($command) {
        return $self->_fail(notes => "No command specified for tool node '$node->{id}'");
    }

    # Expand variables
    $command =~ s/\$\{(\w+)\}/$context->get($1) \/\/ "\${$1}"/ge;
    $command =~ s/\$(\w+)/$context->get($1) \/\/ "\$$1"/ge;

    my $env = $self->{engine}{env};
    unless ($env) {
        return $self->_fail(notes => 'No execution environment available');
    }

    my $timeout = $attrs->{timeout} // 30;
    my $result = eval {
        $env->exec_command($command, timeout => $timeout);
    };

    if ($@) {
        return $self->_fail(
            notes           => "Tool execution failed: $@",
            context_updates => { error => "$@" },
        );
    }

    my $output = $result->{output} // '';
    my $exit_code = $result->{exit_code};

    if ($exit_code != 0 && !$attrs->{allow_failure}) {
        return $self->_fail(
            notes           => "Command exited with code $exit_code",
            context_updates => {
                tool_output    => $output,
                tool_exit_code => $exit_code,
            },
        );
    }

    return $self->_success(
        notes           => "Command completed (exit $exit_code)",
        context_updates => {
            tool_output    => $output,
            tool_exit_code => $exit_code,
        },
    );
}

1;
