package Attractor::Pipeline::Handler::Base;

use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    return bless {
        engine => $args{engine},
    }, $class;
}

sub type { die ref($_[0]) . "::type not implemented" }

# Execute the handler. Returns an outcome hash:
# {
#   outcome            => 'success' | 'retry' | 'fail' | 'partial_success',
#   preferred_label    => 'edge label',
#   suggested_next_ids => ['node_id'],
#   context_updates    => { key => value },
#   notes              => 'summary text',
# }
sub execute {
    die ref($_[0]) . "::execute not implemented";
}

sub _success {
    my ($self, %args) = @_;
    return {
        outcome         => 'success',
        context_updates => $args{context_updates} // {},
        notes           => $args{notes} // '',
        ($args{preferred_label}    ? (preferred_label    => $args{preferred_label})    : ()),
        ($args{suggested_next_ids} ? (suggested_next_ids => $args{suggested_next_ids}) : ()),
    };
}

sub _fail {
    my ($self, %args) = @_;
    return {
        outcome         => 'fail',
        context_updates => $args{context_updates} // {},
        notes           => $args{notes} // '',
    };
}

1;
