package Attractor::LLM::Provider::Base;

use strict;
use warnings;

use HTTP::Tiny;
use JSON;

my $json = JSON->new->utf8->canonical;

sub new {
    my ($class, %args) = @_;
    return bless {
        api_key  => $args{api_key},
        base_url => $args{base_url},
        http     => HTTP::Tiny->new(
            timeout     => $args{timeout} // 120,
            agent       => 'Attractor-Perl/0.01',
        ),
        max_retries => $args{max_retries} // 3,
    }, $class;
}

sub api_key  { $_[0]->{api_key} }
sub base_url { $_[0]->{base_url} }
sub http     { $_[0]->{http} }

# Abstract methods - subclasses must implement
sub complete {
    die ref($_[0]) . "::complete not implemented";
}

sub name {
    die ref($_[0]) . "::name not implemented";
}

sub format_request {
    die ref($_[0]) . "::format_request not implemented";
}

sub parse_response {
    die ref($_[0]) . "::parse_response not implemented";
}

# Common HTTP request with retry logic
sub _request {
    my ($self, %args) = @_;
    my $method  = $args{method} // 'POST';
    my $url     = $args{url};
    my $headers = $args{headers} // {};
    my $body    = $args{body};

    my $last_error;
    for my $attempt (0 .. $self->{max_retries}) {
        if ($attempt > 0) {
            my $delay = (2 ** $attempt) + rand(1);
            select(undef, undef, undef, $delay);
        }

        my $response = $self->{http}->request($method, $url, {
            headers => $headers,
            ($body ? (content => ref $body ? $json->encode($body) : $body) : ()),
        });

        if ($response->{success}) {
            return $json->decode($response->{content});
        }

        my $status = $response->{status};
        # Non-retryable errors
        if ($status == 400 || $status == 401 || $status == 403 || $status == 404) {
            die "API error ($status): $response->{content}";
        }

        # Retryable errors (429, 500, 502, 503)
        $last_error = "HTTP $status: $response->{content}";
    }

    die "Max retries exceeded: $last_error";
}

1;
