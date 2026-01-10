try:
    # Preferred when running from project root: `python -m backend.main` or similar.
    from backend.services.main.constants import *
    from backend.services.main.db import *
    from backend.services.main.models import *
    from backend.services.main.validation import *
    from backend.services.main.utils import *
    from backend.services.main.dependencies import *
    from backend.services.main.main import *
except ModuleNotFoundError as exc:
    # Only attempt the fallback when the missing module is the 'backend' package itself.
    if exc.name and exc.name.startswith("backend"):
        # Fallback when running with CWD=backend (e.g. `cd backend && uvicorn main:app`)
        from services.main.constants import *
        from services.main.db import *
        from services.main.models import *
        from services.main.validation import *
        from services.main.utils import *
        from services.main.dependencies import *
        from services.main.main import *
    else:
        # Re-raise (likely a missing external dependency like sqlalchemy)
        raise