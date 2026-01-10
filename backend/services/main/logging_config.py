import logging
import os
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from threading import RLock
from typing import Dict

LOGS_DIR = Path(__file__).resolve().parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)


class HumanReadableFileHandler(RotatingFileHandler):
    def __init__(self, filename: Path, level: int) -> None:
        super().__init__(filename, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8", delay=True)
        self.level = level
        self._lock = RLock()
        self._last_date: str | None = None
        self._previous_entry: str | None = None

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage().strip()
            if not message:
                return

            timestamp = datetime.fromtimestamp(record.created)
            date_str = timestamp.strftime("%d.%m.%Y")
            time_str = timestamp.strftime("%H:%M:%S")
            lines = [line.rstrip() for line in message.splitlines() if line.strip()]

            with self._lock:
                if self.stream is None:
                    self.stream = self._open()

                if self._last_date != date_str:
                    if self._last_date is not None:
                        self.stream.write("\n")
                    separator = "-" * 11
                    self.stream.write(f"\n\n{separator}\n{date_str}\n{separator}\n\n")
                    self._last_date = date_str

                entry_lines: list[str] = []
                if lines:
                    entry_lines.append(f"{time_str} {lines[0]}")
                    for line in lines[1:]:
                        if line.startswith("|"):
                            entry_lines.append(f"    {line}")
                        else:
                            entry_lines.append(f"  ↳ {line}")
                else:
                    entry_lines.append(time_str)
                entry_text = "\n".join(entry_lines)
                if entry_text == self._previous_entry:
                    return
                self.stream.write(entry_text + "\n")
                self._previous_entry = entry_text
                self.flush()
        except Exception:
            self.handleError(record)


_HANDLED_FILES: Dict[str, Path] = {}


def _configure_logger(name: str, filename: str, level: int = logging.INFO) -> logging.Logger:
    logger = logging.getLogger(name)
    target_path = LOGS_DIR / filename

    if _HANDLED_FILES.get(name) == target_path:
        return logger

    logger.handlers.clear()

    handler = HumanReadableFileHandler(target_path, level)
    handler.setLevel(level)
    logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False

    _HANDLED_FILES[name] = target_path
    return logger


security_logger = _configure_logger("security", "security.log")
public_chat_logger = _configure_logger("public_chat", "public-chat.log")
dm_logger = _configure_logger("dm", "dm.log")
access_logger = _configure_logger("access", "access.log")

