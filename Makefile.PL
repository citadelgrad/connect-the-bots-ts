use ExtUtils::MakeMaker;

WriteMakefile(
    NAME         => 'Attractor',
    VERSION_FROM => 'lib/Attractor.pm',
    ABSTRACT     => 'DOT-based pipeline orchestration with AI coding agents',
    AUTHOR       => 'Attractor Contributors',
    LICENSE      => 'mit',
    EXE_FILES    => ['bin/attractor'],
    PREREQ_PM    => {
        'JSON'             => '4.0',
        'HTTP::Tiny'       => '0.076',
        'File::Path'       => '2.0',
        'File::Basename'   => '0',
        'File::Find'       => '0',
        'File::Spec'       => '0',
        'File::Temp'       => '0',
        'Getopt::Long'     => '0',
        'POSIX'            => '0',
        'Scalar::Util'     => '0',
        'Storable'         => '0',
        'Time::HiRes'      => '0',
        'Cwd'              => '0',
        'Digest::SHA'      => '0',
    },
    TEST_REQUIRES => {
        'Test::More'  => '0.98',
        'Test::Deep'  => '0',
    },
    META_MERGE => {
        'meta-spec' => { version => 2 },
        resources   => {
            repository => {
                type => 'git',
                url  => 'https://github.com/strongdm/attractor.git',
            },
        },
    },
    test => { TESTS => 't/*.t t/*/*.t' },
);
