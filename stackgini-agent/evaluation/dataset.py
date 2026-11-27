"""Dataset loading and leakage-safe dev/holdout split.

Rows are grouped by registrable domain (e.g. all microsoft.com pages share a
group) so near-duplicate products never straddle dev and holdout. Labels are
only used for scoring, never passed to research prompts.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd

from tools.safe_url import registrable_domain

LABEL_MAP = {"green": "GREEN", "yellow": "YELLOW", "red": "RED"}


def load(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = {"id", "url", "overall"} - set(df.columns)
    if missing:
        raise ValueError(f"dataset missing columns: {missing}")
    df["label"] = df["overall"].str.strip().str.lower().map(LABEL_MAP)
    df["group"] = df["url"].map(registrable_domain)
    df["split"] = df["group"].map(lambda g: "dev" if int(hashlib.sha256(g.encode()).hexdigest(), 16) % 10 < 6 else "holdout")
    return df


def select(df: pd.DataFrame, split: str | None = None, ids: list[str] | None = None,
           limit: int | None = None) -> pd.DataFrame:
    if ids:
        return df[df["id"].astype(str).isin([str(i) for i in ids])]
    if split in ("dev", "holdout"):
        df = df[df["split"] == split]
    if limit:
        # stratified: round-robin over labels so a small sample still has every class
        parts = [g.sort_values("id") for _, g in df.groupby("label")]
        rows, i = [], 0
        while len(rows) < limit and any(i < len(p) for p in parts):
            for p in parts:
                if i < len(p) and len(rows) < limit:
                    rows.append(p.iloc[i])
            i += 1
        df = pd.DataFrame(rows)
    return df
