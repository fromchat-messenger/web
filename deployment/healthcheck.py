#!/usr/bin/env python3
"""
Simple health check script using built-in urllib
Replaces curl dependency in Docker health checks
"""

import sys
import urllib.request
import os

def main():
    port = os.getenv('PORT', '8300')
    url = f'http://localhost:{port}/health'

    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            if response.status == 200:
                print("OK")
                sys.exit(0)
            else:
                print(f"HTTP {response.status}")
                sys.exit(1)
    except Exception as e:
        print(f"FAILED: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()