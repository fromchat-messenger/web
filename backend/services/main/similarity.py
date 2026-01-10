"""
Similarity detection utilities for username and display name comparison.
Implements both edit distance and visual similarity detection.
"""

def levenshtein_distance(s1: str, s2: str) -> int:
    """Calculate Levenshtein distance between two strings."""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)

    if len(s2) == 0:
        return len(s1)

    previous_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    
    return previous_row[-1]


def check_visual_similarity(s1: str, s2: str) -> bool:
    """
    Check if two strings are visually similar using common homoglyphs.
    Returns True if strings are visually similar.
    """
    if len(s1) != len(s2):
        return False
    
    # Common homoglyph mappings
    homoglyphs = {
        '0': ['O', 'o', 'Q'],
        'O': ['0', 'o', 'Q'],
        'o': ['0', 'O', 'Q'],
        '1': ['l', 'I', '|'],
        'l': ['1', 'I', '|'],
        'I': ['1', 'l', '|'],
        '5': ['S', 's'],
        'S': ['5', 's'],
        's': ['5', 'S'],
        '6': ['G', 'g'],
        'G': ['6', 'g'],
        'g': ['6', 'G'],
        '8': ['B', 'b'],
        'B': ['8', 'b'],
        'b': ['8', 'B'],
        '9': ['g', 'q'],
        'g': ['9', 'q'],
        'q': ['9', 'g'],
        '2': ['Z', 'z'],
        'Z': ['2', 'z'],
        'z': ['2', 'Z'],
        '3': ['E'],
        'E': ['3'],
        '4': ['A'],
        'A': ['4'],
        '7': ['T', 't'],
        'T': ['7', 't'],
        't': ['7', 'T'],
    }
    
    for i in range(len(s1)):
        c1, c2 = s1[i], s2[i]
        if c1 == c2:
            continue
        
        # Check if characters are homoglyphs
        if (c1 in homoglyphs and c2 in homoglyphs[c1]) or \
           (c2 in homoglyphs and c1 in homoglyphs[c2]):
            continue
        
        return False
    
    return True


def check_username_similarity(username1: str, username2: str) -> bool:
    """
    Check if two usernames are similar using both edit distance and visual similarity.
    Returns True if usernames are considered similar.
    """
    if username1 == username2:
        return False
    
    # Check edit distance (Levenshtein distance <= 2)
    edit_distance = levenshtein_distance(username1.lower(), username2.lower())
    if edit_distance <= 2:
        return True
    
    # Check visual similarity
    if check_visual_similarity(username1, username2):
        return True
    
    return False


def check_display_name_similarity(display_name1: str, display_name2: str) -> bool:
    """
    Check if two display names are similar using both edit distance and visual similarity.
    Returns True if display names are considered similar.
    """
    if display_name1 == display_name2:
        return False
    
    # Check edit distance (Levenshtein distance <= 2)
    edit_distance = levenshtein_distance(display_name1.lower(), display_name2.lower())
    if edit_distance <= 2:
        return True
    
    # Check visual similarity
    if check_visual_similarity(display_name1, display_name2):
        return True
    
    return False


def is_user_similar_to_verified(user_username: str, user_display_name: str, 
                               verified_users: list[dict]) -> tuple[bool, str]:
    """
    Check if a user is similar to any verified user.
    
    Args:
        user_username: Username to check
        user_display_name: Display name to check
        verified_users: List of verified user dictionaries with 'username' and 'display_name' keys
    
    Returns:
        Tuple of (is_similar, similar_to_username)
    """
    for verified_user in verified_users:
        verified_username = verified_user.get('username', '')
        verified_display_name = verified_user.get('display_name', '')
        
        # Check username similarity
        if check_username_similarity(user_username, verified_username):
            return True, verified_username
        
        # Check display name similarity
        if check_display_name_similarity(user_display_name, verified_display_name):
            return True, verified_username
    
    return False, ""
