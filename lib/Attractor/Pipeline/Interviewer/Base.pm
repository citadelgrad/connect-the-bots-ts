package Attractor::Pipeline::Interviewer::Base;

use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    return bless {}, $class;
}

# Ask a question with choices, return the selected label
sub ask {
    die ref($_[0]) . "::ask not implemented";
}

1;
