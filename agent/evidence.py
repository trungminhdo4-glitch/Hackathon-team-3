"""Evidence types, bounded public HTTP, and a shared disk cache."""

import base64
import hashlib
import ipaddress
import json
import os
import socket
import threading
import time
from collections import Counter
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import requests

try:
    import fcntl
except ImportError:
    fcntl = None


USER_AGENT = "VendorVerdictBot/1.0"
MAX_BYTES = 1_500_000


@dataclass(frozen=True)
class Evidence:
    kind: str
    claim: str
    source_url: str


@dataclass
class Collection:
    evidence: list[Evidence] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    product: str = ""
    vendor: str = ""
    screenshot: Path | None = None


@dataclass(frozen=True)
class Response:
    url: str
    status: int
    content_type: str
    body: str

    def json(self):
        return json.loads(self.body)


@lru_cache(maxsize=512)
def public_host(host, port):
    try:
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(i[4][0]).is_global for i in addresses)
    except (OSError, ValueError):
        return False


def public_url(url):
    try:
        parts = urlsplit(url)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        return (
            parts.scheme in {"http", "https"} and parts.hostname and not parts.username
            and parts.password is None and port in {80, 443} and public_host(parts.hostname, port)
        )
    except ValueError:
        return False


class Http:
    def __init__(self, cache_dir, ttl=86400, process_pacing=False):
        self.cache = Path(cache_dir)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.ttl = ttl
        self.process_pacing = process_pacing
        self.lock = threading.Lock()
        self.host_locks = {}
        self.last = {}
        self.delays = {}
        self.robots = {}
        self.robot_locks = {}
        self.local = threading.local()
        self.usage = Counter()

    def count(self, **stats):
        with self.lock:
            self.usage.update(stats)

    def usage_summary(self):
        usage = dict(self.usage)
        return {
            "tavily_estimated_credits": usage.get("tavily_credits", 0),
            "tavily_cache_hits": usage.get("tavily_cache_hits", 0),
            "tavily_failed_requests": usage.get("tavily_failed_requests", 0),
            "llm_requests": usage.get("llm_requests", 0),
            "llm_cache_hits": usage.get("llm_cache_hits", 0),
            "llm_input_tokens": usage.get("llm_input_tokens", 0),
            "llm_output_tokens": usage.get("llm_output_tokens", 0),
        }

    def session(self):
        if not hasattr(self.local, "session"):
            self.local.session = requests.Session()
        return self.local.session

    def path(self, namespace, key, suffix=".json"):
        return self.cache / f"{namespace}-{hashlib.sha256(key.encode()).hexdigest()}{suffix}"

    def fresh(self, path):
        try:
            return time.time() - path.stat().st_mtime < self.ttl
        except OSError:
            return False

    def read(self, path):
        if self.fresh(path):
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                pass
        return None

    def write(self, path, payload):
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.cache, delete=False) as file:
            json.dump(payload, file, ensure_ascii=False)
        os.replace(file.name, path)

    def pace(self, host):
        with self.lock:
            guard = self.host_locks.setdefault(host, threading.Lock())
        with guard:
            delay = max(0.5, self.delays.get(host, 0))
            if self.process_pacing and fcntl is not None:
                with self.path("pace", host, ".lock").open("a+", encoding="ascii") as file:
                    fcntl.flock(file, fcntl.LOCK_EX)
                    try:
                        file.seek(0)
                        previous = float(file.read() or 0)
                    except ValueError:
                        previous = 0
                    time.sleep(max(0, delay - (time.monotonic() - previous)))
                    file.seek(0)
                    file.truncate()
                    file.write(str(time.monotonic()))
                    return
            time.sleep(max(0, delay - (time.monotonic() - self.last.get(host, 0))))
            self.last[host] = time.monotonic()

    def allowed(self, url):
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        with self.lock:
            guard = self.robot_locks.setdefault(origin, threading.Lock())
        with guard:
            if origin not in self.robots:
                response = self.get(origin + "/robots.txt")
                parser = RobotFileParser()
                if response and response.status == 200 and "html" not in response.content_type:
                    parser.parse(response.body.splitlines())
                elif response and response.status in {404, 410}:
                    parser.parse([])
                else:
                    parser.disallow_all = True
                delay = parser.crawl_delay(USER_AGENT)
                if delay is not None:
                    self.delays[parts.hostname] = delay
                    if delay > 10:
                        parser.disallow_all = True
                self.robots[origin] = parser
        return self.robots[origin].can_fetch(USER_AGENT, url)

    def get(self, url, *, crawl=False, binary=False):
        return self.request(url, crawl=crawl, binary=binary)

    def request(self, url, *, crawl=False, payload=None, headers=None, tavily=False, binary=False):
        cache_key = [url, payload, crawl] + (["binary"] if binary else [])
        path = self.path("http", json.dumps(cache_key, sort_keys=True))
        cached = self.read(path)
        if isinstance(cached, dict) and (not crawl or (
            public_url(url) and self.allowed(url) and self.allowed(cached["url"])
        )):
            if tavily:
                self.count(tavily_cache_hits=1)
            return Response(**cached)
        for _ in range(5):
            if not public_url(url) or (crawl and not self.allowed(url)):
                return None
            self.pace(urlsplit(url).hostname)
            try:
                with self.session().request(
                    "POST" if payload is not None else "GET", url, json=payload,
                    headers={"User-Agent": USER_AGENT, **(headers or {})},
                    timeout=(4, 7), allow_redirects=False, stream=True,
                ) as result:
                    if result.is_redirect:
                        if payload is not None or headers:
                            return None
                        url = urljoin(url, result.headers["Location"])
                        continue
                    content_type = result.headers.get("Content-Type", "").lower()
                    body = bytearray()
                    if binary or any(kind in content_type for kind in ("text", "json", "xml", "xhtml")):
                        for chunk in result.iter_content(16384):
                            body.extend(chunk)
                            if len(body) >= MAX_BYTES:
                                break
                    encoding = result.encoding or "utf-8"
                    content = (base64.b64encode(body).decode("ascii") if binary and len(body) < MAX_BYTES else ""
                               if binary else body[:MAX_BYTES].decode(encoding, errors="replace"))
                    response = Response(result.url, result.status_code, content_type, content)
                    if tavily:
                        self.count(**({"tavily_credits": 1} if result.ok else {"tavily_failed_requests": 1}))
                    if result.status_code == 200 or (not tavily and result.status_code in {404, 410}):
                        self.write(path, asdict(response))
                    return response
            except (requests.RequestException, LookupError):
                if tavily:
                    self.count(tavily_failed_requests=1)
                return None
        return None
