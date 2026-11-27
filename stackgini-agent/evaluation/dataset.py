"""Labelled development dataset loading.

The dataset split is done externally: this project only receives
`development.csv` (24 rows). Validation and blind-test rows are withheld and
scored offline by the organisers, so nothing here splits, samples a holdout or
looks for other files. Labels are used only for scoring after investigation;
only `id` and `url` ever reach the research pipeline.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

LABEL_MAP = {"green": "GREEN", "yellow": "YELLOW", "red": "RED"}


def load(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = {"id", "url", "overall"} - set(df.columns)
    if missing:
        raise ValueError(f"dataset missing columns: {missing}")
    df["label"] = df["overall"].astype(str).str.strip().str.lower().map(LABEL_MAP)
    return df


def select(df: pd.DataFrame, ids: list[str] | None = None, limit: int | None = None) -> pd.DataFrame:
    if ids:
        return df[df["id"].astype(str).isin([str(i) for i in ids])]
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
