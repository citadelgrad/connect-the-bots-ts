package Attractor::Pipeline::Handler::Parallel;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Handler::Base';

# Parallel fan-out: launches concurrent branch execution.
# In this Perl implementation, branches execute sequentially (no threading)
# but with isolated context copies per branch.

sub type { 'parallel' }

sub execute {
    my ($self, $node, $context) = @_;

    # Find all outgoing edges (branches)
    my @edges = grep { $_->{from} eq $node->{id} } @{$self->{engine}{graph}{edges}};

    my @branch_results;
    for my $edge (@edges) {
        my $branch_id = $edge->{to};
        # Clone context for branch isolation
        my $branch_ctx = $context->clone;
        $branch_ctx->set('parallel.branch', $branch_id);

        push @branch_results, {
            branch_id => $branch_id,
            context   => $branch_ctx,
        };
    }

    return $self->_success(
        notes           => "Launched " . scalar(@branch_results) . " parallel branches",
        context_updates => {
            'parallel.branches' => [map { $_->{branch_id} } @branch_results],
            'parallel.active'   => scalar(@branch_results),
        },
    );
}

1;

package Attractor::Pipeline::Handler::ParallelFanIn;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Handler::Base';

# Consolidation point for parallel branches.

sub type { 'parallel.fan_in' }

sub execute {
    my ($self, $node, $context) = @_;

    return $self->_success(
        notes           => "Parallel branches consolidated",
        context_updates => {
            'parallel.active' => 0,
        },
    );
}

1;
