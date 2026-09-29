"""Whose certificate is believed when the fleet asks another machine for something.

Python on Windows trusts two of the machine's certificate stores: the roots, and the intermediates
Windows has collected on the way. It prefers a certificate from either over the one a site sends,
and the collected ones go out of date: an intermediate that expired a year ago, still in the store,
is chosen over the good one the site sent, and the site is refused as expired though Windows itself
accepts it. So the roots are trusted and nothing else, and a site's intermediates are the ones it
sends. Nothing is checked less: the certificate, its chain to a root and the name on it.
"""

from __future__ import annotations

import ssl
import urllib.request
from functools import lru_cache

SERVER_AUTH = "1.3.6.1.5.5.7.3.1"


def windows_roots() -> list[bytes]:
    """The roots this machine trusts to name a server. None anywhere but on Windows."""
    stores = getattr(ssl, "enum_certificates", None)
    if stores is None:
        return []
    try:
        found = stores("ROOT")
    except OSError:
        return []
    return [der for der, encoding, use in found
            if encoding == "x509_asn" and (use is True or SERVER_AUTH in use)]


@lru_cache(maxsize=1)
def trust() -> ssl.SSLContext:
    roots = windows_roots()
    if not roots:
        return ssl.create_default_context()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)     # checks the certificate, and the name on it
    # As strict as the context Python makes by default.
    context.verify_flags |= getattr(ssl, "VERIFY_X509_PARTIAL_CHAIN", 0) | getattr(ssl, "VERIFY_X509_STRICT", 0)
    taken = 0
    for der in roots:
        try:
            context.load_verify_locations(cadata=der)
            taken += 1
        except ssl.SSLError:
            continue                                      # one root that cannot be read is not the others'
    return context if taken else ssl.create_default_context()


def opener(*handlers) -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=trust()), *handlers)
