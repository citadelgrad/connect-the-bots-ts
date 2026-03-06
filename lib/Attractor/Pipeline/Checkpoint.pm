package Attractor::Pipeline::Checkpoint;

use strict;
use warnings;

use JSON;
use File::Path qw(make_path);
use File::Spec;

my $json = JSON->new->utf8->pretty->canonical;

sub new {
    my ($class, %args) = @_;
    return bless {
        run_dir => $args{run_dir},
    }, $class;
}

sub save {
    my ($self, %state) = @_;
    my $path = File::Spec->catfile($self->{run_dir}, 'checkpoint.json');
    make_path($self->{run_dir}) unless -d $self->{run_dir};

    my $data = {
        current_node    => $state{current_node},
        completed_nodes => $state{completed_nodes} // [],
        retry_counts    => $state{retry_counts}    // {},
        context         => $state{context}         // {},
        timestamp       => time(),
    };

    open my $fh, '>', $path or die "Cannot write checkpoint: $!";
    print $fh $json->encode($data);
    close $fh;
}

sub load {
    my ($self) = @_;
    my $path = File::Spec->catfile($self->{run_dir}, 'checkpoint.json');
    return undef unless -f $path;

    open my $fh, '<', $path or die "Cannot read checkpoint: $!";
    local $/;
    my $content = <$fh>;
    close $fh;

    return $json->decode($content);
}

sub save_node_status {
    my ($self, $node_id, %status) = @_;
    my $node_dir = File::Spec->catfile($self->{run_dir}, $node_id);
    make_path($node_dir) unless -d $node_dir;

    my $path = File::Spec->catfile($node_dir, 'status.json');
    open my $fh, '>', $path or die "Cannot write status: $!";
    print $fh $json->encode(\%status);
    close $fh;
}

sub save_prompt {
    my ($self, $node_id, $prompt) = @_;
    my $node_dir = File::Spec->catfile($self->{run_dir}, $node_id);
    make_path($node_dir) unless -d $node_dir;

    my $path = File::Spec->catfile($node_dir, 'prompt.md');
    open my $fh, '>', $path or die "Cannot write prompt: $!";
    print $fh $prompt;
    close $fh;
}

sub save_response {
    my ($self, $node_id, $response) = @_;
    my $node_dir = File::Spec->catfile($self->{run_dir}, $node_id);
    make_path($node_dir) unless -d $node_dir;

    my $path = File::Spec->catfile($node_dir, 'response.md');
    open my $fh, '>', $path or die "Cannot write response: $!";
    print $fh $response;
    close $fh;
}

sub save_manifest {
    my ($self, %manifest) = @_;
    my $path = File::Spec->catfile($self->{run_dir}, 'manifest.json');
    make_path($self->{run_dir}) unless -d $self->{run_dir};

    open my $fh, '>', $path or die "Cannot write manifest: $!";
    print $fh $json->encode(\%manifest);
    close $fh;
}

1;
