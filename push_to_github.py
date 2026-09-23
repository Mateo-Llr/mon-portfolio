#!/usr/bin/env python3
"""Auto-commit and push the portfolio to GitHub.

Usage examples:
  python push_to_github.py
  python push_to_github.py --repo mon-compte/mon-portfolio --branch main
  GITHUB_REPO=mon-compte/mon-portfolio python push_to_github.py

This script is meant for GitHub-hosted static projects and does not run a local web server.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def run(command: list[str], check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(command)}")
    result = subprocess.run(command, cwd=str(ROOT), text=True, capture_output=capture)
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    if check and result.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(command)}")
    return result


def ensure_git_repo() -> None:
    if not (ROOT / ".git").exists():
        raise RuntimeError(
            "Le dossier n'est pas encore un dépôt Git. "
            "Exécutez : git init && git branch -M main"
        )


def ensure_git_identity() -> None:
    name = os.environ.get("GIT_AUTHOR_NAME") or os.environ.get("GIT_COMMITTER_NAME")
    email = os.environ.get("GIT_AUTHOR_EMAIL") or os.environ.get("GIT_COMMITTER_EMAIL")

    if not name:
        run(["git", "config", "user.name", "GitHub Auto Push"], check=False)
    else:
        run(["git", "config", "user.name", name], check=False)

    if not email:
        run(["git", "config", "user.email", "auto-push@example.com"], check=False)
    else:
        run(["git", "config", "user.email", email], check=False)


def get_remote_url(repo_argument: str | None) -> str:
    remote = repo_argument or os.environ.get("GITHUB_REPO")
    if remote:
        if remote.startswith("http://") or remote.startswith("https://"):
            return remote
        if remote.endswith(".git"):
            return f"https://github.com/{remote}"
        return f"https://github.com/{remote}.git"

    try:
        result = run(["git", "remote", "get-url", "origin"], check=False)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass

    raise RuntimeError(
        "Aucune URL GitHub n'est configurée. "
        "Ajoutez un dépôt GitHub puis exécutez :\n"
        "  git remote add origin https://github.com/VOTRE_NOM/VOTRE_REPO.git\n"
        "ou passez --repo VOTRE_NOM/VOTRE_REPO"
    )


def ensure_remote(repo_argument: str | None) -> None:
    remote_url = get_remote_url(repo_argument)
    result = run(["git", "remote"], check=False)
    if result.returncode == 0 and "origin" not in result.stdout.splitlines():
        run(["git", "remote", "add", "origin", remote_url])


def ensure_branch(branch: str) -> None:
    try:
        run(["git", "checkout", branch], check=False)
    except Exception:
        pass

    run(["git", "checkout", "-B", branch], check=False)


def stage_and_commit(branch: str) -> bool:
    run(["git", "add", "."])

    status = run(["git", "status", "--short"], check=False)
    if not status.stdout.strip():
        print("Aucune modification détectée. Rien à publier.")
        return False

    message = os.environ.get("GIT_COMMIT_MESSAGE") or f"Auto update from local project ({branch})"
    run(["git", "commit", "-m", message])
    return True


def has_unpublished_commits(branch: str) -> bool:
    result = run(["git", "rev-list", "--count", f"origin/{branch}..{branch}"], check=False)
    return result.returncode == 0 and result.stdout.strip() != "0"


def push(branch: str) -> None:
    try:
        run(["git", "pull", "--rebase", "origin", branch])
    except RuntimeError:
        print("Aucune donnée distante ou conflit de rebase. La poussée continue si possible.")

    try:
        run(["git", "push", "-u", "origin", branch])
    except RuntimeError as exc:
        print("\nÉchec de la publication GitHub.", file=sys.stderr)
        print("Vérifiez que vous êtes connecté à GitHub et que le dépôt existe.", file=sys.stderr)
        print("Si besoin, utilisez GitHub CLI : gh auth login", file=sys.stderr)
        raise SystemExit(1) from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Publie automatiquement le portfolio sur GitHub.")
    parser.add_argument("--repo", help="Nom du dépôt GitHub au format username/repo ou URL complète.")
    parser.add_argument("--branch", default="main", help="Branche GitHub à utiliser (default: main).")
    args = parser.parse_args()

    try:
        ensure_git_repo()
        ensure_git_identity()
        ensure_remote(args.repo)
        ensure_branch(args.branch)
        if stage_and_commit(args.branch) or has_unpublished_commits(args.branch):
            push(args.branch)
        else:
            print("Le dépôt est déjà à jour sur GitHub.")
        return 0
    except Exception as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
