# @app/ssrf

An outbound `fetch` for URLs this system did not choose.

Any time a caller supplies a URL that a server then dereferences — today that is the OAuth Client ID
Metadata Document (`apps/api/src/oauth`), tomorrow it could be a webhook target or an avatar import
— the request runs from inside the deployment's network, with whatever that network can reach.
`createSafeFetch` is what keeps such a request on the public internet.

- **https only, and never a redirect.** A redirect escapes every check below.
- **Every resolved address must be public unicast.** Loopback, private, carrier-grade NAT,
  link-local (`169.254.169.254` is where cloud instance metadata lives), multicast, reserved and
  documentation ranges are all refused, as are the v4 addresses tunnelled inside v6 forms
  (v4-mapped, NAT64, 6to4). One private address in a multi-record answer fails the whole request:
  which address a connection would have picked is not ours to guess.
- **Those addresses are pinned onto the connection.** Validating a hostname and then handing the
  hostname to `fetch` leaves a DNS-rebinding window in which the second lookup answers differently.
  This is the only reason the package depends on `undici` rather than using the global `fetch`.

There is deliberately no way to turn the address check off. A security gate with an environment
variable behind it is a gate that eventually ships open. Code that needs to reach a private address
should call `fetch` directly and be obvious about it.

The caller still owns the response: nothing here bounds the body. Read it against a cap rather than
buffering whatever arrives.
