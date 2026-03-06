package Attractor::Agent::Profile::OpenAI;

use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    return bless {
        env => $args{env},
    }, $class;
}

sub name { 'openai' }

sub system_prompt {
    my ($self, %ctx) = @_;
    my $platform = $ctx{platform} // $^O;
    my $cwd      = $ctx{cwd}     // '.';
    my $date     = $ctx{date}    // scalar localtime;

    return <<"PROMPT";
You are a coding agent. You solve programming tasks using the available tools.

Environment:
- Platform: $platform
- Working directory: $cwd
- Date: $date

Guidelines:
- Read files before modifying them
- Use apply_patch for file edits in v4a patch format
- Use shell for running commands
- Be direct and concise
PROMPT
}

sub tools {
    my ($self) = @_;
    require Attractor::Agent::Tool::ReadFile;
    require Attractor::Agent::Tool::WriteFile;
    require Attractor::Agent::Tool::Shell;
    require Attractor::Agent::Tool::GrepTool;
    require Attractor::Agent::Tool::GlobTool;

    return [
        Attractor::Agent::Tool::ReadFile->new(env => $self->{env}),
        Attractor::Agent::Tool::WriteFile->new(env => $self->{env}),
        Attractor::Agent::Tool::Shell->new(env => $self->{env}),
        Attractor::Agent::Tool::GrepTool->new(env => $self->{env}),
        Attractor::Agent::Tool::GlobTool->new(env => $self->{env}),
    ];
}

sub project_file { 'AGENTS.md' }

1;
