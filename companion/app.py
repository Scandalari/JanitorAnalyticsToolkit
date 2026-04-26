import json
import os
import subprocess
import tempfile
import threading
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime, timedelta
from pathlib import Path

import webview

# Ko-Fi link for the "Like this app?" button in Settings.
# REPLACE_WITH_YOUR_KOFI_HANDLE — paste your actual ko-fi URL here, idiot.
KOFI_URL = "https://ko-fi.com/scandalari"

# Source of truth for app version. installer.iss MyAppVersion must match
# before each release build.
__version__ = "1.0.6"
GITHUB_REPO = "Scandalari/JanitorAnalyticsToolkit"


def _parse_version(s):
    if not s:
        return None
    s = s.strip()
    if s[:1].lower() == "v":
        s = s[1:]
    try:
        return tuple(int(p) for p in s.split("."))
    except ValueError:
        return None


WEB_DIR = Path(__file__).parent / "web"
DATA_DIR = Path.home() / "Downloads" / "Janitor-Analytics"
APP_DATA_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "JanitorAnalytics"
SETTINGS_PATH = APP_DATA_DIR / "settings.json"
DEFAULT_SETTINGS = {
    "default_creator": None,
    "theme": "teal",
    "unlocked_eggs": [],
    "enabled_eggs": [],
}

# Magic word (lowercased) -> egg id. Unlock matching is case-insensitive,
# trimmed for whitespace, and only triggers on exact equality (no substring).
EASTER_EGG_UNLOCKS = {
    "scandalari": "scandalari",
    "nikki": "nikki",
    "lumbridge": "lumbridge",
    "why?": "why",
    "lorem ipsum": "lorem_ipsum",
    "ncc-1701-d": "trek",
    "craos": "craos",
}

WINDOW_TITLE = "Janitor Analytics"


def _get_window_work_area():
    """Returns (x, y, w, h) of the work area of the monitor containing our
    window, or the primary monitor's work area as fallback. Excludes the
    Windows taskbar so a "maximize" doesn't cover it. Returns None if all
    win32 calls fail (we then fall back to pywebview's native maximize)."""
    try:
        import ctypes

        class RECT(ctypes.Structure):
            _fields_ = [
                ("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long),
            ]

        class MONITORINFO(ctypes.Structure):
            _fields_ = [
                ("cbSize", ctypes.c_ulong),
                ("rcMonitor", RECT),
                ("rcWork", RECT),
                ("dwFlags", ctypes.c_ulong),
            ]

        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, WINDOW_TITLE)
        if hwnd:
            MONITOR_DEFAULTTONEAREST = 2
            monitor = user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
            info = MONITORINFO()
            info.cbSize = ctypes.sizeof(MONITORINFO)
            if user32.GetMonitorInfoW(monitor, ctypes.byref(info)):
                w = info.rcWork
                return (w.left, w.top, w.right - w.left, w.bottom - w.top)

        # Fallback: SPI_GETWORKAREA on the primary monitor.
        SPI_GETWORKAREA = 0x0030
        rect = RECT()
        if user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rect), 0):
            return (rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
    except Exception:
        pass
    return None

EASTER_EGGS = [
    {
        "id": "scandalari",
        "name": "Scandalari Mode",
        "description": "Scandalari's color code, but everywhere and completely random.",
    },
    {
        "id": "nikki",
        "name": "Nikki Mode",
        "description": "Mama loves you!",
    },
    {
        "id": "lumbridge",
        "name": "Lumbridge",
        "description": "Pro: Yellow Text Black Background",
    },
    {
        "id": "why",
        "name": "Light Mode",
        "description": "Who in their right mind would do this?",
    },
    {
        "id": "lorem_ipsum",
        "name": "Scandalari's Lorem Ipsum",
        "description": "Replaces the app background with the Scandalari's profile lorem ipsum.",
    },
    {
        "id": "owl",
        "name": "The Owl",
        "description": "Mama's buddy has arrived!",
    },
    {
        "id": "absolute_mommy",
        "name": "Absolute Mommy",
        "description": "Renames the prompt generator's 'Character Concept' to 'Mommy Maker'.",
    },
    {
        "id": "trek",
        "name": "NCC-1701-D",
        "description": "Engage. Background and font go full Star Trek.",
    },
    {
        "id": "craos",
        "name": "Craos",
        "description": "UI elements briefly blip out at random. Whatever you're hovering over is safe.",
    },
    {
        "id": "lowercase",
        "name": "Lowercase Tone",
        "description": "Forces the whole UI into lowercase. Auto-unlocks the first time you view a creator whose name has no capital letters.",
    },
]

GENDER_OPTIONS = ["Male", "Female", "Other"]

PRONOUNS = {
    "Female": {
        "subj": "She", "obj": "her", "poss": "her", "noun": "woman",
        "is_contraction": "She's", "dresses": "dresses", "and_is": "is",
    },
    "Male": {
        "subj": "He", "obj": "him", "poss": "his", "noun": "man",
        "is_contraction": "He's", "dresses": "dresses", "and_is": "is",
    },
    "Other": {
        "subj": "They", "obj": "them", "poss": "their", "noun": "person",
        "is_contraction": "They're", "dresses": "dress", "and_is": "are",
    },
}

ETHNICITY_PHRASES = {
    "White": "White",
    "Black": "Black",
    "East Asian": "East Asian",
    "Southeast Asian": "Southeast Asian",
    "South Asian": "South Asian",
    "Hispanic": "Hispanic",
    "Middle Eastern": "Middle Eastern",
    "Mixed": "mixed-ethnicity",
}

BODY_PHRASES = {
    "Petite": "petite",
    "Slim": "slim",
    "Athletic": "athletic",
    "Average": "average build",
    "Curvy": "curvy",
    "Thicc": "thicc",
    "Plus": "plus-sized",
    "Muscular": "muscular",
}

HAIR_PHRASES = {
    "Black": "black",
    "Brown": "brown",
    "Blonde": "blonde",
    "Red": "red",
    "Auburn": "auburn",
    "Pink": "pink",
    "Blue": "blue",
    "Purple": "purple",
    "Silver/White": "silver",
    "Green": "green",
    "Ginger": "ginger",
    "Multi": "multi-colored",
}

EYE_PHRASES = {
    "Brown": "brown eyes",
    "Blue": "blue eyes",
    "Green": "green eyes",
    "Hazel": "hazel eyes",
    "Grey": "grey eyes",
    "Amber": "amber eyes",
    "Heterochromia": "heterochromatic eyes",
}

STYLE_PHRASES = {
    "Alt": "an alternative style",
    "Punk": "a punk style",
    "Goth": "a gothic style",
    "Cottagecore": "cottagecore fashion",
    "Streetwear": "streetwear",
    "Preppy": "a preppy style",
    "Professional": "professional attire",
    "Sporty": "sporty clothing",
    "Elegant": "elegant fashion",
    "Grunge": "grunge fashion",
    "Y2K": "Y2K fashion",
    "Bohemian": "bohemian fashion",
    "Minimalist": "a minimalist style",
    "Cosplay": "cosplay outfits",
    "Nerdy": "nerdy attire",
    "Cozy": "cozy clothes",
    "Military": "military-style clothing",
}

PERSONALITY_PHRASES = {
    "Brat": "a bit of a brat",
    "Shy": "shy",
    "Confident": "very confident",
    "Tsundere": "kind of a tsundere",
    "Yandere": "a yandere",
    "Kuudere": "a kuudere",
    "Degenerate": "a degenerate",
    "Innocent": "innocent",
    "Dominant": "dominant",
    "Submissive": "submissive",
    "Teasing": "playful and teasing",
    "Nerd/Geek": "a nerd",
    "Goth": "a goth",
    "Cheerful": "cheerful",
    "Cold/Distant": "cold and distant",
    "Chaotic": "chaotic",
    "Elegant": "elegant",
    "Sporty": "sporty",
    "Feminine": "very feminine",
    "Shameless": "shameless",
}

RELATIONSHIP_PHRASES = {
    "Stranger": "you don't really know each other",
    "Roommate": "{IsContr} your roommate",
    "Neighbor": "{IsContr} your neighbor",
    "Coworker": "{IsContr} your coworker",
    "Boss": "{IsContr} your boss",
    "Employee": "{IsContr} your employee",
    "Classmate": "{IsContr} your classmate",
    "Teacher": "{IsContr} your teacher",
    "Student": "{IsContr} your student",
    "Ex": "{IsContr} your ex",
    "Crush": "{IsContr} your crush",
    "Friend": "{IsContr} your friend",
    "Best Friend": "{IsContr} your best friend",
    "Friend's Parent": "{IsContr} your friend's parent",
    "Friend's Sibling": "{IsContr} your friend's sibling",
    "Stepsibling": "{IsContr} your stepsibling",
    "Stepparent": "{IsContr} your stepparent",
    "Landlord": "{IsContr} your landlord",
    "Rival": "you're rivals",
    "Online Match": "you met {obj} online",
    "Celebrity": "{IsContr} a celebrity you admire",
    "Barista": "{IsContr} the barista at your usual spot",
    "Trainer": "{IsContr} your personal trainer",
    "Doctor": "{IsContr} your doctor",
    "Therapist": "{IsContr} your therapist",
}

SCENARIO_PHRASES = {
    "Late night encounter": "having a late-night encounter",
    "Caught in the act": "having been caught in the act",
    "Stuck together": "stuck together",
    "One night stand": "having a one-night stand",
    "Mutual secret": "sharing a mutual secret",
    "First date": "on a first date",
    "Reunion": "having a reunion",
    "Moving in": "moving in together",
    "Road trip": "on a road trip",
    "Party": "at a party",
    "Wrong number": "trading texts after a wrong number",
    "Dare/Bet": "tangled up in a dare",
    "Fake dating": "fake dating",
    "Snowed in": "snowed in together",
    "Power outage": "stuck in a power outage",
    "After a breakup": "navigating life after a breakup",
    "Drunk confession": "trading drunk confessions",
    "Accidental sext": "recovering from an accidental sext",
    "Sharing a bed": "sharing a bed",
    "Study session": "in a study session",
    "Gym": "working out together",
    "Coffee shop": "meeting at a coffee shop",
    "Wedding": "attending a wedding",
    "Beach vacation": "on a beach vacation",
}

SETTING_PHRASES = {
    "Apartment/Home": "at home",
    "College Campus": "on the college campus",
    "Office": "at the office",
    "Party": "at a party",
    "Club/Bar": "at a club",
    "Gym": "at a gym",
    "Beach": "at the beach",
    "Hotel": "in a hotel",
    "Road Trip": "on the road",
    "Small Town": "in a small town",
    "Big City": "in the big city",
    "Suburb": "in the suburbs",
    "Online": "online",
    "Coffee Shop": "in a coffee shop",
    "Library": "in the library",
    "Hospital": "at the hospital",
    "Festival": "at a festival",
}

TONE_PHRASES = {
    "Enemies to Lovers": "an enemies-to-lovers story",
    "Friends to Lovers": "a friends-to-lovers story",
    "Dark Romance": "a dark romance",
    "Lighthearted": "lighthearted",
    "Comedy": "a comedy",
    "Angst": "full of angst",
    "Wholesome": "wholesome",
    "Forbidden": "forbidden",
    "Casual/FWB": "casual",
    "Obsessive": "obsessive",
    "Bittersweet": "bittersweet",
    "Mystery/Thriller": "a mystery thriller",
    "Dead Dove": "dead-dove territory",
}


def build_adlib(values, gender):
    p = PRONOUNS.get(gender, PRONOUNS["Other"])

    ethnicity = ETHNICITY_PHRASES.get(values.get("ethnicity", ""), values.get("ethnicity", ""))

    age_label = values.get("age_category", "")
    if age_label == "Teen (18-22)":
        age_clause = f"young {p['noun']} between the ages of 18 and 22"
    elif age_label == "Young Adult (23-25)":
        age_clause = f"young {p['noun']} between the ages of 23 and 25"
    elif age_label == "Adult (26-34)":
        age_clause = f"{p['noun']} between the ages of 26 and 34"
    elif age_label == "MILF (35+)":
        if gender == "Female":
            age_clause = "MILF in her late 30s or beyond"
        elif gender == "Male":
            age_clause = "DILF in his late 30s or beyond"
        else:
            age_clause = f"older {p['noun']} in {p['poss']} late 30s or beyond"
    else:
        age_clause = p["noun"]

    article = "an" if (ethnicity and ethnicity[0].lower() in "aeiou") else "a"
    s1 = f"{{{{Char}}}} is {article} {ethnicity} {age_clause}."

    body = BODY_PHRASES.get(values.get("body_type", ""), values.get("body_type", "").lower())
    hair = HAIR_PHRASES.get(values.get("hair_color", ""), values.get("hair_color", "").lower())
    eyes = EYE_PHRASES.get(
        values.get("eye_color", ""),
        f"{values.get('eye_color', '').lower()} eyes",
    )
    s2 = f"{p['is_contraction']} {body}, with {hair} hair and {eyes}."

    style = STYLE_PHRASES.get(values.get("style", ""), values.get("style", "").lower())
    personality_label = values.get("personality", "")
    if personality_label == "Motherly/Fatherly":
        if gender == "Female":
            personality = "motherly"
        elif gender == "Male":
            personality = "fatherly"
        else:
            personality = "nurturing"
    else:
        personality = PERSONALITY_PHRASES.get(personality_label, personality_label.lower())
    s3 = f"{p['subj']} {p['dresses']} in {style}, and {p['and_is']} {personality}."

    rel_template = RELATIONSHIP_PHRASES.get(values.get("relationship", ""), "")
    rel_phrase = rel_template.format(
        Subj=p["subj"],
        obj=p["obj"],
        IsContr=p["is_contraction"],
    ) if rel_template else ""
    if rel_phrase:
        rel_phrase = rel_phrase[0].upper() + rel_phrase[1:]
    scenario_p = SCENARIO_PHRASES.get(values.get("scenario", ""), values.get("scenario", "").lower())
    setting_p = SETTING_PHRASES.get(values.get("setting", ""), values.get("setting", "").lower())
    s4 = f"{rel_phrase}, and you're {scenario_p} {setting_p}."

    tone = TONE_PHRASES.get(values.get("tone", ""), values.get("tone", "").lower())
    s5 = f"Your romance is {tone}."

    return " ".join([s1, s2, s3, s4, s5])


PROMPT_SLOTS = [
    {
        "key": "age_category",
        "label": "Age Category",
        "options": ["Teen (18-22)", "Young Adult (23-25)", "Adult (26-34)", "MILF (35+)"],
    },
    {
        "key": "hair_color",
        "label": "Hair Color",
        "options": [
            "Black", "Brown", "Blonde", "Red", "Auburn", "Pink",
            "Blue", "Purple", "Silver/White", "Green", "Ginger", "Multi",
        ],
    },
    {
        "key": "body_type",
        "label": "Body Type",
        "options": [
            "Petite", "Slim", "Athletic", "Average",
            "Curvy", "Thicc", "Plus", "Muscular",
        ],
    },
    {
        "key": "relationship",
        "label": "Relationship to {{user}}",
        "options": [
            "Stranger", "Roommate", "Neighbor", "Coworker", "Boss", "Employee",
            "Classmate", "Teacher", "Student", "Ex", "Crush", "Friend",
            "Best Friend", "Friend's Parent", "Friend's Sibling", "Stepsibling",
            "Stepparent", "Landlord", "Rival", "Online Match", "Celebrity",
            "Barista", "Trainer", "Doctor", "Therapist",
        ],
    },
    {
        "key": "scenario",
        "label": "Scenario",
        "options": [
            "Late night encounter", "Caught in the act", "Stuck together",
            "One night stand", "Mutual secret", "First date", "Reunion",
            "Moving in", "Road trip", "Party", "Wrong number", "Dare/Bet",
            "Fake dating", "Snowed in", "Power outage", "After a breakup",
            "Drunk confession", "Accidental sext", "Sharing a bed",
            "Study session", "Gym", "Coffee shop", "Wedding", "Beach vacation",
        ],
    },
    {
        "key": "personality",
        "label": "Personality",
        "options": [
            "Brat", "Shy", "Confident", "Tsundere", "Yandere", "Kuudere",
            "Degenerate", "Innocent", "Motherly/Fatherly", "Dominant",
            "Submissive", "Teasing", "Nerd/Geek", "Goth", "Cheerful",
            "Cold/Distant", "Chaotic", "Elegant", "Sporty", "Feminine",
            "Shameless",
        ],
    },
    {
        "key": "setting",
        "label": "Setting",
        "options": [
            "Apartment/Home", "College Campus", "Office", "Party", "Club/Bar",
            "Gym", "Beach", "Hotel", "Road Trip", "Small Town", "Big City",
            "Suburb", "Online", "Coffee Shop", "Library", "Hospital", "Festival",
        ],
    },
    {
        "key": "tone",
        "label": "Tone",
        "options": [
            "Enemies to Lovers", "Friends to Lovers", "Dark Romance",
            "Lighthearted", "Comedy", "Angst", "Wholesome", "Forbidden",
            "Casual/FWB", "Obsessive", "Bittersweet", "Mystery/Thriller",
            "Dead Dove",
        ],
    },
    {
        "key": "ethnicity",
        "label": "Ethnicity",
        "options": [
            "White", "Black", "East Asian", "Southeast Asian", "South Asian",
            "Hispanic", "Middle Eastern", "Mixed",
        ],
    },
    {
        "key": "eye_color",
        "label": "Eye Color",
        "options": ["Brown", "Blue", "Green", "Hazel", "Grey", "Amber", "Heterochromia"],
    },
    {
        "key": "style",
        "label": "Style",
        "options": [
            "Alt", "Punk", "Goth", "Cottagecore", "Streetwear", "Preppy",
            "Professional", "Sporty", "Elegant", "Grunge", "Y2K", "Bohemian",
            "Minimalist", "Cosplay", "Nerdy", "Cozy", "Military",
        ],
    },
]


class JsApi:
    def __init__(self):
        # (x, y, w, h) saved before maximize so window_maximize_toggle can
        # restore. The max state itself is read by comparing current window
        # rect to the work area, so it stays correct even when Windows
        # un-maximizes the window via Aero Snap drag.
        self._restore_rect = None

    def get_prompt_config(self):
        return {"slots": PROMPT_SLOTS, "gender_options": GENDER_OPTIONS}

    def open_kofi(self):
        webbrowser.open(KOFI_URL)
        return True

    def window_minimize(self):
        if webview.windows:
            webview.windows[0].minimize()
        return True

    def window_maximize_toggle(self):
        if not webview.windows:
            return False
        win = webview.windows[0]
        work = _get_window_work_area()

        try:
            cur_rect = (win.x, win.y, win.width, win.height)
        except (AttributeError, TypeError):
            cur_rect = None

        is_max = (work is not None and cur_rect is not None and cur_rect == work)

        if is_max:
            if self._restore_rect is not None:
                rx, ry, rw, rh = self._restore_rect
                win.move(rx, ry)
                win.resize(rw, rh)
            else:
                win.resize(1280, 800)
            return True

        if cur_rect is not None:
            self._restore_rect = cur_rect
        if work is not None:
            wx, wy, ww, wh = work
            win.move(wx, wy)
            win.resize(ww, wh)
        else:
            # Last-ditch fallback — covers the taskbar but at least responds.
            win.maximize()
        return True

    def window_close(self):
        if webview.windows:
            webview.windows[0].destroy()
        return True

    def window_native_drag(self):
        """Hand the current mouse drag to Windows by sending a synthetic
        WM_NCLBUTTONDOWN with HTCAPTION. The OS treats it as a real title-bar
        grab, which gives us Aero Snap (drag to top = max, drag to side =
        half-screen) and proper drag-while-maximized restore for free."""
        return self._send_nc_lbutton_down(2)  # HTCAPTION

    def window_native_resize(self, ht_code):
        """Hand a resize drag to Windows. ht_code is one of HTLEFT..HTBOTTOMRIGHT
        (10..17). Called from a mousedown on one of our edge/corner divs."""
        if not isinstance(ht_code, int) or ht_code < 10 or ht_code > 17:
            return False
        return self._send_nc_lbutton_down(ht_code)

    def _send_nc_lbutton_down(self, ht_code):
        if not webview.windows:
            return False
        try:
            import ctypes
            user32 = ctypes.windll.user32
            hwnd = user32.FindWindowW(None, WINDOW_TITLE)
            if not hwnd:
                return False
            WM_NCLBUTTONDOWN = 0x00A1
            user32.ReleaseCapture()
            user32.SendMessageW(hwnd, WM_NCLBUTTONDOWN, ht_code, 0)
        except Exception:
            return False
        return True

    def get_version(self):
        return __version__

    def check_for_update(self):
        payload = {
            "current": __version__,
            "latest": None,
            "has_update": False,
            "html_url": None,
            "asset_url": None,
            "error": None,
        }
        try:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
                headers={
                    "User-Agent": f"JanitorAnalytics/{__version__}",
                    "Accept": "application/vnd.github+json",
                },
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            payload["error"] = "Couldn't reach GitHub."
            return payload

        payload["latest"] = (data.get("tag_name") or "").strip() or None
        payload["html_url"] = data.get("html_url")

        for asset in data.get("assets", []) or []:
            name = asset.get("name", "") or ""
            if name.lower().endswith(".exe"):
                payload["asset_url"] = asset.get("browser_download_url")
                break

        current_v = _parse_version(__version__)
        latest_v = _parse_version(payload["latest"])
        if current_v is not None and latest_v is not None:
            payload["has_update"] = latest_v > current_v
        return payload

    def open_release_page(self, url):
        # Only allow github.com release URLs through — JsApi is reachable from
        # any JS context and webbrowser.open will happily launch anything.
        if not isinstance(url, str) or not url.startswith("https://github.com/"):
            return False
        webbrowser.open(url)
        return True

    def download_and_install_update(self, url):
        if not isinstance(url, str) or not url.startswith("https://github.com/"):
            return {"ok": False, "error": "Invalid update URL."}

        try:
            tmp_fd, tmp_path = tempfile.mkstemp(
                suffix=".exe", prefix="JanitorAnalytics-Setup-"
            )
            os.close(tmp_fd)
            req = urllib.request.Request(
                url,
                headers={"User-Agent": f"JanitorAnalytics/{__version__}"},
            )
            with urllib.request.urlopen(req, timeout=60) as resp, open(tmp_path, "wb") as f:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
        except (urllib.error.URLError, TimeoutError, OSError):
            return {"ok": False, "error": "Couldn't download the update."}

        try:
            # Detached so the installer outlives our process; /SILENT shows a
            # progress bar but skips wizard prompts, /SUPPRESSMSGBOXES kills
            # the "are you sure" dialogs. Inno Setup re-launches the app on
            # finish (default behavior with RestartApplications=yes).
            creationflags = 0
            if hasattr(subprocess, "DETACHED_PROCESS"):
                creationflags |= subprocess.DETACHED_PROCESS
            if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
                creationflags |= subprocess.CREATE_NEW_PROCESS_GROUP
            subprocess.Popen(
                [tmp_path, "/SILENT", "/SUPPRESSMSGBOXES"],
                creationflags=creationflags,
                close_fds=True,
            )
        except OSError:
            return {"ok": False, "error": "Couldn't launch the installer."}

        # Hard-exit shortly after returning so the installer can overwrite the
        # running .exe. The brief delay lets pywebview ship our return value
        # back to JS (so the UI can show "installing..." before vanishing).
        threading.Timer(0.5, lambda: os._exit(0)).start()
        return {"ok": True, "error": None}

    def get_egg_definitions(self):
        return EASTER_EGGS

    def try_unlock_egg(self, word):
        if not word:
            return None
        normalized = word.strip().lower()
        egg_id = EASTER_EGG_UNLOCKS.get(normalized)
        if not egg_id:
            return None
        settings = self.get_settings()
        unlocked = list(settings.get("unlocked_eggs", []))
        if egg_id not in unlocked:
            unlocked.append(egg_id)
            settings["unlocked_eggs"] = unlocked
            self.set_settings(settings)
        for egg in EASTER_EGGS:
            if egg["id"] == egg_id:
                return egg
        return None

    def unlock_egg_by_id(self, egg_id):
        """Unlock an egg directly by ID, bypassing the magic-word check.
        Used for meta-condition unlocks like the Owl. Returns the egg metadata
        if newly unlocked, None if already unlocked or unknown egg_id."""
        if not any(e["id"] == egg_id for e in EASTER_EGGS):
            return None
        settings = self.get_settings()
        unlocked = list(settings.get("unlocked_eggs", []))
        if egg_id in unlocked:
            return None
        unlocked.append(egg_id)
        settings["unlocked_eggs"] = unlocked
        self.set_settings(settings)
        for egg in EASTER_EGGS:
            if egg["id"] == egg_id:
                return egg
        return None

    def set_egg_enabled(self, egg_id, enabled):
        settings = self.get_settings()
        enabled_eggs = set(settings.get("enabled_eggs", []))
        if enabled:
            enabled_eggs.add(egg_id)
        else:
            enabled_eggs.discard(egg_id)
        settings["enabled_eggs"] = sorted(enabled_eggs)
        self.set_settings(settings)
        return settings

    def generate_adlib(self, values, gender):
        return build_adlib(values or {}, gender or "Female")

    def get_settings(self):
        if not SETTINGS_PATH.exists():
            return dict(DEFAULT_SETTINGS)
        try:
            with open(SETTINGS_PATH, encoding="utf-8") as f:
                loaded = json.load(f)
        except (OSError, json.JSONDecodeError):
            return dict(DEFAULT_SETTINGS)
        # Merge with defaults so missing keys get filled in
        merged = dict(DEFAULT_SETTINGS)
        merged.update(loaded)
        return merged

    def set_settings(self, settings):
        APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
        merged = dict(DEFAULT_SETTINGS)
        merged.update(settings or {})
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2)
        return merged

    def list_creators(self):
        if not DATA_DIR.exists():
            return []
        return sorted(
            [p.name for p in DATA_DIR.iterdir() if p.is_dir()],
            key=str.lower,
        )

    def _load_snapshots(self, creator: str):
        creator_dir = DATA_DIR / creator
        if not creator_dir.exists():
            return []
        snapshots = []
        for path in sorted(creator_dir.glob("*.json")):
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
            snapshots.append(data)
        snapshots.sort(key=lambda s: s.get("pulledAt", ""))
        return snapshots

    def _latest_per_local_day(self, snapshots):
        # Snapshots come in pulledAt-ascending order, so the last write per
        # local-date key is naturally the latest of that day.
        by_date = {}
        for s in snapshots:
            pulled_at = s.get("pulledAt")
            if not pulled_at:
                continue
            try:
                dt_local = datetime.fromisoformat(
                    pulled_at.replace("Z", "+00:00")
                ).astimezone()
            except ValueError:
                continue
            by_date[dt_local.date()] = s
        return [by_date[d] for d in sorted(by_date.keys())]

    def get_creator_summary(self, creator: str):
        snapshots = self._load_snapshots(creator)
        if not snapshots:
            return None
        latest = snapshots[-1]
        totals = latest.get("totals", {})
        msgs = totals.get("messages", 0)
        chats = totals.get("chats", 0)
        avg_retention = (msgs / chats) if chats else 0
        return {
            "creator": latest.get("creator", {}).get("name", creator),
            "follower_count": latest.get("creator", {}).get("followerCount", 0),
            "bots": totals.get("bots", 0),
            "messages": msgs,
            "chats": chats,
            "avg_retention": avg_retention,
        }

    def get_creator_timeseries(self, creator: str):
        snapshots = self._latest_per_local_day(self._load_snapshots(creator))
        result = []
        for s in snapshots:
            totals = s.get("totals", {})
            msgs = totals.get("messages", 0)
            chats = totals.get("chats", 0)
            result.append({
                "pulledAt": s.get("pulledAt"),
                "messages": msgs,
                "chats": chats,
                "retention": (msgs / chats) if chats else 0,
            })
        return result

    def get_bot_timeseries(self, creator: str, bot_id: str):
        snapshots = self._latest_per_local_day(self._load_snapshots(creator))
        result = []
        for s in snapshots:
            bot = next(
                (b for b in s.get("bots", []) if b.get("id") == bot_id),
                None,
            )
            if not bot:
                continue
            msgs = bot.get("messages", 0)
            chats = bot.get("chats", 0)
            result.append({
                "pulledAt": s.get("pulledAt"),
                "messages": msgs,
                "chats": chats,
                "retention": (msgs / chats) if chats else 0,
            })
        return result

    def get_weekly_report(self, creator: str):
        snapshots = self._load_snapshots(creator)
        if not snapshots:
            return []

        # Bucket each snapshot into its Sun-Sat week (local time).
        # Snapshots come in pulledAt-ascending order, so the last write per
        # week_start key is naturally the latest snapshot of that week.
        by_week = {}
        for s in snapshots:
            pulled_at = s.get("pulledAt")
            if not pulled_at:
                continue
            try:
                dt_local = datetime.fromisoformat(
                    pulled_at.replace("Z", "+00:00")
                ).astimezone()
            except ValueError:
                continue
            # Python's weekday(): Mon=0..Sun=6. We want Sun=start, so:
            days_since_sunday = (dt_local.weekday() + 1) % 7
            week_start = (dt_local - timedelta(days=days_since_sunday)).date()
            by_week[week_start] = s

        if len(by_week) < 2:
            return []

        sorted_weeks = sorted(by_week.keys())
        weeks = []
        for i in range(1, len(sorted_weeks)):
            prev = by_week[sorted_weeks[i - 1]]
            curr = by_week[sorted_weeks[i]]
            curr_week_start = sorted_weeks[i]

            prev_bots = {b.get("id"): b for b in prev.get("bots", []) if b.get("id")}
            curr_bots = {b.get("id"): b for b in curr.get("bots", []) if b.get("id")}

            bot_deltas = []
            for bid, c in curr_bots.items():
                p = prev_bots.get(bid)
                if p is None:
                    msg_delta = c.get("messages", 0)
                    chat_delta = c.get("chats", 0)
                else:
                    msg_delta = c.get("messages", 0) - p.get("messages", 0)
                    chat_delta = c.get("chats", 0) - p.get("chats", 0)
                if msg_delta == 0 and chat_delta == 0:
                    continue
                bot_deltas.append({
                    "id": bid,
                    "name": c.get("name", "?"),
                    "messages_gained": msg_delta,
                    "chats_gained": chat_delta,
                })

            bot_deltas.sort(key=lambda b: -b["messages_gained"])
            total_msgs = sum(b["messages_gained"] for b in bot_deltas)
            total_chats = sum(b["chats_gained"] for b in bot_deltas)

            weeks.append({
                "week_start": curr_week_start.isoformat(),
                "week_end": (curr_week_start + timedelta(days=6)).isoformat(),
                "total_messages_gained": total_msgs,
                "total_chats_gained": total_chats,
                "active_bots": len(bot_deltas),
                "top_bot_name": bot_deltas[0]["name"] if bot_deltas else None,
                "top_bot_messages": bot_deltas[0]["messages_gained"] if bot_deltas else 0,
                "bots": bot_deltas,
            })

        weeks.reverse()
        return weeks

    def get_tag_list(self, creator: str):
        snapshots = self._load_snapshots(creator)
        if not snapshots:
            return []
        latest = snapshots[-1]
        bots = latest.get("bots", [])

        tag_stats = {}
        for bot in bots:
            for tag in bot.get("tags", []):
                if tag not in tag_stats:
                    tag_stats[tag] = {"bot_count": 0, "messages": 0, "chats": 0}
                tag_stats[tag]["bot_count"] += 1
                tag_stats[tag]["messages"] += bot.get("messages", 0)
                tag_stats[tag]["chats"] += bot.get("chats", 0)

        result = []
        for tag, stats in tag_stats.items():
            chats = stats["chats"]
            msgs = stats["messages"]
            result.append({
                "tag": tag,
                "bot_count": stats["bot_count"],
                "messages": msgs,
                "chats": chats,
                "retention": (msgs / chats) if chats else 0,
            })
        result.sort(key=lambda t: -t["bot_count"])
        return result

    def get_tag_timeseries(self, creator: str, tag: str):
        snapshots = self._latest_per_local_day(self._load_snapshots(creator))
        result = []
        for s in snapshots:
            bots_with_tag = [
                b for b in s.get("bots", []) if tag in b.get("tags", [])
            ]
            msgs = sum(b.get("messages", 0) for b in bots_with_tag)
            chats = sum(b.get("chats", 0) for b in bots_with_tag)
            result.append({
                "pulledAt": s.get("pulledAt"),
                "messages": msgs,
                "chats": chats,
                "retention": (msgs / chats) if chats else 0,
            })
        return result

    def get_tag_pie(self, creator: str, tag: str):
        snapshots = self._load_snapshots(creator)
        if not snapshots:
            return []
        latest = snapshots[-1]
        bots_with_tag = [
            b for b in latest.get("bots", []) if tag in b.get("tags", [])
        ]
        bots_with_tag.sort(key=lambda b: -b.get("messages", 0))

        TOP_N = 10
        pie_data = [
            {"name": b.get("name", "?"), "messages": b.get("messages", 0)}
            for b in bots_with_tag[:TOP_N]
        ]
        others = bots_with_tag[TOP_N:]
        if others:
            others_msgs = sum(b.get("messages", 0) for b in others)
            if others_msgs > 0:
                pie_data.append({
                    "name": f"Others ({len(others)} bots)",
                    "messages": others_msgs,
                })
        return pie_data

    def get_bot_list(self, creator: str):
        snapshots = self._load_snapshots(creator)
        if not snapshots:
            return []
        latest = snapshots[-1]
        bots = sorted(
            latest.get("bots", []),
            key=lambda b: b.get("createdAt", ""),
            reverse=True,
        )
        result = []
        for b in bots:
            msgs = b.get("messages", 0)
            chats = b.get("chats", 0)
            retention = (msgs / chats) if chats else 0
            result.append({
                "id": b.get("id"),
                "name": b.get("name", "?"),
                "messages": msgs,
                "chats": chats,
                "retention": retention,
                "created_at": b.get("createdAt"),
                "tokens": b.get("totalTokens", 0),
            })
        return result


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    webview.create_window(
        title="Janitor Analytics",
        url=str(WEB_DIR / "index.html"),
        width=1280,
        height=800,
        background_color="#0f0f0f",
        frameless=True,
        easy_drag=False,
        js_api=JsApi(),
    )
    webview.start()


if __name__ == "__main__":
    main()
