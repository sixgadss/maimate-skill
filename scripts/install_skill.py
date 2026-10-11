#!/usr/bin/env python3
"""Install the packaged Skill without replacing an existing installation."""

import argparse
import os
from pathlib import Path
import shutil
import tempfile


def install(destination: Path) -> Path:
    source = Path(__file__).resolve().parents[1] / "skills" / "maimate"
    if not (source / "SKILL.md").is_file():
        raise RuntimeError("Missing packaged skills/maimate/SKILL.md")
    destination = destination.expanduser().absolute()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f"Installation already exists; nothing changed: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # An exclusive directory creation prevents concurrent installers overwriting a skill.
    destination.mkdir()
    try:
        with tempfile.TemporaryDirectory(prefix="maimate-install-") as scratch:
            prepared = Path(scratch) / "maimate"
            shutil.copytree(source, prepared)
            for child in prepared.iterdir():
                target = destination / child.name
                if child.is_dir():
                    shutil.copytree(child, target)
                else:
                    shutil.copy2(child, target)
    except Exception:
        # Only this invocation's newly created directory is removed on failure.
        shutil.rmtree(destination)
        raise
    return destination


def main() -> None:
    codex_root = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=codex_root / "skills" / "maimate")
    args = parser.parse_args()
    try:
        path = install(args.destination)
    except (OSError, RuntimeError) as error:
        parser.exit(1, f"{error}\n")
    print(f"Skill installed: {path}")
    print("Reload your skill-capable host. No MCP service or account was configured.")


if __name__ == "__main__":
    main()
