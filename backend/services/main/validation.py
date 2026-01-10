import re

def is_valid_username(username: str) -> bool:
    if len(username) < 3 or len(username) > 20:
        return False
    # Only allow English letters, numbers, dashes and underscores
    if not re.match(r'^[a-zA-Z0-9_-]+$', username):
        return False
    return True


def is_valid_display_name(display_name: str) -> bool:
    if len(display_name) < 1 or len(display_name) > 64:
        return False
    # Check if not blank (only whitespace)
    if not display_name.strip():
        return False
    return True


def is_valid_password(password: str) -> bool:
    if len(password) < 5 or len(password) > 50:
        return False
    if re.search(r'[\s\u180E\u200B-\u200D\u2060\uFEFF]', password):
        return False
    return True