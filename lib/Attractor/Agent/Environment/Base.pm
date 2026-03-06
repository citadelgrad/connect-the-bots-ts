package Attractor::Agent::Environment::Base;

use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    return bless {
        cwd => $args{cwd} // '.',
    }, $class;
}

sub cwd { $_[0]->{cwd} }

# Abstract methods
sub read_file      { die ref($_[0]) . "::read_file not implemented" }
sub write_file     { die ref($_[0]) . "::write_file not implemented" }
sub file_exists    { die ref($_[0]) . "::file_exists not implemented" }
sub list_directory { die ref($_[0]) . "::list_directory not implemented" }
sub exec_command   { die ref($_[0]) . "::exec_command not implemented" }
sub grep_files     { die ref($_[0]) . "::grep_files not implemented" }
sub glob_files     { die ref($_[0]) . "::glob_files not implemented" }

1;
