#!/usr/bin/env python3
"""
Generate VAPID keys for push notifications
Run this script to generate new VAPID keys for your application
"""

import sys
import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend

def generate_vapid_keys():
    """Generate VAPID keys for push notifications"""
    try:
        private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
        public_key = private_key.public_key()
        
        # Convert to base64 for web push
        private_key_b64 = base64.urlsafe_b64encode(
            private_key.private_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption()
            )
        ).decode('utf-8').rstrip('=')
        
        # Get the raw uncompressed public key point (65 bytes: 0x04 + 32 bytes x + 32 bytes y)
        public_numbers = public_key.public_numbers()
        x_bytes = public_numbers.x.to_bytes(32, 'big')
        y_bytes = public_numbers.y.to_bytes(32, 'big')
        public_key_raw = b'\x04' + x_bytes + y_bytes
        
        public_key_b64 = base64.urlsafe_b64encode(public_key_raw).decode('utf-8').rstrip('=')
        
        print(f"VAPID_PRIVATE_KEY=\"{private_key_b64}\"")
        print(f"VAPID_PUBLIC_KEY=\"{public_key_b64}\"")
        
        return private_key_b64, public_key_b64
    except Exception as e:
        print(f"Error generating VAPID keys: {e}", file=sys.stderr)
        return None, None

if __name__ == "__main__":
    generate_vapid_keys()
