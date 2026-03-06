package Attractor::Pipeline::Interviewer::Console;

use strict;
use warnings;
use parent 'Attractor::Pipeline::Interviewer::Base';

sub ask {
    my ($self, $prompt, $choices) = @_;

    print "\n$prompt\n";
    for my $i (0 .. $#$choices) {
        printf "  [%d] %s\n", $i + 1, $choices->[$i];
    }
    print "Select (1-" . scalar(@$choices) . "): ";

    while (1) {
        my $input = <STDIN>;
        chomp $input if defined $input;
        if (defined $input && $input =~ /^\d+$/ && $input >= 1 && $input <= @$choices) {
            return $choices->[$input - 1];
        }
        print "Invalid selection. Try again (1-" . scalar(@$choices) . "): ";
    }
}

1;
