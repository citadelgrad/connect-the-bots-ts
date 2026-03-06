package Attractor::Agent::Profile::Gemini;

use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    return bless {
        env => $args{env},
    }, $class;
}

sub name { 'gemini' }

sub system_prompt {
    my ($self, %ctx) = @_;
    my $platform = $ctx{platform} // $^O;
    my $cwd      = $ctx{cwd}     // '.';
    my $date     = $ctx{date}    // scalar localtime;

    return <<"PROMPT";
You are a coding agent. You help users write, modify, and debug code.

Environment:
- Platform: $platform
- Working directory: $cwd
- Date: $date

Instructions:
- Read files before editing
- Use edit_file for modifications
- Use shell to run commands and tests
- Be concise and focused
PROMPT
}

sub tools {
    my ($self) = @_;
    require Attractor::Agent::Tool::ReadFile;
    require Attractor::Agent::Tool::WriteFile;
    require Attractor::Agent::Tool::EditFile;
    require Attractor::Agent::Tool::Shell;
    require Attractor::Agent::Tool::GrepTool;
    require Attractor::Agent::Tool::GlobTool;

    return [
        Attractor::Agent::Tool::ReadFile->new(env => $self->{env}),
        Attractor::Agent::Tool::WriteFile->new(env => $self->{env}),
        Attractor::Agent::Tool::EditFile->new(env => $self->{env}),
        Attractor::Agent::Tool::Shell->new(env => $self->{env}),
        Attractor::Agent::Tool::GrepTool->new(env => $self->{env}),
        Attractor::Agent::Tool::GlobTool->new(env => $self->{env}),
    ];
}

sub project_file { 'GEMINI.md' }

1;
