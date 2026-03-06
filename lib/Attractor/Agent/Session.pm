package Attractor::Agent::Session;

use strict;
use warnings;

use Attractor::LLM::Types;
use Attractor::LLM::Request;
use Attractor::LLM::Client;
use Attractor::Agent::Event;
use Attractor::Agent::Truncation;
use Attractor::Agent::Environment::Local;
use Digest::SHA qw(sha256_hex);

sub new {
    my ($class, %args) = @_;

    my $env = $args{env} // Attractor::Agent::Environment::Local->new(
        cwd => $args{cwd} // '.',
    );

    my $profile_class = $args{profile_class}
        // 'Attractor::Agent::Profile::Anthropic';
    eval "require $profile_class" or die $@;
    my $profile = $profile_class->new(env => $env);

    my $self = bless {
        client          => $args{client} // Attractor::LLM::Client->new(),
        env             => $env,
        profile         => $profile,
        history         => [],
        tools           => {},
        tool_objects     => {},
        emitter         => Attractor::Agent::EventEmitter->new(),
        truncation      => Attractor::Agent::Truncation->new(),
        steering_queue  => [],
        followup_queue  => [],
        config          => {
            max_turns        => $args{max_turns}        // 100,
            max_tool_rounds  => $args{max_tool_rounds}  // 20,
            model            => $args{model}            // 'claude-sonnet-4-5',
            reasoning_effort => $args{reasoning_effort},
            command_timeout  => $args{command_timeout}   // 10,
        },
        state => 'idle',  # idle, running, closed
        turn_count     => 0,
        abort_signal   => 0,
        loop_detector  => [],
        loop_window    => $args{loop_window} // 10,
    }, $class;

    # Register tools from profile
    for my $tool (@{$profile->tools}) {
        $self->register_tool($tool);
    }

    return $self;
}

sub register_tool {
    my ($self, $tool) = @_;
    $self->{tools}{$tool->name} = $tool->definition;
    $self->{tool_objects}{$tool->name} = $tool;
}

sub on_event {
    my ($self, $callback) = @_;
    $self->{emitter}->on($callback);
}

sub steer {
    my ($self, $message) = @_;
    push @{$self->{steering_queue}}, $message;
}

sub follow_up {
    my ($self, $message) = @_;
    push @{$self->{followup_queue}}, $message;
}

sub abort {
    my ($self) = @_;
    $self->{abort_signal} = 1;
}

sub process_input {
    my ($self, $user_input) = @_;

    die "Session is closed" if $self->{state} eq 'closed';
    $self->{state} = 'running';

    $self->_emit(Attractor::Agent::Event::USER_INPUT, { text => $user_input });

    # Add user message to history
    push @{$self->{history}}, Attractor::LLM::Types::new_message(
        role    => Attractor::LLM::Types::ROLE_USER,
        content => $user_input,
    );

    my $result = $self->_run_loop();

    # Process follow-up queue
    while (@{$self->{followup_queue}} && !$self->{abort_signal}) {
        my $followup = shift @{$self->{followup_queue}};
        push @{$self->{history}}, Attractor::LLM::Types::new_message(
            role    => Attractor::LLM::Types::ROLE_USER,
            content => $followup,
        );
        $result = $self->_run_loop();
    }

    $self->{state} = 'idle';
    return $result;
}

sub _run_loop {
    my ($self) = @_;
    my $rounds = 0;

    while ($rounds < $self->{config}{max_tool_rounds}) {
        # Check limits
        if ($self->{turn_count} >= $self->{config}{max_turns}) {
            $self->_emit(Attractor::Agent::Event::TURN_LIMIT, {});
            last;
        }
        if ($self->{abort_signal}) {
            last;
        }

        $rounds++;
        $self->{turn_count}++;

        # Build request
        my $system = $self->_build_system_prompt();
        my $request = Attractor::LLM::Request->new(
            model            => $self->{config}{model},
            messages         => [@{$self->{history}}],
            tools            => [values %{$self->{tools}}],
            system           => $system,
            reasoning_effort => $self->{config}{reasoning_effort},
        );

        # Call LLM
        my $response = eval { $self->{client}->complete($request) };
        if ($@) {
            $self->_emit(Attractor::Agent::Event::ERROR, { error => "$@" });
            die $@;
        }

        # Record assistant response
        push @{$self->{history}}, $response->message;
        my $text = $response->text;
        if ($text) {
            $self->_emit(Attractor::Agent::Event::ASSISTANT_TEXT, { text => $text });
        }

        # Natural completion - no tool calls
        if (!$response->has_tool_calls) {
            return { text => $text, rounds => $rounds };
        }

        # Execute tool calls
        my @tool_results;
        for my $call (@{$response->tool_calls}) {
            $self->_emit(Attractor::Agent::Event::TOOL_CALL_START, {
                name => $call->{name}, arguments => $call->{arguments},
            });

            my $result = $self->_execute_tool($call);

            $self->_emit(Attractor::Agent::Event::TOOL_CALL_END, {
                name   => $call->{name},
                output => $result->{full_output},
            });

            push @tool_results, Attractor::LLM::Types::new_content_part(
                type        => Attractor::LLM::Types::PART_TOOL_RESULT,
                tool_result => Attractor::LLM::Types::new_tool_result(
                    tool_call_id => $call->{id},
                    content      => $result->{truncated_output},
                    is_error     => $result->{is_error},
                ),
            );
        }

        # Add tool results to history
        push @{$self->{history}}, Attractor::LLM::Types::new_message(
            role    => Attractor::LLM::Types::ROLE_TOOL,
            content => \@tool_results,
        );

        # Drain steering queue
        $self->_drain_steering();

        # Loop detection
        $self->_detect_loops($response->tool_calls);
    }

    return { text => '', rounds => $rounds };
}

sub _execute_tool {
    my ($self, $call) = @_;
    my $tool = $self->{tool_objects}{$call->{name}};

    unless ($tool) {
        return {
            full_output      => "Unknown tool: $call->{name}",
            truncated_output => "Unknown tool: $call->{name}",
            is_error         => 1,
        };
    }

    my $output = eval { $tool->execute($call->{arguments}) };
    if ($@) {
        my $err = "$@";
        return {
            full_output      => "Error: $err",
            truncated_output => "Error: $err",
            is_error         => 1,
        };
    }

    $output //= '';
    my $truncated = $self->{truncation}->truncate($output, $call->{name});

    return {
        full_output      => $output,
        truncated_output => $truncated,
        is_error         => 0,
    };
}

sub _drain_steering {
    my ($self) = @_;
    while (@{$self->{steering_queue}}) {
        my $msg = shift @{$self->{steering_queue}};
        push @{$self->{history}}, Attractor::LLM::Types::new_message(
            role    => Attractor::LLM::Types::ROLE_USER,
            content => "[Steering] $msg",
        );
        $self->_emit(Attractor::Agent::Event::STEERING_INJECTED, { message => $msg });
    }
}

sub _detect_loops {
    my ($self, $tool_calls) = @_;

    # Build signature from tool calls
    my $sig = join('|', map {
        $_->{name} . ':' . sha256_hex(JSON::encode_json($_->{arguments}))
    } @$tool_calls);

    push @{$self->{loop_detector}}, $sig;

    # Keep only last N entries
    my $window = $self->{loop_window};
    if (@{$self->{loop_detector}} > $window) {
        shift @{$self->{loop_detector}};
    }

    # Check for repeating pattern
    return unless @{$self->{loop_detector}} >= $window;

    my @sigs = @{$self->{loop_detector}};
    # Check if last half matches first half
    my $half = int($window / 2);
    my $first  = join("\n", @sigs[0 .. $half - 1]);
    my $second = join("\n", @sigs[$half .. $#sigs]);

    if ($first eq $second) {
        $self->_emit(Attractor::Agent::Event::LOOP_DETECTION, {});
        $self->steer(
            "You appear to be repeating the same tool calls. "
            . "Please try a different approach or explain what you're stuck on."
        );
    }
}

sub _build_system_prompt {
    my ($self) = @_;

    my $base = $self->{profile}->system_prompt(
        cwd      => $self->{env}->cwd,
        platform => $^O,
        date     => scalar localtime,
    );

    # Try to load project-specific instructions
    my $project_file = $self->{profile}->project_file;
    if ($self->{env}->file_exists($project_file)) {
        my $content = eval { $self->{env}->read_file($project_file) };
        if ($content && length($content) <= 32768) {
            $base .= "\n\n# Project Instructions\n$content";
        }
    }

    return $base;
}

sub _emit {
    my ($self, $type, $data) = @_;
    $self->{emitter}->emit(Attractor::Agent::Event->new(
        type => $type,
        data => $data,
    ));
}

sub history { $_[0]->{history} }
sub state   { $_[0]->{state} }

1;
