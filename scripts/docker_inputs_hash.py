#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path


def _sha256_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


@dataclass(frozen=True)
class DockerIgnoreRule:
    pattern: str
    negated: bool
    anchored: bool
    directory_only: bool


def _read_dockerignore_rules(context: Path) -> list[DockerIgnoreRule]:
    p = context / ".dockerignore"
    if not p.exists() or not p.is_file():
        return []

    rules: list[DockerIgnoreRule] = []
    for raw in _read_text(p).splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        negated = line.startswith("!")
        if negated:
            line = line[1:].lstrip()
        anchored = line.startswith("/")
        if anchored:
            line = line[1:]
        directory_only = line.endswith("/")
        if directory_only:
            line = line[:-1]
        if not line:
            continue
        rules.append(
            DockerIgnoreRule(
                pattern=line,
                negated=negated,
                anchored=anchored,
                directory_only=directory_only,
            )
        )
    return rules


def _dockerignore_matches(rule: DockerIgnoreRule, rel_posix: str, is_dir: bool) -> bool:
    if rule.directory_only and not is_dir:
        return False

    rel = rel_posix.lstrip("./")
    if rule.anchored:
        # Anchored to context root.
        candidates = [rel]
    else:
        # Unanchored patterns match anywhere: try both full rel and basename.
        base = rel.rsplit("/", 1)[-1]
        candidates = [rel, base]

    # Dockerignore supports ** globs; fnmatch handles this well enough for our use.
    for c in candidates:
        if fnmatch.fnmatch(c, rule.pattern):
            return True
        # Also allow matching directory prefixes for patterns like "dist" against "foo/dist/bar".
        if not rule.anchored and "/" in rel:
            if fnmatch.fnmatch(rel, f"*/{rule.pattern}") or fnmatch.fnmatch(rel, f"**/{rule.pattern}"):
                return True
    return False


def _is_ignored_by_dockerignore(rules: list[DockerIgnoreRule], rel_posix: str, is_dir: bool) -> bool:
    ignored = False
    for r in rules:
        if _dockerignore_matches(r, rel_posix=rel_posix, is_dir=is_dir):
            ignored = not r.negated
    return ignored


def _dockerfile_logical_lines(dockerfile_text: str) -> list[str]:
    """
    Join backslash-continued lines and drop full-line comments.
    """
    out: list[str] = []
    buf: list[str] = []
    for raw in dockerfile_text.splitlines():
        line = raw.rstrip()
        if not buf:
            stripped = line.lstrip()
            if stripped.startswith("#") or stripped == "":
                continue
        buf.append(line)
        if line.endswith("\\"):
            buf[-1] = buf[-1][:-1].rstrip()
            continue
        joined = " ".join(x.strip() for x in buf if x.strip())
        buf = []
        if joined:
            out.append(joined)
    if buf:
        joined = " ".join(x.strip() for x in buf if x.strip())
        if joined:
            out.append(joined)
    return out


@dataclass(frozen=True)
class CopyAdd:
    sources: tuple[str, ...]
    from_stage: bool


def _parse_copy_add_args_shellform(args: list[str]) -> CopyAdd | None:
    # flags: --from=, --chown=, --chmod=, --link, --parents, --exclude=... etc.
    from_stage = False
    rest: list[str] = []
    for a in args:
        if a.startswith("--from=") or a == "--from":
            from_stage = True
            continue
        if a.startswith("--"):
            continue
        rest.append(a)
    if len(rest) < 2:
        return None
    # last is dest
    srcs = tuple(rest[:-1])
    return CopyAdd(sources=srcs, from_stage=from_stage)


def _parse_copy_add_args_jsonform(json_text: str) -> CopyAdd | None:
    try:
        arr = json.loads(json_text)
    except Exception:
        return None
    if not isinstance(arr, list) or len(arr) < 2:
        return None
    # last is dest
    srcs = tuple(x for x in arr[:-1] if isinstance(x, str))
    if not srcs:
        return None
    return CopyAdd(sources=srcs, from_stage=False)


def _parse_copy_add(line: str) -> CopyAdd | None:
    upper = line.lstrip().upper()
    if not (upper.startswith("COPY ") or upper.startswith("ADD ")):
        return None

    # Keep original casing for paths.
    keyword, rest = line.split(None, 1)
    rest = rest.strip()

    # JSON form starts with '['
    if rest.startswith("["):
        parsed = _parse_copy_add_args_jsonform(rest)
        if parsed:
            return parsed
        return None

    # shell form
    try:
        parts = shlex.split(rest, posix=True)
    except Exception:
        return None
    return _parse_copy_add_args_shellform(parts)


def _looks_like_remote(src: str) -> bool:
    s = src.lower()
    return s.startswith("http://") or s.startswith("https://")


def _is_glob(p: str) -> bool:
    return any(ch in p for ch in ["*", "?", "["])


def _iter_files_under(path: Path) -> list[Path]:
    if not path.exists():
        return []
    if path.is_file():
        return [path]
    files: list[Path] = []
    for root, _, filenames in os.walk(path):
        for name in filenames:
            files.append(Path(root) / name)
    return files


def _collect_sources(context: Path, dockerfile_path: Path) -> list[Path]:
    text = _read_text(dockerfile_path)
    logical = _dockerfile_logical_lines(text)
    dockerignore_rules = _read_dockerignore_rules(context)

    paths: list[Path] = []
    for ln in logical:
        parsed = _parse_copy_add(ln)
        if not parsed:
            continue
        if parsed.from_stage:
            continue
        for src in parsed.sources:
            if _looks_like_remote(src):
                continue
            if src.startswith("/"):
                # Absolute COPY sources aren't valid for local context; ignore to avoid surprises.
                continue
            # Docker allows ".", "./foo", etc.
            src_norm = src.lstrip("./")
            if src_norm == "":
                src_norm = "."

            if _is_glob(src_norm):
                # Expand within context
                for root, _, filenames in os.walk(context):
                    root_p = Path(root)
                    rel_root = root_p.relative_to(context).as_posix()
                    for fn in filenames:
                        rel = f"{rel_root}/{fn}" if rel_root != "." else fn
                        if _is_ignored_by_dockerignore(dockerignore_rules, rel_posix=rel, is_dir=False):
                            continue
                        if fnmatch.fnmatch(rel, src_norm) or fnmatch.fnmatch(fn, src_norm):
                            paths.append(context / rel)
                continue

            p = (context / src_norm).resolve()
            # Ensure stays within context
            try:
                p.relative_to(context.resolve())
            except Exception:
                continue
            for fp in _iter_files_under(p):
                try:
                    rel = fp.resolve().relative_to(context.resolve()).as_posix()
                except Exception:
                    continue
                if _is_ignored_by_dockerignore(dockerignore_rules, rel_posix=rel, is_dir=fp.is_dir()):
                    continue
                paths.append(fp)

    # Always include the Dockerfile itself (and preserve stable ordering via sort later)
    paths.append(dockerfile_path.resolve())
    return paths


def compute_inputs_hash(context: Path, dockerfile_path: Path) -> str:
    files = _collect_sources(context=context, dockerfile_path=dockerfile_path)
    # Deduplicate by resolved path
    uniq: dict[str, Path] = {}
    for p in files:
        uniq[str(p)] = p

    # Stable sort by path relative to context when possible, else absolute
    ctx_resolved = context.resolve()
    def sort_key(p: Path) -> str:
        try:
            return p.resolve().relative_to(ctx_resolved).as_posix()
        except Exception:
            return p.resolve().as_posix()

    sorted_files = sorted(uniq.values(), key=sort_key)

    h = hashlib.sha256()
    for p in sorted_files:
        rp: str
        try:
            rp = p.resolve().relative_to(ctx_resolved).as_posix()
        except Exception:
            rp = p.resolve().as_posix()
        h.update(rp.encode("utf-8", errors="strict"))
        h.update(b"\0")
        if p.is_file():
            h.update(_sha256_file(p).encode("ascii"))
        else:
            h.update(b"NONFILE")
        h.update(b"\n")

    return h.hexdigest()


def compute_inputs_debug(context: Path, dockerfile_path: Path) -> tuple[str, list[tuple[str, str]]]:
    """
    Returns (inputs_hash, [(rel_path, sha256_of_file_contents), ...]) with dockerignore applied.
    """
    files = _collect_sources(context=context, dockerfile_path=dockerfile_path)
    uniq: dict[str, Path] = {}
    for p in files:
        uniq[str(p.resolve())] = p.resolve()

    ctx_resolved = context.resolve()

    def rel_or_abs(p: Path) -> str:
        try:
            return p.resolve().relative_to(ctx_resolved).as_posix()
        except Exception:
            return p.resolve().as_posix()

    sorted_files = sorted(uniq.values(), key=lambda p: rel_or_abs(p))

    items: list[tuple[str, str]] = []
    for p in sorted_files:
        rp = rel_or_abs(p)
        if p.is_file():
            items.append((rp, _sha256_file(p)))
        else:
            items.append((rp, "NONFILE"))

    return compute_inputs_hash(context=context, dockerfile_path=dockerfile_path), items


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--context", required=True, help="Build context directory")
    ap.add_argument("--dockerfile", required=True, help="Dockerfile path")
    ap.add_argument(
        "--debug-list",
        action="store_true",
        help="Print the included file list (relpath|sha256) to stderr",
    )
    args = ap.parse_args()

    context = Path(args.context).resolve()
    dockerfile = Path(args.dockerfile).resolve()

    if not context.exists() or not context.is_dir():
        print(f"Context not found or not a directory: {context}", file=sys.stderr)
        return 2
    if not dockerfile.exists() or not dockerfile.is_file():
        print(f"Dockerfile not found: {dockerfile}", file=sys.stderr)
        return 2

    if args.debug_list:
        h, items = compute_inputs_debug(context=context, dockerfile_path=dockerfile)
        for rp, sh in items:
            print(f"{rp}|{sh}", file=sys.stderr)
        print(h)
    else:
        print(compute_inputs_hash(context=context, dockerfile_path=dockerfile))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

