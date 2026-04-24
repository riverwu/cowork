#!/usr/bin/env python3
"""Quick data analysis template."""
import pandas as pd
import sys

if len(sys.argv) < 2:
    print("Usage: analyze.py <file>")
    sys.exit(1)

df = pd.read_csv(sys.argv[1])
print(f"Shape: {df.shape}")
print(f"\nColumns: {list(df.columns)}")
print(f"\nTypes:\n{df.dtypes}")
print(f"\nSummary:\n{df.describe()}")
print(f"\nMissing:\n{df.isnull().sum()}")
