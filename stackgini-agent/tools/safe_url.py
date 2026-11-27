"""URL safety: only public http(s) targets, checked again after every redirect.

DNS is resolved before connecting and every resolved address must be public,
which blocks localhost, RFC1918, link-local, cloud metadata (169.254.169.254,
fd00:ec2::254), IPv4-mapped IPv6 and similar. A rebinding attack between our
check and the connect is narrowed by re-checking each redirect hop; for
untrusted deployments run behind an egress proxy as well.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit

BLOCKED_HOSTS = {"localhost", "metadata.google.internal", "metadata", "instance-data"}
ALLOWED_PORTS = {None, 80, 443, 8080, 8443}


class UnsafeURL(ValueError):
    pass


def _ip_is_public(ip: ipaddress._BaseAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
                or ip.is_reserved or ip.is_unspecified or
                (isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10")))


def normalize_url(url: str) -> str:
    url = (url or "").strip()
    if "://" not in url:
        url = "https://" + url
    parts = urlsplit(url)
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", parts.query, ""))


def check_url(url: str, resolve: bool = True) -> str:
    """Return the normalized URL or raise UnsafeURL."""
    url = normalize_url(url)
    p = urlsplit(url)
    if p.scheme not in ("http", "https"):
        raise UnsafeURL(f"scheme not allowed: {p.scheme}")
    if p.username or p.password:
        raise UnsafeURL("credentials in URL not allowed")
    host = (p.hostname or "").rstrip(".")
    if not host or host in BLOCKED_HOSTS or host.endswith(".localhost") or host.endswith(".internal") \
            or host.endswith(".local"):
        raise UnsafeURL(f"host not allowed: {host}")
    try:
        port = p.port
    except ValueError as exc:
        raise UnsafeURL("bad port") from exc
    if port not in ALLOWED_PORTS:
        raise UnsafeURL(f"port not allowed: {port}")
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        if not _ip_is_public(literal):
            raise UnsafeURL(f"non-public address: {host}")
        return url
    if "." not in host:
        raise UnsafeURL(f"single-label host not allowed: {host}")
    if resolve:
        try:
            infos = socket.getaddrinfo(host, port or 443, proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            # Behind an HTTPS proxy local DNS may be unavailable; the proxy resolves.
            return url
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if not _ip_is_public(ip):
                raise UnsafeURL(f"{host} resolves to non-public address {ip}")
    return url


def canonical_url(url: str) -> str:
    """Key used for deduplication: no scheme/www/fragment/tracking params, no trailing slash."""
    try:
        p = urlsplit(normalize_url(url))
    except ValueError:
        return url
    host = p.netloc.removeprefix("www.")
    q = "&".join(sorted(x for x in p.query.split("&") if x and not x.lower().startswith(("utm_", "ref=", "fbclid", "gclid"))))
    path = p.path.rstrip("/") or "/"
    return f"{host}{path}" + (f"?{q}" if q else "")


def registrable_domain(url: str) -> str:
    host = urlsplit(normalize_url(url)).hostname or ""
    parts = host.removeprefix("www.").split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "ac", "gov") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])
