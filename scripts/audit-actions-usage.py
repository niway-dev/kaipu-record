"""Summarize a GitHub detailed billing CSV without rounding source amounts."""

import argparse
import csv
import hashlib
import io
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path


def summarize(path: Path) -> dict:
    raw = path.read_bytes()
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    dimensions = ("repository", "workflow_path", "sku", "unit_type", "applied_cost_per_quantity")
    measures = ("quantity", "gross_amount", "discount_amount", "net_amount")
    required = {"date", "product", *dimensions, *measures}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("Expected a detailed billing export with workflow_path, not a chart CSV")
    rows = [row for row in reader if row["product"] == "actions"]
    if not rows:
        raise ValueError("No Actions usage rows found")
    groups = defaultdict(lambda: [Decimal(0) for _ in measures])
    daily = defaultdict(lambda: Decimal(0))
    for row in rows:
        amounts = [Decimal(row[field]) for field in measures]
        if not all(value.is_finite() for value in amounts):
            raise ValueError("Non-finite quantity or amount")
        if amounts[1] - amounts[2] != amounts[3]:
            raise ValueError(f"Gross/discount/net mismatch on {row['date']}")
        key = tuple(row[field] for field in dimensions)
        for index, amount in enumerate(amounts):
            groups[key][index] += amount
        daily[(row["date"], row["repository"])] += amounts[1]
    return {
        "sha256": hashlib.sha256(raw).hexdigest(),
        "actions_rows": len(rows),
        "first_date": min(row["date"] for row in rows),
        "last_date": max(row["date"] for row in rows),
        "totals": {
            field: str(sum((Decimal(row[field]) for row in rows), Decimal(0)))
            for field in measures[1:]
        },
        "workflow_sku_totals": [
            dict(zip(dimensions + measures, key + tuple(str(value) for value in values)))
            for key, values in sorted(groups.items())
        ],
        "daily_repository_gross": [
            {"date": date, "repository": repository, "gross_amount": str(amount)}
            for (date, repository), amount in sorted(daily.items())
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(summarize(arguments.report), indent=2))
