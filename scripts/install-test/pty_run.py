#!/usr/bin/env python3
"""Run a command with or without a controlling terminal, answer prompts, enforce a timeout.

Usage:
    pty_run.py [--no-tty] [--timeout SECONDS] [--expect TEXT ANSWER]... -- CMD [ARG]...

With a terminal (default) the command runs as a session leader on a fresh pty,
so /dev/tty opens and reads from it. Each --expect pair waits for TEXT in the
output and then types ANSWER followed by Enter, in order.

With --no-tty the command runs in a new session with no controlling terminal,
so opening /dev/tty fails the way it does on CI runners and in cloud-init.

Output is copied to stdout. The exit status is the command's, or 124 when the
timeout kills it.
"""

import os
import pty
import select
import signal
import subprocess
import sys
import time


def parse_args(argv):
    tty = True
    timeout = 30.0
    expects = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            return tty, timeout, expects, argv[i + 1 :]
        if arg == "--no-tty":
            tty = False
            i += 1
        elif arg == "--timeout":
            timeout = float(argv[i + 1])
            i += 2
        elif arg == "--expect":
            expects.append((argv[i + 1].encode(), argv[i + 2].encode() + b"\n"))
            i += 3
        else:
            sys.exit("pty_run.py: unknown argument " + arg)
    sys.exit("pty_run.py: missing -- before the command")


def kill_group(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def exit_status(status):
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    return 128 + os.WTERMSIG(status)


def run_without_tty(cmd, timeout):
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        kill_group(proc.pid)
        out, _ = proc.communicate()
        sys.stdout.buffer.write(out)
        print("\npty_run.py: timed out after %ss" % timeout)
        return 124
    sys.stdout.buffer.write(out)
    return proc.returncode


def run_with_tty(cmd, timeout, expects):
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execvp(cmd[0], cmd)
        finally:
            os._exit(127)

    deadline = time.monotonic() + timeout
    output = b""
    searched = 0
    timed_out = False
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            break
        ready, _, _ = select.select([fd], [], [], min(remaining, 0.2))
        if not ready:
            continue
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        output += chunk
        while expects:
            text, answer = expects[0]
            found = output.find(text, searched)
            if found < 0:
                break
            searched = found + len(text)
            os.write(fd, answer)
            expects.pop(0)

    if timed_out:
        kill_group(pid)
    _, status = os.waitpid(pid, 0)
    os.close(fd)
    sys.stdout.buffer.write(output)
    if timed_out:
        print("\npty_run.py: timed out after %ss" % timeout)
        return 124
    if expects:
        print("\npty_run.py: never saw prompt %r" % expects[0][0].decode())
        return 125
    return exit_status(status)


def main():
    tty, timeout, expects, cmd = parse_args(sys.argv[1:])
    if not cmd:
        sys.exit("pty_run.py: no command given")
    if tty:
        code = run_with_tty(cmd, timeout, expects)
    else:
        code = run_without_tty(cmd, timeout)
    sys.stdout.flush()
    sys.exit(code)


if __name__ == "__main__":
    main()
