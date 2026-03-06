package Attractor::Pipeline::Engine;

use strict;
use warnings;

use File::Spec;
use File::Path qw(make_path);

use Attractor::Pipeline::Parser;
use Attractor::Pipeline::Validator;
use Attractor::Pipeline::Context;
use Attractor::Pipeline::Checkpoint;
use Attractor::Pipeline::Condition;
use Attractor::Pipeline::Stylesheet;
use Attractor::Pipeline::Handler::Start;
use Attractor::Pipeline::Handler::Exit;
use Attractor::Pipeline::Handler::Codergen;
use Attractor::Pipeline::Handler::Conditional;
use Attractor::Pipeline::Handler::WaitHuman;
use Attractor::Pipeline::Handler::ToolHandler;
use Attractor::Pipeline::Handler::Parallel;
use Attractor::Pipeline::Handler::StackManager;
use Attractor::Agent::Event;

sub new {
    my ($class, %args) = @_;

    my $self = bless {
        parser      => Attractor::Pipeline::Parser->new(),
        validator   => Attractor::Pipeline::Validator->new(),
        condition   => Attractor::Pipeline::Condition->new(),
        stylesheet  => Attractor::Pipeline::Stylesheet->new(),
        handlers    => {},
        graph       => undef,
        context     => undef,
        checkpoint  => undef,
        session     => $args{session},
        env         => $args{env},
        interviewer => $args{interviewer},
        emitter     => $args{emitter} // Attractor::Agent::EventEmitter->new(),
        logs_root   => $args{logs_root} // '/tmp/attractor_runs',
        completed   => [],
        retry_counts => {},
    }, $class;

    $self->_register_handlers();

    return $self;
}

sub _register_handlers {
    my ($self) = @_;
    my @handler_classes = (
        'Attractor::Pipeline::Handler::Start',
        'Attractor::Pipeline::Handler::Exit',
        'Attractor::Pipeline::Handler::Codergen',
        'Attractor::Pipeline::Handler::Conditional',
        'Attractor::Pipeline::Handler::WaitHuman',
        'Attractor::Pipeline::Handler::ToolHandler',
        'Attractor::Pipeline::Handler::Parallel',
        'Attractor::Pipeline::Handler::ParallelFanIn',
        'Attractor::Pipeline::Handler::StackManager',
    );

    for my $hclass (@handler_classes) {
        my $handler = $hclass->new(engine => $self);
        $self->{handlers}{$handler->type} = $handler;
    }
}

# Phase 1: Parse
sub parse {
    my ($self, $source) = @_;
    $self->{graph} = $self->{parser}->parse($source);
    return $self->{graph};
}

# Phase 2: Validate
sub validate {
    my ($self) = @_;
    die "No graph parsed" unless $self->{graph};
    my $diagnostics = $self->{validator}->validate($self->{graph});
    if ($self->{validator}->has_errors($diagnostics)) {
        my @errors = grep { $_->{severity} eq 'ERROR' } @$diagnostics;
        die "Validation errors:\n" . join("\n", map { "  - $_->{message}" } @errors);
    }
    return $diagnostics;
}

# Phase 3: Initialize
sub initialize {
    my ($self) = @_;
    die "No graph parsed" unless $self->{graph};

    # Create run directory
    my $run_id = time() . '_' . int(rand(100000));
    my $run_dir = File::Spec->catdir($self->{logs_root}, $run_id);
    make_path($run_dir);

    $self->{checkpoint} = Attractor::Pipeline::Checkpoint->new(run_dir => $run_dir);

    # Initialize context from graph attributes
    my %initial_ctx;
    for my $key (keys %{$self->{graph}{attributes}}) {
        $initial_ctx{$key} = $self->{graph}{attributes}{$key};
    }
    $self->{context} = Attractor::Pipeline::Context->new(%initial_ctx);

    # Parse model stylesheet if present
    if (my $ss = $self->{graph}{attributes}{model_stylesheet}) {
        $self->{stylesheet}->parse($ss);
    }

    # Apply stylesheet defaults to nodes
    for my $node_id (keys %{$self->{graph}{nodes}}) {
        my $node = $self->{graph}{nodes}{$node_id};
        my $style_props = $self->{stylesheet}->resolve($node);
        for my $key (keys %$style_props) {
            $node->{attributes}{$key} //= $style_props->{$key};
        }
    }

    # Save manifest
    $self->{checkpoint}->save_manifest(
        graph_name => $self->{graph}{name},
        node_count => scalar keys %{$self->{graph}{nodes}},
        edge_count => scalar @{$self->{graph}{edges}},
        run_id     => $run_id,
        started_at => scalar localtime,
    );

    $self->_emit('PipelineStarted', { run_id => $run_id });

    return $run_id;
}

# Phase 4: Execute
sub execute {
    my ($self) = @_;

    my $start = $self->_find_start_node();
    die "No start node found" unless $start;

    my $current = $start;
    $self->{completed} = [];
    $self->{retry_counts} = {};

    while ($current) {
        $self->{context}->set('current_node', $current);
        my $node = $self->{graph}{nodes}{$current};

        $self->_emit('StageStarted', { node => $current });

        # Determine handler type
        my $handler_type = $self->_resolve_handler_type($node);
        my $handler = $self->{handlers}{$handler_type};

        unless ($handler) {
            die "No handler for type '$handler_type' (node: $current)";
        }

        # Execute with retry logic
        my $outcome = $self->_execute_with_retry($handler, $node);

        # Update context with outcome
        $self->{context}->set('outcome', $outcome->{outcome});
        $self->{context}->merge($outcome->{context_updates});

        if ($outcome->{preferred_label}) {
            $self->{context}->set('preferred_label', $outcome->{preferred_label});
        }

        # Save checkpoint
        $self->{checkpoint}->save(
            current_node    => $current,
            completed_nodes => $self->{completed},
            retry_counts    => $self->{retry_counts},
            context         => $self->{context}->snapshot,
        );

        # Save node status
        $self->{checkpoint}->save_node_status($current,
            outcome         => $outcome->{outcome},
            notes           => $outcome->{notes},
            context_updates => $outcome->{context_updates},
        );

        push @{$self->{completed}}, $current;

        $self->_emit('StageCompleted', {
            node    => $current,
            outcome => $outcome->{outcome},
        });

        # Check if this is the exit node
        if ($handler_type eq 'exit') {
            last;
        }

        # Select next node via edge selection
        my $next = $self->_select_next_edge($current, $outcome);

        # Handle goal gates on failure
        if (!$next && $outcome->{outcome} eq 'fail') {
            $next = $self->_handle_failure_routing($node);
        }

        $current = $next;
    }

    # Phase 5: Finalize
    return $self->_finalize();
}

sub _execute_with_retry {
    my ($self, $handler, $node) = @_;
    my $max_retries = $node->{attributes}{max_retries} // 0;
    my $node_id = $node->{id};
    $self->{retry_counts}{$node_id} //= 0;

    my $outcome = $handler->execute($node, $self->{context});

    while ($outcome->{outcome} eq 'retry'
           && $self->{retry_counts}{$node_id} < $max_retries) {
        $self->{retry_counts}{$node_id}++;
        my $attempt = $self->{retry_counts}{$node_id};

        # Exponential backoff with jitter
        my $delay = (2 ** $attempt) + rand(1);
        select(undef, undef, undef, $delay);

        $self->_emit('RetryAttempt', {
            node    => $node_id,
            attempt => $attempt,
        });

        $outcome = $handler->execute($node, $self->{context});
    }

    # If still retry after exhausting retries, convert to fail
    if ($outcome->{outcome} eq 'retry') {
        $outcome->{outcome} = 'fail';
        $outcome->{notes} .= " (retries exhausted)";
    }

    return $outcome;
}

# Five-step edge selection algorithm
sub _select_next_edge {
    my ($self, $current, $outcome) = @_;
    my @edges = grep { $_->{from} eq $current } @{$self->{graph}{edges}};
    return undef unless @edges;

    # Step 1: Condition-matching edges
    my @cond_matches;
    for my $edge (@edges) {
        my $cond = $edge->{attributes}{condition};
        if (defined $cond && length $cond) {
            my $ctx_hash = $self->{context}->to_hash;
            if ($self->{condition}->evaluate($cond, $ctx_hash)) {
                push @cond_matches, $edge;
            }
        }
    }
    return $cond_matches[0]{to} if @cond_matches == 1;

    # Step 2: Preferred label match
    my $pref_label = $outcome->{preferred_label}
                  // $self->{context}->get('preferred_label');
    if ($pref_label) {
        for my $edge (@edges) {
            my $label = $edge->{attributes}{label};
            if (defined $label && $label eq $pref_label) {
                return $edge->{to};
            }
        }
    }

    # Step 3: Suggested next IDs
    if ($outcome->{suggested_next_ids} && @{$outcome->{suggested_next_ids}}) {
        for my $id (@{$outcome->{suggested_next_ids}}) {
            for my $edge (@edges) {
                return $edge->{to} if $edge->{to} eq $id;
            }
        }
    }

    # Step 4: Highest weight among unconditional edges
    my @unconditional = grep {
        !defined $_->{attributes}{condition} || !length $_->{attributes}{condition}
    } @edges;

    if (@unconditional) {
        my @sorted = sort {
            ($b->{attributes}{weight} // 0) <=> ($a->{attributes}{weight} // 0)
        } @unconditional;

        # Step 5: Lexical tiebreak by target node ID
        my $max_weight = $sorted[0]{attributes}{weight} // 0;
        my @tied = grep {
            ($_->{attributes}{weight} // 0) == $max_weight
        } @sorted;

        if (@tied > 1) {
            @tied = sort { $a->{to} cmp $b->{to} } @tied;
        }
        return $tied[0]{to};
    }

    # Fallback if only conditional edges exist and none matched
    return @cond_matches ? $cond_matches[0]{to} : undef;
}

sub _handle_failure_routing {
    my ($self, $node) = @_;

    # Check node-level retry_target
    if (my $target = $node->{attributes}{retry_target}) {
        return $target if exists $self->{graph}{nodes}{$target};
    }

    # Check graph-level fallback
    if (my $fallback = $self->{graph}{attributes}{retry_target}) {
        return $fallback if exists $self->{graph}{nodes}{$fallback};
    }

    return undef;
}

# Phase 5: Finalize
sub _finalize {
    my ($self) = @_;

    # Check goal gates
    my @failed_gates;
    for my $node_id (keys %{$self->{graph}{nodes}}) {
        my $node = $self->{graph}{nodes}{$node_id};
        next unless $node->{attributes}{goal_gate};

        unless (grep { $_ eq $node_id } @{$self->{completed}}) {
            push @failed_gates, $node_id;
            next;
        }
    }

    my $final_outcome = @failed_gates ? 'fail' : 'success';

    $self->{checkpoint}->save(
        current_node    => 'FINALIZED',
        completed_nodes => $self->{completed},
        retry_counts    => $self->{retry_counts},
        context         => $self->{context}->snapshot,
    );

    $self->_emit('PipelineCompleted', {
        outcome      => $final_outcome,
        failed_gates => \@failed_gates,
    });

    return {
        outcome      => $final_outcome,
        completed    => $self->{completed},
        failed_gates => \@failed_gates,
        context      => $self->{context}->to_hash,
    };
}

sub _find_start_node {
    my ($self) = @_;
    for my $id (keys %{$self->{graph}{nodes}}) {
        my $node = $self->{graph}{nodes}{$id};
        return $id if ($node->{attributes}{shape} // '') eq 'Mdiamond';
    }
    return undef;
}

sub _resolve_handler_type {
    my ($self, $node) = @_;
    my $attrs = $node->{attributes};

    # Explicit type attribute
    return $attrs->{type} if $attrs->{type} && $self->{handlers}{$attrs->{type}};

    # Infer from shape
    my $shape = $attrs->{shape} // '';
    return 'start' if $shape eq 'Mdiamond';
    return 'exit'  if $shape eq 'Msquare';

    # Infer from label or other attributes
    return 'wait.human'         if $shape eq 'diamond' || $attrs->{human};
    return 'conditional'        if $shape eq 'diamond' && !$attrs->{human};
    return 'tool'               if $attrs->{command} || $attrs->{cmd};
    return 'parallel'           if $attrs->{parallel};
    return 'parallel.fan_in'    if $attrs->{fan_in};
    return 'stack.manager_loop' if $attrs->{child_pipeline};

    # Default to codergen (LLM task)
    return 'codergen';
}

sub _emit {
    my ($self, $type, $data) = @_;
    $self->{emitter}->emit(Attractor::Agent::Event->new(
        type => $type,
        data => $data,
    ));
}

# Run all 5 phases in sequence
sub run {
    my ($self, $source) = @_;

    $self->parse($source);
    $self->validate();
    $self->initialize();
    return $self->execute();
}

# Resume from checkpoint
sub resume {
    my ($self, $run_dir) = @_;

    my $cp = Attractor::Pipeline::Checkpoint->new(run_dir => $run_dir);
    my $state = $cp->load();
    die "No checkpoint found in $run_dir" unless $state;

    $self->{checkpoint}  = $cp;
    $self->{completed}   = $state->{completed_nodes} // [];
    $self->{retry_counts} = $state->{retry_counts}    // {};
    $self->{context}     = Attractor::Pipeline::Context->new(%{$state->{context} // {}});

    # Resume from the node after the last completed one
    # (re-execute the current node since it may not have completed)
    return $self->execute();
}

1;
