import json
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

WATCH_DIR = Path.home() / "Downloads" / "Janitor-Analytics"


class JanitorJsonHandler(FileSystemEventHandler):
    def on_created(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix.lower() == ".json":
            self._process(path)

    def on_moved(self, event):
        # Chrome saves as xxx.json.crdownload then renames to xxx.json,
        # which fires on_moved, not on_created.
        if event.is_directory:
            return
        path = Path(event.dest_path)
        if path.suffix.lower() == ".json":
            self._process(path)

    def _process(self, path: Path):
        time.sleep(0.2)  # let the browser finish writing the file
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"[error] could not read {path.name}: {e}")
            return

        try:
            rel = path.relative_to(WATCH_DIR)
        except ValueError:
            rel = path.name

        if isinstance(data, dict) and data.get("schemaVersion") == 1:
            creator = data.get("creator", {}).get("name", "?")
            totals = data.get("totals", {})
            bots = totals.get("bots", "?")
            msgs = totals.get("messages", "?")
            chats = totals.get("chats", "?")
            print(f"[picked up] {rel}")
            print(f"            creator={creator}, bots={bots}, messages={msgs}, chats={chats}")
        elif isinstance(data, dict):
            print(f"[picked up] {rel} -> dict with keys {list(data.keys())}")
        elif isinstance(data, list):
            print(f"[picked up] {rel} -> list with {len(data)} items")
        else:
            print(f"[picked up] {rel} -> {type(data).__name__}")


def main():
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    print(f"watching: {WATCH_DIR}")
    print("(includes all creator subfolders inside)")
    print("Ctrl+C to stop.")
    observer = Observer()
    observer.schedule(JanitorJsonHandler(), str(WATCH_DIR), recursive=True)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
        print("\nstopped.")
    observer.join()


if __name__ == "__main__":
    main()
