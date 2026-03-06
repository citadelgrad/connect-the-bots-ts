#!/usr/bin/env perl

use strict;
use warnings;
use Test::More;

use FindBin;
use lib "$FindBin::Bin/../../lib";

use Attractor::LLM::Types;

# Test constants
is(Attractor::LLM::Types::ROLE_SYSTEM,    'system',    'ROLE_SYSTEM');
is(Attractor::LLM::Types::ROLE_USER,      'user',      'ROLE_USER');
is(Attractor::LLM::Types::ROLE_ASSISTANT, 'assistant', 'ROLE_ASSISTANT');
is(Attractor::LLM::Types::ROLE_TOOL,      'tool',      'ROLE_TOOL');

is(Attractor::LLM::Types::PART_TEXT,      'text',      'PART_TEXT');
is(Attractor::LLM::Types::PART_TOOL_CALL, 'tool_call', 'PART_TOOL_CALL');

is(Attractor::LLM::Types::FINISH_STOP,     'stop',     'FINISH_STOP');
is(Attractor::LLM::Types::FINISH_TOOL_USE, 'tool_use', 'FINISH_TOOL_USE');

# Test new_message
my $msg = Attractor::LLM::Types::new_message(
    role    => 'user',
    content => 'Hello, world!',
);
is($msg->{role}, 'user', 'new_message role');
is(ref $msg->{content}, 'ARRAY', 'new_message wraps string in array');
is($msg->{content}[0]{type}, 'text', 'new_message content part type');
is($msg->{content}[0]{text}, 'Hello, world!', 'new_message content text');

# Test message_text
my $text = Attractor::LLM::Types::message_text($msg);
is($text, 'Hello, world!', 'message_text extracts text');

# Test new_tool_call
my $call = Attractor::LLM::Types::new_tool_call(
    name      => 'read_file',
    arguments => { path => '/tmp/test.txt' },
);
is($call->{name}, 'read_file', 'tool_call name');
is($call->{arguments}{path}, '/tmp/test.txt', 'tool_call arguments');
ok($call->{id}, 'tool_call has auto-generated id');

# Test new_tool_result
my $result = Attractor::LLM::Types::new_tool_result(
    tool_call_id => 'call_123',
    content      => 'file contents',
);
is($result->{tool_call_id}, 'call_123', 'tool_result id');
is($result->{content}, 'file contents', 'tool_result content');
is($result->{is_error}, 0, 'tool_result not error by default');

# Test new_tool_def
my $def = Attractor::LLM::Types::new_tool_def(
    name        => 'test_tool',
    description => 'A test tool',
);
is($def->{name}, 'test_tool', 'tool_def name');
is($def->{description}, 'A test tool', 'tool_def description');

# Test new_usage
my $usage = Attractor::LLM::Types::new_usage(
    input_tokens  => 100,
    output_tokens => 50,
);
is($usage->{input_tokens}, 100, 'usage input tokens');
is($usage->{output_tokens}, 50, 'usage output tokens');
is($usage->{reasoning_tokens}, 0, 'usage reasoning tokens default 0');

# Test message_tool_calls
my $msg_with_tools = Attractor::LLM::Types::new_message(
    role    => 'assistant',
    content => [
        Attractor::LLM::Types::new_content_part(
            type => 'text',
            text => 'Let me read that file.',
        ),
        Attractor::LLM::Types::new_content_part(
            type      => 'tool_call',
            tool_call => $call,
        ),
    ],
);
my $calls = Attractor::LLM::Types::message_tool_calls($msg_with_tools);
is(scalar @$calls, 1, 'extracted one tool call');
is($calls->[0]{name}, 'read_file', 'tool call name matches');

done_testing();
