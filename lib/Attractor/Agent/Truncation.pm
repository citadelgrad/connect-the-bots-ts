package Attractor::Agent::Truncation;

use strict;
use warnings;

# Default character limits by tool
my %DEFAULT_CHAR_LIMITS = (
    read_file => 50_000,
    shell     => 30_000,
    grep      => 20_000,
    glob      => 20_000,
    default   => 30_000,
);

# Default line limits by tool
my %DEFAULT_LINE_LIMITS = (
    shell => 256,
    grep  => 200,
    glob  => 500,
);

sub new {
    my ($class, %args) = @_;
    return bless {
        char_limits => { %DEFAULT_CHAR_LIMITS, %{$args{char_limits} // {}} },
        line_limits => { %DEFAULT_LINE_LIMITS, %{$args{line_limits} // {}} },
    }, $class;
}

sub truncate {
    my ($self, $output, $tool_name) = @_;
    return '' unless defined $output;

    # Character truncation first (handles pathological cases like 10MB single lines)
    my $char_limit = $self->{char_limits}{$tool_name}
                  // $self->{char_limits}{default};
    $output = $self->_char_truncate($output, $char_limit) if $char_limit;

    # Line truncation second
    my $line_limit = $self->{line_limits}{$tool_name};
    $output = $self->_line_truncate($output, $line_limit) if $line_limit;

    return $output;
}

sub _char_truncate {
    my ($self, $output, $limit) = @_;
    return $output if length($output) <= $limit;

    my $half = int($limit / 2);
    my $head = substr($output, 0, $half);
    my $tail = substr($output, -$half);
    my $removed = length($output) - $limit;

    return $head
        . "\n\n... [truncated $removed characters] ...\n\n"
        . $tail;
}

sub _line_truncate {
    my ($self, $output, $limit) = @_;
    my @lines = split /\n/, $output, -1;
    return $output if scalar @lines <= $limit;

    my $half = int($limit / 2);
    my @head = @lines[0 .. $half - 1];
    my @tail = @lines[-$half .. -1];
    my $removed = scalar(@lines) - $limit;

    return join("\n", @head)
        . "\n\n... [truncated $removed lines] ...\n\n"
        . join("\n", @tail);
}

1;
