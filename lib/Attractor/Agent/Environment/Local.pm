package Attractor::Agent::Environment::Local;

use strict;
use warnings;
use parent 'Attractor::Agent::Environment::Base';

use File::Spec;
use File::Path qw(make_path);
use File::Basename qw(dirname);
use File::Find;
use Cwd qw(abs_path getcwd);
use POSIX qw(:sys_wait_h);

# Sensitive env var patterns to filter
my @SENSITIVE_PATTERNS = qw(
    API_KEY SECRET TOKEN PASSWORD CREDENTIAL
    AWS_SECRET PRIVATE_KEY AUTH
);

sub new {
    my ($class, %args) = @_;
    my $self = $class->SUPER::new(%args);
    $self->{command_timeout} = $args{command_timeout} // 10;
    $self->{max_timeout}     = $args{max_timeout}     // 600;
    return $self;
}

sub read_file {
    my ($self, $path) = @_;
    $path = $self->_resolve_path($path);
    die "File not found: $path" unless -f $path;
    open my $fh, '<', $path or die "Cannot read $path: $!";
    local $/;
    my $content = <$fh>;
    close $fh;
    return $content;
}

sub write_file {
    my ($self, $path, $content) = @_;
    $path = $self->_resolve_path($path);
    my $dir = dirname($path);
    make_path($dir) unless -d $dir;
    open my $fh, '>', $path or die "Cannot write $path: $!";
    print $fh $content;
    close $fh;
    return 1;
}

sub file_exists {
    my ($self, $path) = @_;
    $path = $self->_resolve_path($path);
    return -e $path ? 1 : 0;
}

sub list_directory {
    my ($self, $path) = @_;
    $path = $self->_resolve_path($path // '.');
    die "Not a directory: $path" unless -d $path;
    opendir my $dh, $path or die "Cannot read directory $path: $!";
    my @entries = sort grep { $_ ne '.' && $_ ne '..' } readdir $dh;
    closedir $dh;
    return \@entries;
}

sub exec_command {
    my ($self, $command, %opts) = @_;
    my $timeout = $opts{timeout} // $self->{command_timeout};
    $timeout = $self->{max_timeout} if $timeout > $self->{max_timeout};

    my $env = $self->_filtered_env();

    my $pid = open(my $pipe, '-|');
    die "Cannot fork: $!" unless defined $pid;

    if ($pid == 0) {
        # Child process
        chdir $self->{cwd};
        # Set process group for clean killing
        setpgrp(0, 0);
        # Apply filtered env
        for my $key (keys %$env) {
            $ENV{$key} = $env->{$key};
        }
        exec('/bin/sh', '-c', $command) or die "Cannot exec: $!";
    }

    # Parent: read with timeout
    my $output = '';
    my $timed_out = 0;

    eval {
        local $SIG{ALRM} = sub { die "TIMEOUT\n" };
        alarm($timeout);
        local $/;
        $output = <$pipe>;
        alarm(0);
    };

    if ($@ && $@ =~ /TIMEOUT/) {
        $timed_out = 1;
        # SIGTERM the process group
        kill '-TERM', $pid;
        # Wait 2 seconds, then SIGKILL
        my $waited = 0;
        for (1..20) {
            last if waitpid($pid, WNOHANG) > 0;
            select(undef, undef, undef, 0.1);
            $waited++;
        }
        if ($waited >= 20) {
            kill '-KILL', $pid;
            waitpid($pid, 0);
        }
    }

    close $pipe;
    my $exit_code = $? >> 8;

    if ($timed_out) {
        return {
            output    => $output . "\n[Command timed out after ${timeout}s]",
            exit_code => -1,
            timed_out => 1,
        };
    }

    return {
        output    => $output // '',
        exit_code => $exit_code,
        timed_out => 0,
    };
}

sub grep_files {
    my ($self, $pattern, %opts) = @_;
    my $path  = $self->_resolve_path($opts{path} // '.');
    my $glob  = $opts{glob};
    my $flags = $opts{case_insensitive} ? '-i' : '';

    my $cmd = "rg $flags --no-heading";
    $cmd .= " --glob '$glob'" if $glob;
    $cmd .= " -- " . quotemeta($pattern) . " " . quotemeta($path);
    $cmd .= " 2>/dev/null";

    my $result = $self->exec_command($cmd, timeout => 30);
    return $result->{output};
}

sub glob_files {
    my ($self, $pattern) = @_;
    my $base = $self->_resolve_path('.');
    my @matches;

    # Convert glob pattern to regex
    my $regex = $self->_glob_to_regex($pattern);

    find({
        wanted => sub {
            my $rel = File::Spec->abs2rel($_, $base);
            push @matches, $rel if $rel =~ $regex;
        },
        no_chdir => 1,
    }, $base);

    return [sort @matches];
}

sub _resolve_path {
    my ($self, $path) = @_;
    return $path if File::Spec->file_name_is_absolute($path);
    return File::Spec->catfile($self->{cwd}, $path);
}

sub _filtered_env {
    my ($self) = @_;
    my %env = %ENV;
    for my $key (keys %env) {
        for my $pat (@SENSITIVE_PATTERNS) {
            if ($key =~ /$pat/i) {
                delete $env{$key};
                last;
            }
        }
    }
    return \%env;
}

sub _glob_to_regex {
    my ($self, $pattern) = @_;
    my $regex = '';
    for my $ch (split //, $pattern) {
        if    ($ch eq '*')  { $regex .= '.*' }
        elsif ($ch eq '?')  { $regex .= '.' }
        elsif ($ch eq '.')  { $regex .= '\\.' }
        else                { $regex .= quotemeta($ch) }
    }
    return qr/^$regex$/;
}

1;
