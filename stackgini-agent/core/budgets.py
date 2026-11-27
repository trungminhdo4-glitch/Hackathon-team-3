"""Deadlines and shared budgets for batch runs."""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Deadline:
    seconds: Optional[float]
    started: float = field(default_factory=time.monotonic)

    def remaining(self) -> Optional[float]:
        return None if self.seconds is None else self.seconds - (time.monotonic() - self.started)

    def expired(self, margin: float = 0) -> bool:
        r = self.remaining()
        return r is not None and r <= margin


@dataclass
class CountingBudget:
    limit: int
    used: int = 0
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def take(self) -> bool:
        async with self._lock:
            if self.used >= self.limit:
                return False
            self.used += 1
            return True


class StopFlag:
    """Set once a subscription limit is hit; no new Claude sessions start afterwards."""

    def __init__(self) -> None:
        self.reason: Optional[str] = None

    def trip(self, reason: str) -> None:
        self.reason = self.reason or reason

    @property
    def tripped(self) -> bool:
        return self.reason is not None
