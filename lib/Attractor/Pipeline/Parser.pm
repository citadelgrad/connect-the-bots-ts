package Attractor::Pipeline::Parser;

use strict;
use warnings;

# Parses a restricted subset of Graphviz DOT syntax for directed graphs.
# Supports: digraph, node declarations, edge declarations, attributes, subgraphs.

sub new {
    my ($class) = @_;
    return bless {}, $class;
}

sub parse {
    my ($self, $source) = @_;

    # Normalize line endings
    $source =~ s/\r\n/\n/g;

    # Remove C-style comments
    $source =~ s{/\*.*?\*/}{}gs;
    $source =~ s{//[^\n]*}{}g;

    # Extract digraph name and body
    $source =~ /^\s*digraph\s+(\w+|"[^"]*")\s*\{(.*)\}\s*$/s
        or die "Invalid DOT: expected 'digraph NAME { ... }'";

    my $name = $1;
    $name =~ s/^"(.*)"$/$1/;
    my $body = $2;

    my $graph = {
        name       => $name,
        nodes      => {},
        edges      => [],
        attributes => {},
    };

    $self->_parse_body($body, $graph);

    return $graph;
}

sub _parse_body {
    my ($self, $body, $graph) = @_;

    # Tokenize statements (semicolons or newlines as separators)
    my @statements = $self->_split_statements($body);

    for my $stmt (@statements) {
        $stmt =~ s/^\s+|\s+$//g;
        next unless length $stmt;

        # Graph attribute: key = value
        if ($stmt =~ /^(\w+)\s*=\s*(.+)$/ && $stmt !~ /->/) {
            my ($key, $val) = ($1, $2);
            $val =~ s/^"(.*)"$/$1/;
            $graph->{attributes}{$key} = $val;
        }
        # Edge: node1 -> node2 [attrs]
        elsif ($stmt =~ /->/) {
            $self->_parse_edge($stmt, $graph);
        }
        # Node: name [attrs]
        elsif ($stmt =~ /^(\w+|"[^"]*")\s*(\[.*\])?\s*$/) {
            $self->_parse_node($stmt, $graph);
        }
    }
}

sub _split_statements {
    my ($self, $body) = @_;
    my @stmts;
    my $current = '';
    my $depth = 0;
    my $in_quote = 0;

    for my $ch (split //, $body) {
        if ($ch eq '"' && !$in_quote) {
            $in_quote = 1;
            $current .= $ch;
        }
        elsif ($ch eq '"' && $in_quote) {
            $in_quote = 0;
            $current .= $ch;
        }
        elsif ($in_quote) {
            $current .= $ch;
        }
        elsif ($ch eq '{') {
            $depth++;
            $current .= $ch;
        }
        elsif ($ch eq '}') {
            $depth--;
            $current .= $ch;
        }
        elsif (($ch eq ';' || $ch eq "\n") && $depth == 0) {
            push @stmts, $current if $current =~ /\S/;
            $current = '';
        }
        else {
            $current .= $ch;
        }
    }
    push @stmts, $current if $current =~ /\S/;

    return @stmts;
}

sub _parse_node {
    my ($self, $stmt, $graph) = @_;

    $stmt =~ /^(\w+|"[^"]*")\s*(\[.*\])?\s*$/s or return;
    my ($id, $attr_str) = ($1, $2);
    $id =~ s/^"(.*)"$/$1/;

    # Skip DOT keywords
    return if $id =~ /^(graph|node|edge|subgraph|strict)$/i;

    my $attrs = $attr_str ? $self->_parse_attrs($attr_str) : {};

    $graph->{nodes}{$id} //= { id => $id, attributes => {} };
    %{$graph->{nodes}{$id}{attributes}} = (
        %{$graph->{nodes}{$id}{attributes}},
        %$attrs,
    );
}

sub _parse_edge {
    my ($self, $stmt, $graph) = @_;

    # Extract attribute block if present
    my $attrs = {};
    if ($stmt =~ s/\s*(\[.*\])\s*$//) {
        $attrs = $self->_parse_attrs($1);
    }

    # Split chain: a -> b -> c produces edges (a,b) and (b,c)
    my @nodes = split /\s*->\s*/, $stmt;
    for my $n (@nodes) {
        $n =~ s/^\s+|\s+$//g;
        $n =~ s/^"(.*)"$/$1/;
    }

    for my $i (0 .. $#nodes - 1) {
        my $from = $nodes[$i];
        my $to   = $nodes[$i + 1];

        # Auto-create nodes
        $graph->{nodes}{$from} //= { id => $from, attributes => {} };
        $graph->{nodes}{$to}   //= { id => $to,   attributes => {} };

        push @{$graph->{edges}}, {
            from       => $from,
            to         => $to,
            attributes => {%$attrs},
        };
    }
}

sub _parse_attrs {
    my ($self, $str) = @_;
    $str =~ s/^\[|\]$//g;

    my %attrs;
    # Match key=value pairs, handling quoted values
    while ($str =~ /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|[\w.]+)/g) {
        my ($key, $val) = ($1, $2);
        $val =~ s/^"(.*)"$/$1/s;
        # Unescape
        $val =~ s/\\(.)/$1/g;
        # Type coercion
        $attrs{$key} = $self->_coerce_value($val);
    }

    return \%attrs;
}

sub _coerce_value {
    my ($self, $val) = @_;
    return 1 if $val eq 'true';
    return 0 if $val eq 'false';
    return $val + 0 if $val =~ /^\d+$/;
    return $val + 0.0 if $val =~ /^\d+\.\d+$/;
    # Duration values (e.g. 900s, 15m)
    if ($val =~ /^(\d+)(s|m|h)$/) {
        my ($num, $unit) = ($1, $2);
        return $num              if $unit eq 's';
        return $num * 60         if $unit eq 'm';
        return $num * 3600       if $unit eq 'h';
    }
    return $val;
}

1;
