#!/usr/bin/env python3
"""
scripts/pdf_parse.py
Extracts layout information from a PDF using pdfplumber.
Invoked as a subprocess by backend/ingestion/pdfParser.js.

Output (stdout): JSON { pageCount, blocks, tables }
Errors  (stderr): plain text
Exit code: 0 on success, 1 on failure

Usage:
    python3 scripts/pdf_parse.py <pdf_path>
"""

import json
import sys

try:
    import pdfplumber
except ImportError:
    print("pdfplumber is not installed. Run: pip install pdfplumber", file=sys.stderr)
    sys.exit(1)


def _is_bold(fontname: str) -> bool:
    """Heuristic: a font is bold when its name contains bold/black markers."""
    name = (fontname or "").lower()
    return (
        "bold" in name
        or "black" in name
        or name.endswith("-bd")
        or name.endswith("-b")
        or ",bold" in name
    )


def _extract_blocks(page) -> list:
    """
    Groups words on a page into logical text lines (blocks).
    Words are clustered by y0 proximity (within 2 pt) to form lines.
    Font size and bold flag are derived from the majority of characters in the line.
    Coordinates use pdfplumber's native system (origin at bottom-left).
    """
    blocks = []
    try:
        words = page.extract_words(
            extra_attrs=["fontname", "size"],
            keep_blank_chars=False,
            use_text_flow=True,
        )
    except Exception:
        return blocks

    if not words:
        return blocks

    # Cluster words into lines by y0 proximity
    lines = []
    current = [words[0]]
    for word in words[1:]:
        if abs(word.get("y0", 0) - current[-1].get("y0", 0)) <= 2:
            current.append(word)
        else:
            lines.append(current)
            current = [word]
    lines.append(current)

    for line in lines:
        text = " ".join(w["text"] for w in line).strip()
        if not text:
            continue

        sizes = [w["size"] for w in line if w.get("size")]
        font_size = max(set(sizes), key=sizes.count) if sizes else 0.0

        bold_count = sum(1 for w in line if _is_bold(w.get("fontname", "")))
        is_bold = bold_count > len(line) / 2

        blocks.append({
            "text":     text,
            "x0":       min(w.get("x0", 0) for w in line),
            "y0":       min(w.get("y0", 0) for w in line),
            "fontSize": round(font_size, 2),
            "isBold":   is_bold,
            "pageNum":  page.page_number,
        })

    return blocks


def _extract_tables(page) -> list:
    """
    Extracts tabular data from a page.
    Each table is a 2-D list of cell strings plus the page number.
    """
    tables = []
    try:
        for tbl in page.extract_tables():
            if not tbl:
                continue
            rows = [[cell if cell is not None else "" for cell in row] for row in tbl]
            tables.append({
                "pageNum": page.page_number,
                "rows":    rows,
            })
    except Exception:
        pass
    return tables


def main():
    if len(sys.argv) < 2:
        print("Usage: pdf_parse.py <pdf_path>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    all_blocks = []
    all_tables = []
    page_count = 0

    try:
        with pdfplumber.open(pdf_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                all_blocks.extend(_extract_blocks(page))
                all_tables.extend(_extract_tables(page))
    except FileNotFoundError:
        print(f"File not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"Failed to parse PDF: {exc}", file=sys.stderr)
        sys.exit(1)

    json.dump(
        {"pageCount": page_count, "blocks": all_blocks, "tables": all_tables},
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
