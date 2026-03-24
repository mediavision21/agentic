#!/usr/bin/env python3
"""CLI tool to add users to the MediaVision database."""
import sys
import os
import hashlib

sys.path.insert(0, os.path.dirname(__file__))
import evaldb


def main():
    if len(sys.argv) != 3:
        print("Usage: python add_user.py <username> <password>")
        sys.exit(1)
    username = sys.argv[1]
    password = sys.argv[2]
    # pre-hash with SHA-256 to match what the frontend sends
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    ok = evaldb.create_user(username, password_hash)
    if ok:
        print(f"User '{username}' created successfully.")
    else:
        print(f"Error: User '{username}' already exists.")
        sys.exit(1)


if __name__ == "__main__":
    main()
