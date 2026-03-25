#!/usr/bin/env python3
"""
Generate compliance system X25519 keypair for offline air-gapped storage.

This script generates an X25519 keypair for the compliance system.
The private key should be stored offline on an air-gapped machine.
Only the public key is provided to the messaging service via COMPLIANCE_PUBLIC_KEY env var.

Usage:
    python3 scripts/generate_compliance_keypair.py

Output:
    - Prints the keypair to console
    - Optionally saves to a file
"""

import base64
import sys
import os
from pathlib import Path
import argparse

try:
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
    from cryptography.hazmat.primitives import serialization
except ImportError:
    print("Error: cryptography library required")
    print("Install with: pip install cryptography")
    sys.exit(1)


def generate_compliance_keypair():
    """
    Generate X25519 keypair for compliance system.
    
    Returns:
        Tuple of (private_key_b64, public_key_b64)
    """
    # Generate X25519 keypair
    private_key = X25519PrivateKey.generate()
    public_key = private_key.public_key()

    # Export keys
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption()
    )
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw
    )

    # Convert to base64
    private_b64 = base64.b64encode(private_bytes).decode('utf-8')
    public_b64 = base64.b64encode(public_bytes).decode('utf-8')

    return private_b64, public_b64


def main():
    """Generate and display compliance keypair."""
    parser = argparse.ArgumentParser(
        description="Generate compliance system X25519 keypair"
    )
    parser.add_argument(
        "--save",
        action="store_true",
        help="Save keypair to compliance_keypair.txt file"
    )
    parser.add_argument(
        "--public-only",
        action="store_true",
        help="Output only the public key (for scripts)"
    )
    parser.add_argument(
        "--emit-key-lines",
        action="store_true",
        help="Print private key line then public key line to stdout only (no file; for generate:env.sh)",
    )

    args = parser.parse_args()

    private_b64, public_b64 = generate_compliance_keypair()

    if args.emit_key_lines:
        print(private_b64)
        print(public_b64)
        return

    if args.public_only:
        # Output only public key for script integration
        print(public_b64)
    else:
        # Full interactive display
        output = f"""
╔════════════════════════════════════════════════════════════════╗
║           COMPLIANCE SYSTEM X25519 KEYPAIR                     ║
║      (Generated for testing/development only)                  ║
╚════════════════════════════════════════════════════════════════╝

PRIVATE KEY (STORE OFFLINE ON AIR-GAPPED MACHINE):
{private_b64}

PUBLIC KEY (SET AS COMPLIANCE_PUBLIC_KEY ENV VAR):
{public_b64}

CONFIGURATION:
  For local development:
    export COMPLIANCE_PUBLIC_KEY="{public_b64}"

  For Docker/docker-compose:
    Add to deployment/.env:
      COMPLIANCE_PUBLIC_KEY={public_b64}

  For production:
    Generate on air-gapped machine, export public key only
    Store private key offline in secure location
    
⚠️  SECURITY WARNING:
    - Keep the PRIVATE KEY offline on an air-gapped machine
    - Only the PUBLIC KEY should be deployed to servers
    - Never commit private key to version control
    - For production, use cryptographically secure key generation
"""

        print(output)

    # Handle file saving
    if args.save:
        script_dir = Path(__file__).parent
        project_root = script_dir.parent
        output_file = project_root / "compliance_keypair.txt"
        
        full_output = f"""COMPLIANCE SYSTEM X25519 KEYPAIR
Generated: {__import__('datetime').datetime.now().isoformat()}
================================================================================

PRIVATE KEY (STORE OFFLINE ON AIR-GAPPED MACHINE):
{private_b64}

PUBLIC KEY (SET AS COMPLIANCE_PUBLIC_KEY ENV VAR):
{public_b64}

================================================================================
⚠️  SECURITY WARNING:
    - Keep the PRIVATE KEY offline on an air-gapped machine
    - Only the PUBLIC KEY should be deployed to servers
    - Never commit private key to version control
"""
        
        with open(output_file, 'w') as f:
            f.write(full_output)
        
        print(f"✓ Keypair saved to: {output_file}", file=sys.stderr)


if __name__ == "__main__":
    main()
