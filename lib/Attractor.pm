package Attractor;

use strict;
use warnings;

our $VERSION = '0.01';

use Attractor::LLM::Client;
use Attractor::Agent::Session;
use Attractor::Pipeline::Engine;

1;

__END__

=head1 NAME

Attractor - DOT-based pipeline orchestration with AI coding agents

=head1 DESCRIPTION

Attractor is a declarative pipeline orchestration system that uses Graphviz DOT
syntax to define multi-stage AI workflows. Pipeline authors describe directed
graphs where nodes represent tasks and edges represent transitions.

The system consists of three layers:

=over 4

=item * Unified LLM Client - Multi-provider SDK (OpenAI, Anthropic, Gemini)

=item * Coding Agent Loop - Agentic loop with tool execution

=item * Attractor Pipeline - DOT graph parser and execution engine

=back

=cut
