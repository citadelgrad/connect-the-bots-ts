package Attractor::Agent::Profile::Anthropic;

use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    return bless {
        env => $args{env},
    }, $class;
}

sub name { 'anthropic' }

sub system_prompt {
    my ($self, %ctx) = @_;
    my $platform = $ctx{platform} // $^O;
    my $cwd      = $ctx{cwd}     // '.';
    my $date     = $ctx{date}    // scalar localtime;

    return <<"PROMPT";
You are a coding agent that helps users with software engineering tasks.
Use the tools available to you to assist the user.

Environment:
- Platform: $platform
- Working directory: $cwd
- Date: $date

Tool usage:
- Use read_file to read files before editing them
- Use edit_file for exact string replacement edits
- Use write_file to create new files
- Use shell to run commands
- Use grep to search file contents
- Use glob to find files by pattern

Be concise. Focus on completing the task efficiently.
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

sub project_file { 'CLAUDE.md' }

1;
