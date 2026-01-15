"""
Database migration utility using Alembic.
This module handles running database migrations on startup.
"""
import os
import time
import logging
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
import importlib.util
current_dir = os.path.dirname(os.path.abspath(__file__))
constants_path = os.path.join(current_dir, "constants.py")
spec = importlib.util.spec_from_file_location("services_main_constants", constants_path)
constants_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(constants_mod)
DATABASE_URL = getattr(constants_mod, "DATABASE_URL")
# Backend root (two levels up from this file): backend/
backend_root = os.path.dirname(os.path.dirname(current_dir))


def _create_engine_with_retry(database_url: str = None, max_retries: int = 10, retry_delay: float = 2.0):
    """Create a database engine with retry logic for connection failures during startup."""
    url = database_url or DATABASE_URL

    for attempt in range(max_retries):
        try:
            engine = create_engine(url)
            # Test the connection
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return engine
        except (OperationalError, Exception) as e:
            if attempt < max_retries - 1:
                logger.warning(f"Database connection failed (attempt {attempt + 1}/{max_retries}): {e}")
                time.sleep(retry_delay)
            else:
                logger.error(f"Database connection failed after {max_retries} attempts: {e}")
                raise


def _load_module_by_filename(filename: str, module_name: str):
    """Load a module from a file path relative to this migration.py"""
    path = os.path.join(current_dir, filename)
    spec = importlib.util.spec_from_file_location(module_name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_models_base():
    """Return the SQLAlchemy Base from models.py regardless of import context"""
    mod = _load_module_by_filename("models.py", "services_main_models")
    return getattr(mod, "Base")


def _ensure_sqlite_directory():
    """Ensure parent directory for SQLite DB exists when using sqlite:/// URLs."""
    if not DATABASE_URL or not DATABASE_URL.startswith("sqlite"):
        return
    # strip sqlite:/// prefix
    db_path = DATABASE_URL.replace("sqlite:///", "", 1)
    parent = os.path.dirname(db_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
import logging

logger = logging.getLogger(__name__)


def _ensure_all_model_tables():
    """Create any model tables that do not exist (e.g. dm_edit_history added after migrations)."""
    engine = _create_engine_with_retry()
    Base = _load_models_base()
    Base.metadata.create_all(bind=engine)
    logger.info("Ensured all model tables exist.")


def run_migrations():
    """
    Run database migrations using Alembic.
    This function will upgrade the database to the latest migration.
    Fully automated - handles all scenarios automatically.
    """
    try:
        # FIRST: Ensure SQLite directory exists before creating engine
        _ensure_sqlite_directory()
        
        # Check if database has any application tables (excluding alembic_version)
        engine = _create_engine_with_retry()
        with engine.connect() as connection:
            from sqlalchemy import inspect
            inspector = inspect(connection)
            existing_tables = [table for table in inspector.get_table_names()
                             if not table.startswith('sqlite_') and table != 'alembic_version']

        # If no application tables exist, create them directly from models
        if not existing_tables:
            logger.info("No application tables found. Creating all tables directly from models...")
            Base = _load_models_base()
            Base.metadata.create_all(bind=engine)
            logger.info("All tables created successfully from models.")

        # Get the directory where this script is located and backend root
        current_dir = os.path.dirname(os.path.abspath(__file__))
        backend_root = os.path.dirname(os.path.dirname(current_dir))

        # Create Alembic configuration (alembic files are stored at backend/alembic)
        alembic_cfg = Config(os.path.join(backend_root, "alembic.ini"))

        # Disable Alembic's logging configuration to avoid interfering with FastAPI
        alembic_cfg.set_main_option("configure_logging", "false")

        # Set the database URL in the config (use absolute path)
        alembic_cfg.set_main_option("sqlalchemy.url", DATABASE_URL)
        # Ensure script_location is set (some alembic.ini files may omit it when running in subprocess)
        try:
            script_location = alembic_cfg.get_main_option("script_location")
        except Exception:
            script_location = None
        if not script_location:
            alembic_cfg.set_main_option("script_location", os.path.join(backend_root, "alembic"))

        # Check if any migration files exist (use backend/alembic/versions)
        versions_dir = os.path.join(backend_root, "alembic", "versions")

        if not os.path.exists(versions_dir):
            os.makedirs(versions_dir)

        migration_files = [f for f in os.listdir(versions_dir) if f.endswith('.py') and not f.startswith('__')]
        
        if not migration_files:
            logger.info("No migration files found. Creating initial migration...")
            # Check if database exists and has tables
            engine = _create_engine_with_retry()
            with engine.connect() as connection:
                from sqlalchemy import text
                # Check for PostgreSQL or SQLite
                if 'postgresql' in DATABASE_URL.lower():
                    result = connection.execute(text("""
                        SELECT tablename as name FROM pg_tables
                        WHERE schemaname = 'public' AND tablename != 'alembic_version'
                    """))
                else:
                    result = connection.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name != 'alembic_version'"))
                existing_tables = result.fetchall()
                
                if existing_tables:
                    logger.info("Found existing database with tables. Creating migration to match current schema...")
                    # Create migration with autogenerate to detect differences
                    command.revision(alembic_cfg, autogenerate=True, message="Initial migration from existing database")
                    
                    # Check if the generated migration is empty (common with existing databases)
                    versions_dir = os.path.join(backend_root, "alembic", "versions")
                    migration_files = [f for f in os.listdir(versions_dir) if f.endswith('.py') and not f.startswith('__')]
                    if migration_files:
                        latest_migration = max(migration_files)
                        migration_path = os.path.join(versions_dir, latest_migration)
                        
                        # Check if migration is empty
                        with open(migration_path, 'r') as f:
                            content = f.read()
                            if 'pass' in content and 'op.create_table' not in content and 'op.add_column' not in content:
                                logger.info("Generated migration is empty. Creating complete schema migration...")
                                # Remove the empty migration
                                os.remove(migration_path)
                                # Create a complete migration
                                _create_complete_migration(alembic_cfg)
                else:
                    logger.info("No existing tables found. Creating fresh migration...")
                    # Create fresh migration
                    command.revision(alembic_cfg, autogenerate=True, message="Initial migration")
            logger.info("Initial migration created successfully.")
        else:
            # Migration files exist, check if we need to create a new migration for schema changes
            logger.info("Migration files exist. Checking for pending schema changes...")
            try:
                # Create a new migration to detect any schema changes
                command.revision(alembic_cfg, autogenerate=True, message="Auto-generated migration for schema changes")
                
                # Check if the new migration is empty (no changes detected)
                migration_files = [f for f in os.listdir(versions_dir) if f.endswith('.py') and not f.startswith('__')]
                if migration_files:
                    latest_migration = max(migration_files)
                    migration_path = os.path.join(versions_dir, latest_migration)
                    
                    # Check if migration is empty
                    with open(migration_path, 'r') as f:
                        content = f.read()
                        if 'pass' in content and 'op.create_table' not in content and 'op.add_column' not in content and 'op.drop_table' not in content and 'op.drop_column' not in content:
                            logger.info("No schema changes detected. Removing empty migration...")
                            # Remove the empty migration
                            os.remove(migration_path)
                        else:
                            logger.info("Schema changes detected. New migration created.")
                            
            except Exception as e:
                logger.info(f"No new migrations needed or error creating migration: {e}")
                pass
        
        # Check if database is in an inconsistent state (has alembic_version but no tables)
        engine = create_engine(DATABASE_URL)
        with engine.connect() as connection:
            from sqlalchemy import text, inspect
            inspector = inspect(connection)
            existing_tables = inspector.get_table_names()
            
            # Check if we have alembic_version but no actual tables
            if 'alembic_version' in existing_tables and len(existing_tables) == 1:
                logger.info("Database has alembic_version but no actual tables - resetting migration state...")
                # Clear alembic_version and start fresh
                connection.execute(text("DELETE FROM alembic_version"))
                connection.commit()
                logger.info("Reset migration state - will create fresh migration")
        
        # Run the upgrade command
        logger.info("Running database migrations...")
        try:
            command.upgrade(alembic_cfg, "head")
            logger.info("Database migrations completed successfully.")
            _ensure_all_model_tables()
        except Exception as upgrade_error:
            if "Can't locate revision identified by 'direct_creation'" in str(upgrade_error):
                logger.info("Found 'direct_creation' revision - resetting migration state...")
                # Clear the alembic_version table and start fresh
                engine = _create_engine_with_retry()
                with engine.connect() as connection:
                    from sqlalchemy import text
                    connection.execute(text("DELETE FROM alembic_version"))
                    connection.commit()
                
                # Set the correct revision in alembic_version table
                versions_dir = os.path.join(backend_root, "alembic", "versions")
                migration_files = [f for f in os.listdir(versions_dir) if f.endswith('.py') and not f.startswith('__')]
                
                if migration_files:
                    # Get the latest migration file and extract its revision ID
                    latest_migration = max(migration_files)
                    migration_path = os.path.join(versions_dir, latest_migration)
                    
                    with open(migration_path, 'r') as f:
                        content = f.read()
                        # Extract revision ID from the file
                        import re
                        revision_match = re.search(r"revision: str = '([^']+)'", content)
                        if revision_match:
                            revision_id = revision_match.group(1)
                            logger.info(f"Setting alembic_version to {revision_id}")
                            connection.execute(text(f"INSERT INTO alembic_version (version_num) VALUES ('{revision_id}')"))
                            connection.commit()
                
                # Try upgrade again
                command.upgrade(alembic_cfg, "head")
                logger.info("Database migrations completed successfully after reset.")
                _ensure_all_model_tables()
            elif "no such table" in str(upgrade_error).lower():
                logger.info("Database tables missing - resetting migration state...")
                # Clear the alembic_version table and start fresh
                engine = _create_engine_with_retry()
                with engine.connect() as connection:
                    from sqlalchemy import text
                    connection.execute(text("DELETE FROM alembic_version"))
                    connection.commit()
                
                # Try upgrade again
                command.upgrade(alembic_cfg, "head")
                logger.info("Database migrations completed successfully after reset.")
                _ensure_all_model_tables()
            else:
                raise upgrade_error
        
    except Exception as e:
        logger.error(f"Error running database migrations: {e}")
        # Fully automated recovery - handle ALL error scenarios
        logger.info("Attempting automated recovery...")
        try:
            # Clear the alembic_version table to reset state
            engine = _create_engine_with_retry()
            with engine.connect() as connection:
                from sqlalchemy import text
                connection.execute(text("DROP TABLE IF EXISTS alembic_version"))
                connection.commit()
            
            # Check if we have existing migration files
            versions_dir = os.path.join(backend_root, "alembic", "versions")
            migration_files = [f for f in os.listdir(versions_dir) if f.endswith('.py') and not f.startswith('__')]
            
            if migration_files:
                # We have migration files, just fix the alembic_version table
                logger.info("Found existing migration files, fixing alembic_version table...")
                latest_migration = max(migration_files)
                migration_path = os.path.join(versions_dir, latest_migration)
                
                with open(migration_path, 'r') as f:
                    content = f.read()
                    import re
                    revision_match = re.search(r"revision: str = '([^']+)'", content)
                    if revision_match:
                        revision_id = revision_match.group(1)
                        logger.info(f"Setting alembic_version to {revision_id}")
                        connection.execute(text(f"INSERT INTO alembic_version (version_num) VALUES ('{revision_id}')"))
                        connection.commit()
                
                # Try upgrade again
                command.upgrade(alembic_cfg, "head")
                _ensure_all_model_tables()
                logger.info("Automated recovery completed successfully.")
            else:
                # No migration files, create fresh ones
                logger.info("No migration files found, creating fresh migration...")
                _create_complete_migration(alembic_cfg)
                
                # Run the migration
                command.upgrade(alembic_cfg, "head")
                _ensure_all_model_tables()
                logger.info("Automated recovery completed successfully.")
            
        except Exception as recovery_error:
            logger.error(f"Automated recovery failed: {recovery_error}")
            # Last resort: create database using SQLAlchemy directly
            logger.info("Using fallback: creating database directly...")
            _create_database_directly()
            logger.info("Database created successfully using fallback method.")


def _create_complete_migration(alembic_cfg):
    """Create a complete migration file with all database schema."""
    # Create a new migration file
    command.revision(alembic_cfg, message="Complete schema migration")
    
    # Get the latest migration file
    versions_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "alembic", "versions")
    migration_files = [f for f in os.listdir(versions_dir) if f.endswith('.py') and not f.startswith('__')]
    latest_migration = max(migration_files) if migration_files else None
    
    if latest_migration:
        migration_path = os.path.join(versions_dir, latest_migration)
        _populate_migration_file(migration_path)


def _populate_migration_file(migration_path):
    """Populate a migration file with the complete database schema from models."""
    # Generate the migration content dynamically from models
    migration_content = _generate_migration_from_models()
    
    # Read the current migration file
    with open(migration_path, 'r') as f:
        content = f.read()
    
    # Add datetime import if needed
    if "datetime.now" in migration_content and "from datetime import datetime" not in content:
        # Insert the import after the existing imports
        import re
        content = re.sub(
            r'(from alembic import op\nimport sqlalchemy as sa\n)',
            r'\1from datetime import datetime\n',
            content
        )
    
    # Replace the empty upgrade/downgrade functions
    import re
    # More flexible regex to match the actual content
    content = re.sub(
        r'def upgrade\(\) -> None:.*?pass.*?(?=\n\ndef downgrade|\n\nif __name__|\Z)',
        migration_content,
        content,
        flags=re.DOTALL
    )
    
    # Write the updated content back
    with open(migration_path, 'w') as f:
        f.write(content)


def _generate_migration_from_models():
    """Generate migration content dynamically from SQLAlchemy models."""
    from .models import Base
    import sqlalchemy as sa
    from datetime import datetime
    
    # Generate migration content using Alembic's op functions
    upgrade_statements = []
    downgrade_statements = []
    
    # Get all tables from Base metadata
    for table_name, table in Base.metadata.tables.items():
        if table_name != 'alembic_version':  # Skip alembic_version table
            # Check if table exists and compare schema
            schema_diff = _detect_schema_differences(table_name, table)
            
            if schema_diff['table_exists']:
                if schema_diff['needs_update']:
                    # Generate ALTER TABLE statements for existing table
                    upgrade_statements.append(f"    # Update {table_name} table schema")
                    for statement in schema_diff['alter_statements']:
                        upgrade_statements.append(f"    {statement}")
                else:
                    # Table exists and is up to date - skip creating it
                    upgrade_statements.append(f"    # Table {table_name} already exists and is up to date")
            else:
                # Generate CREATE TABLE for new table
                table_code = _generate_table_creation_code(table_name, table)
                upgrade_statements.append(f"    # Create {table_name} table")
                upgrade_statements.append(table_code)
            
            # Only add to downgrade if table actually exists
            if schema_diff['table_exists']:
                downgrade_statements.append(f"    # op.drop_table('{table_name}')  # Skipped - table exists")
            else:
                downgrade_statements.append(f"    op.drop_table('{table_name}')")
    
    # Combine all statements
    upgrade_content = "def upgrade() -> None:\n    \"\"\"Upgrade schema.\"\"\"\n" + "\n".join(upgrade_statements)
    downgrade_content = "def downgrade() -> None:\n    \"\"\"Downgrade schema.\"\"\"\n" + "\n".join(downgrade_statements)
    
    return upgrade_content + "\n\n" + downgrade_content


def _detect_schema_differences(table_name, expected_table):
    """Detect differences between existing table and expected schema."""
    engine = create_engine(DATABASE_URL)
    
    with engine.connect() as connection:
        from sqlalchemy import text, inspect
        
        # Check if table exists
        inspector = inspect(connection)
        if table_name not in inspector.get_table_names():
            return {
                'table_exists': False,
                'needs_update': False,
                'alter_statements': []
            }
        
        # Get existing columns
        existing_columns = inspector.get_columns(table_name)
        existing_column_names = {col['name'] for col in existing_columns}
        
        # Get expected columns
        expected_column_names = {col.name for col in expected_table.columns}
        
        # Check for missing columns
        missing_columns = expected_column_names - existing_column_names
        extra_columns = existing_column_names - expected_column_names
        
        alter_statements = []
        
        # Add missing columns
        for column in expected_table.columns:
            if column.name in missing_columns:
                column_def = _generate_column_definition(column)
                alter_statements.append(f"op.add_column('{table_name}', {column_def})")
        
        # Add missing indexes
        for index in expected_table.indexes:
            if not index.unique:
                cols = "', '".join([col.name for col in index.columns])
                alter_statements.append(f"op.create_index(op.f('ix_{table_name}_{index.name}'), '{table_name}', ['{cols}'], unique=False)")
        
        return {
            'table_exists': True,
            'needs_update': len(alter_statements) > 0,
            'alter_statements': alter_statements
        }


def _generate_column_definition(column):
    """Generate column definition for ALTER TABLE."""
    type_def = _get_column_type(column)
    nullable = "nullable=True" if column.nullable else "nullable=False"
    
    definition = f"sa.Column('{column.name}', {type_def}, {nullable}"
    
    # Handle default values properly
    if column.default is not None:
        if hasattr(column.default, 'arg'):
            # Handle callable defaults
            if callable(column.default.arg):
                definition += f", default=datetime.now"
            else:
                definition += f", default={repr(column.default.arg)}"
        else:
            definition += f", default={repr(column.default)}"
    
    definition += ")"
    return definition


def _generate_table_creation_code(table_name, table):
    """Generate op.create_table code for a SQLAlchemy table."""
    lines = [f"    op.create_table('{table_name}',"]
    
    # Collect all table items (columns + constraints)
    all_items = []
    
    # Add columns
    for column in table.columns:
        column_def = f"        sa.Column('{column.name}', {_get_column_type(column)}, nullable={column.nullable}"
        if column.default is not None:
            # Handle callable defaults properly
            if hasattr(column.default, 'arg') and callable(column.default.arg):
                column_def += f", default=datetime.now"
            else:
                column_def += f", default={repr(column.default)}"
        column_def += ")"
        all_items.append(column_def)
    
    # Add constraints
    for constraint in table.constraints:
        if hasattr(constraint, 'columns'):
            if constraint.__class__.__name__ == 'PrimaryKeyConstraint':
                all_items.append(f"        sa.PrimaryKeyConstraint('{constraint.columns.keys()[0]}')")
            elif constraint.__class__.__name__ == 'UniqueConstraint':
                cols = "', '".join(constraint.columns.keys())
                all_items.append(f"        sa.UniqueConstraint('{cols}')")
    
    # Add foreign key constraints
    for fk in table.foreign_keys:
        all_items.append(f"        sa.ForeignKeyConstraint(['{fk.parent.name}'], ['{fk.column.table.name}.{fk.column.name}'], )")
    
    # Add all items with commas (except the last one)
    for i, item in enumerate(all_items):
        if i < len(all_items) - 1:
            item += ","
        lines.append(item)
    
    lines.append("    )")
    
    # Add indexes with IF NOT EXISTS equivalent using try/except
    for index in table.indexes:
        if not index.unique:
            cols = "', '".join([col.name for col in index.columns])
            lines.append(f"    # Create index for {table_name}")
            lines.append(f"    try:")
            lines.append(f"        op.create_index(op.f('ix_{table_name}_{index.name}'), '{table_name}', ['{cols}'], unique=False)")
            lines.append(f"    except Exception:")
            lines.append(f"        pass  # Index may already exist")
    
    return "\n".join(lines)


def _get_column_type(column):
    """Get SQLAlchemy column type string."""
    type_name = column.type.__class__.__name__
    
    if type_name == 'String':
        return f"sa.String(length={column.type.length})"
    elif type_name == 'Integer':
        return "sa.Integer()"
    elif type_name == 'Text':
        return "sa.Text()"
    elif type_name == 'Boolean':
        return "sa.Boolean()"
    elif type_name == 'DateTime':
        return "sa.DateTime()"
    else:
        return f"sa.{type_name}()"


def _create_database_directly():
    """Fallback method: create database directly using SQLAlchemy."""
    # Load Base and engine in a robust way (work when run as script or package)
    _ensure_sqlite_directory()
    Base = _load_models_base()
    from sqlalchemy import text, inspect
    engine = create_engine(DATABASE_URL)

    # Check existing tables and update schema
    with engine.connect() as connection:
        inspector = inspect(connection)
        existing_tables = inspector.get_table_names()
        
        # For each model table, check if it needs updates
        for table_name, table in Base.metadata.tables.items():
            if table_name != 'alembic_version':
                if table_name in existing_tables:
                    # Table exists, check for missing columns
                    existing_columns = {col['name'] for col in inspector.get_columns(table_name)}
                    expected_columns = {col.name for col in table.columns}
                    missing_columns = expected_columns - existing_columns
                    
                    # Add missing columns
                    for column in table.columns:
                        if column.name in missing_columns:
                            # Convert to raw SQL for direct execution
                            sql_type = _get_sql_type(column)
                            nullable = "NULL" if column.nullable else "NOT NULL"
                            
                            # Handle datetime columns without default (SQLite limitation)
                            if column.type.__class__.__name__ == 'DateTime':
                                # Add column without default, then update existing rows
                                alter_sql = f"ALTER TABLE {table_name} ADD COLUMN {column.name} {sql_type} {nullable}"
                                try:
                                    connection.execute(text(alter_sql))
                                    logger.info(f"Added column {column.name} to {table_name}")
                                    
                                    # Update existing rows with current timestamp
                                    update_sql = f"UPDATE {table_name} SET {column.name} = CURRENT_TIMESTAMP WHERE {column.name} IS NULL"
                                    connection.execute(text(update_sql))
                                    logger.info(f"Updated {column.name} with current timestamp")
                                except Exception as e:
                                    logger.error(f"Could not add column {column.name}: {e}")
                            else:
                                # Handle other column types with defaults
                                default_clause = ""
                                if column.default is not None:
                                    if hasattr(column.default, 'arg') and callable(column.default.arg):
                                        # Skip callable defaults for SQLite compatibility
                                        pass
                                    elif hasattr(column.default, 'arg'):
                                        default_clause = f" DEFAULT {repr(column.default.arg)}"
                                
                                alter_sql = f"ALTER TABLE {table_name} ADD COLUMN {column.name} {sql_type} {nullable}{default_clause}"
                                try:
                                    connection.execute(text(alter_sql))
                                    logger.info(f"Added column {column.name} to {table_name}")
                                except Exception as e:
                                    logger.error(f"Could not add column {column.name}: {e}")
                else:
                    # Table doesn't exist, create it
                    logger.info(f"Creating table {table_name}")
                    from sqlalchemy.schema import CreateTable
                    connection.execute(CreateTable(Base.metadata.tables[table_name]))
        
        # Create alembic_version table manually
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS alembic_version (
                version_num VARCHAR(32) NOT NULL,
                CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
            )
        """))
        
        # Get the correct revision ID from existing migration files
        versions_dir = os.path.join(backend_root, "alembic", "versions")
        migration_files = [f for f in os.listdir(versions_dir) if f.endswith('.py') and not f.startswith('__')]
        
        if migration_files:
            latest_migration = max(migration_files)
            migration_path = os.path.join(versions_dir, latest_migration)
            
            with open(migration_path, 'r') as f:
                content = f.read()
                import re
                revision_match = re.search(r"revision: str = '([^']+)'", content)
                if revision_match:
                    revision_id = revision_match.group(1)
                    if 'postgresql' in DATABASE_URL.lower():
                        connection.execute(text(f"INSERT INTO alembic_version (version_num) VALUES ('{revision_id}') ON CONFLICT DO NOTHING"))
                    else:
                        connection.execute(text(f"INSERT OR IGNORE INTO alembic_version (version_num) VALUES ('{revision_id}')"))
                else:
                    if 'postgresql' in DATABASE_URL.lower():
                        connection.execute(text("INSERT INTO alembic_version (version_num) VALUES ('direct_creation') ON CONFLICT DO NOTHING"))
                    else:
                        connection.execute(text("INSERT OR IGNORE INTO alembic_version (version_num) VALUES ('direct_creation')"))
        else:
            if 'postgresql' in DATABASE_URL.lower():
                connection.execute(text("INSERT INTO alembic_version (version_num) VALUES ('direct_creation') ON CONFLICT DO NOTHING"))
            else:
                connection.execute(text("INSERT OR IGNORE INTO alembic_version (version_num) VALUES ('direct_creation')"))
        
        connection.commit()


def _get_sql_type(column):
    """Get SQL type for direct SQL execution."""
    from sqlalchemy import String, Integer, Text, Boolean, DateTime
    import os

    # Check if we're using PostgreSQL
    is_postgres = 'postgresql' in os.getenv('DATABASE_URL', '').lower()

    if isinstance(column.type, String):
        if column.type.length:
            return f"VARCHAR({column.type.length})"
        else:
            return "TEXT"
    elif isinstance(column.type, Integer):
        return "INTEGER"
    elif isinstance(column.type, Text):
        return "TEXT"
    elif isinstance(column.type, Boolean):
        return "BOOLEAN"
    elif isinstance(column.type, DateTime):
        return "TIMESTAMP" if is_postgres else "DATETIME"
    else:
        return "TEXT"  # fallback


def check_migration_status():
    """
    Check if the database needs migrations.
    Returns True if migrations are needed, False otherwise.
    """
    try:
        # Get engine for checking migration status
        engine = create_engine(DATABASE_URL)
        
        # Check if alembic_version table exists
        with engine.connect() as connection:
            # Check if alembic_version table exists
            from sqlalchemy import text
            result = connection.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'")
            )
            alembic_table_exists = result.fetchone() is not None
            
            if not alembic_table_exists:
                return True
            
            # Get current migration context
            context = MigrationContext.configure(connection)
            current_rev = context.get_current_revision()
            
            # Get the latest revision from alembic (use backend/alembic)
            alembic_cfg = Config(os.path.join(backend_root, "alembic.ini"))
            script_dir = command.ScriptDirectory.from_config(alembic_cfg)
            head_rev = script_dir.get_current_head()
            
            return current_rev != head_rev
            
    except Exception as e:
        logger.error(f"Error checking migration status: {e}")
        return True  # Assume migrations are needed if we can't check


if __name__ == "__main__":
    # This allows running migrations directly
    run_migrations()
