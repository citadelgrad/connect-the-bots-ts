#!/usr/bin/env perl

use strict;
use warnings;
use Test::More;

use FindBin;
use lib "$FindBin::Bin/../../lib";

use File::Temp qw(tempdir);
use Attractor::Agent::Environment::Local;

my $tmpdir = tempdir(CLEANUP => 1);
my $env = Attractor::Agent::Environment::Local->new(cwd => $tmpdir);

# Test write and read file
{
    $env->write_file('test.txt', "Hello, Attractor!\n");
    ok($env->file_exists('test.txt'), 'file exists after write');

    my $content = $env->read_file('test.txt');
    is($content, "Hello, Attractor!\n", 'read back matches write');
}

# Test file_exists for missing file
{
    ok(!$env->file_exists('nonexistent.txt'), 'missing file returns false');
}

# Test list_directory
{
    $env->write_file('a.txt', 'a');
    $env->write_file('b.txt', 'b');
    my $entries = $env->list_directory('.');
    ok(scalar @$entries >= 2, 'directory listing has entries');
    ok((grep { $_ eq 'a.txt' } @$entries), 'a.txt in listing');
    ok((grep { $_ eq 'b.txt' } @$entries), 'b.txt in listing');
}

# Test exec_command
{
    my $result = $env->exec_command('echo hello');
    is($result->{exit_code}, 0, 'echo exits 0');
    like($result->{output}, qr/hello/, 'echo output');
    ok(!$result->{timed_out}, 'echo did not timeout');
}

# Test command failure
{
    my $result = $env->exec_command('false');
    isnt($result->{exit_code}, 0, 'false exits non-zero');
}

# Test command timeout
{
    my $env2 = Attractor::Agent::Environment::Local->new(
        cwd             => $tmpdir,
        command_timeout => 1,
    );
    my $result = $env2->exec_command('sleep 10', timeout => 1);
    ok($result->{timed_out}, 'long command timed out');
}

# Test nested directory creation
{
    $env->write_file('sub/dir/deep.txt', 'deep content');
    ok($env->file_exists('sub/dir/deep.txt'), 'nested file created');
    my $content = $env->read_file('sub/dir/deep.txt');
    is($content, 'deep content', 'nested file content');
}

# Test read nonexistent file
{
    eval { $env->read_file('does_not_exist.xyz') };
    like($@, qr/not found/, 'reading missing file throws');
}

done_testing();
