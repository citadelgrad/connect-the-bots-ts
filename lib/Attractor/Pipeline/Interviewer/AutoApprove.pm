package Attractor::Pipeline::Interviewer::AutoApprove;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Interviewer::Base';

# Always selects the first option. Useful for automation.

sub ask {
    my ($self, $prompt, $choices) = @_;
    return $choices->[0] if @$choices;
    die "No choices available for auto-approve";
}

1;
