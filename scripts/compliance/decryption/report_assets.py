from __future__ import annotations

from pathlib import Path


def assets_source_dir() -> Path:
    """
    Directory that stores static templates (css/js) for report generation.

    Layout:
        scripts/compliance/decryption/
            main.py
            assets/
                report.css
                report.js
            *.py
    """
    root_dir = Path(__file__).resolve().parent
    return root_dir / "assets"


def read_asset_text(name: str) -> str:
    path = assets_source_dir() / name
    return path.read_text(encoding="utf-8")


def write_assets(output_dir: Path) -> tuple[str, str]:
    assets_dir = output_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    css_src = read_asset_text("report.css")
    js_src = read_asset_text("report.js")

    css_rel = "assets/report.css"
    js_rel = "assets/report.js"

    (assets_dir / "report.css").write_text(css_src, encoding="utf-8")
    (assets_dir / "report.js").write_text(js_src, encoding="utf-8")

    return css_rel, js_rel

