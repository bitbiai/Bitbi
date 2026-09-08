"""Fixed hosted-VM bootstrap. Run with system Python -I -S; no project imports.

Only namespace/mount setup runs privileged. All Node, dependency and project
execution follows chroot + setpriv. There is deliberately no user namespace.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile

SAFE_ENV = {"PATH": "/usr/bin:/bin", "LANG": "C"}
REPORT_NAMES = {"isolation-result.json", "isolation-final.json", "linux-child-probe.json", "linux-child-probe-final.json", "result.json",
                "native-result.json", "references-result.json", "recovery-result.json",
                "build-provenance.json", "wrangler-build.log"}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


PRIVATE_BOUNDARY = None


def assert_private_namespaces(parent, expected=None):
    current = {name: os.readlink("/proc/self/ns/" + name) for name in ["net", "mnt", "pid", "ipc"]}
    for name, value in current.items():
        require(name in parent and value != parent[name], "A required namespace was not isolated: " + name)
        if expected is not None:
            require(value == expected[name], "Private namespace changed before privileged operation: " + name)
    return current


def fixed_run(arguments):
    require(PRIVATE_BOUNDARY is not None, "No private namespace proof before privileged operation")
    assert_private_namespaces(*PRIVATE_BOUNDARY)
    require(arguments[0] in ["/usr/bin/mount", "/usr/sbin/ip", "/usr/bin/ip"], "Unexpected privileged system command")
    regular_system_file(arguments[0])
    return subprocess.run(arguments, check=True, env=SAFE_ENV, stdin=subprocess.DEVNULL,
                          close_fds=True, stdout=subprocess.DEVNULL)


def regular_system_file(name):
    resolved = Path(name).resolve(strict=True)
    info = resolved.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
            "Required system executable is not a protected regular file")
    return str(resolved)


def file_identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mode, info.st_uid,
            info.st_gid, info.st_nlink, info.st_mtime_ns, info.st_ctime_ns)


def snapshot_executable(source, destination, expected_sha256, source_uid):
    """Copy only staged bytes, never execute them or inherit xattrs/capabilities."""
    require(re.fullmatch(r"[0-9a-f]{64}", expected_sha256), "Invalid Node digest")
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    created = False
    try:
        before = os.fstat(source_fd)
        require(stat.S_ISREG(before.st_mode) and before.st_mode & 0o111
                and not before.st_mode & 0o6022 and before.st_nlink == 1 and before.st_uid == source_uid,
                "Staged Node must be an ordinary-owned single-link regular executable without set-ID/write exposure")
        require(0 < before.st_size <= 256 * 1024 * 1024, "Staged Node size is outside the toolchain limit")
        target_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o500)
        created = True
        digest = hashlib.sha256()
        with os.fdopen(target_fd, "wb") as target:
            while True:
                chunk = os.read(source_fd, 1024 * 1024)
                if not chunk:
                    break
                require(target.tell() + len(chunk) <= before.st_size, "Staged Node grew during snapshot")
                digest.update(chunk)
                target.write(chunk)
            target.flush()
            require(file_identity(before) == file_identity(os.fstat(source_fd)), "Staged Node changed during snapshot")
            require(digest.hexdigest() == expected_sha256, "Staged Node digest mismatch")
            require(target.tell() == before.st_size, "Staged Node size mismatch")
            os.fchmod(target.fileno(), 0o555)
            protected = os.fstat(target.fileno())
            require(stat.S_ISREG(protected.st_mode) and protected.st_uid == os.geteuid()
                    and stat.S_IMODE(protected.st_mode) == 0o555 and protected.st_nlink == 1,
                    "Private executable protection failed")
        return {"sha256": digest.hexdigest(), "bytes": before.st_size,
                "source_uid": before.st_uid, "source_gid": before.st_gid,
                "source_mode": oct(stat.S_IMODE(before.st_mode)),
                "private_uid": protected.st_uid, "private_gid": protected.st_gid,
                "private_mode": oct(stat.S_IMODE(protected.st_mode)), "independent_inode": True}
    except Exception:
        if created:
            os.unlink(destination)
        raise
    finally:
        os.close(source_fd)


def reject_sockets(directory, confined_symlinks=False):
    # Read-only mounts still permit connecting to socket inodes. Do not include
    # any host socket, even if an unexpected one exists in a library directory.
    for parent, directories, files in os.walk(directory, followlinks=False):
        for name in directories + files:
            entry = Path(parent, name)
            mode = entry.lstat().st_mode
            require(stat.S_ISDIR(mode) or stat.S_ISREG(mode) or stat.S_ISLNK(mode),
                    "Special inode found in a library/input mount")
            if confined_symlinks:
                require(name not in [".git", ".ssh", ".aws", ".codex", ".wrangler", ".npmrc", ".netrc"]
                        and re.match(r"^(?:\.env|\.dev\.vars)(?:\.|$)", name) is None,
                        "Credential/Git entry found in staged input")
                if stat.S_ISLNK(mode):
                    require(not Path(os.readlink(entry)).is_absolute()
                            and entry.resolve(strict=True).is_relative_to(directory), "Staged symlink escapes its root")
                else:
                    require(not mode & 0o6000, "Set-ID staged input is forbidden")


def readonly_bind(source, target, directory=False):
    if directory:
        target.mkdir(parents=True, exist_ok=True)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.touch(exist_ok=False)
    fixed_run(["/usr/bin/mount", "--bind", str(source), str(target)])
    # Exec applies only to this private mount. Do not inherit a host /tmp
    # noexec flag for the staged Node/dependency binaries; never change the host.
    fixed_run(["/usr/bin/mount", "-o", "remount,bind,ro,nosuid,nodev,exec", str(target)])


def inner(config_path):
    config_file = Path(config_path)
    require(config_file.parent.stat().st_uid == 0 and config_file.stat().st_uid == 0,
            "Inner configuration must belong to the fixed root bootstrap")
    config = json.loads(config_file.read_text())
    global PRIVATE_BOUNDARY
    private_namespaces = assert_private_namespaces(config["parent_namespaces"])
    PRIVATE_BOUNDARY = (config["parent_namespaces"], private_namespaces)
    fixed_run(["/usr/bin/mount", "--make-rprivate", "/"])
    ip = next((p for p in ["/usr/sbin/ip", "/usr/bin/ip"] if Path(p).exists()), None)
    require(ip is not None, "Preinstalled iproute2 is required")
    regular_system_file(ip)
    fixed_run([ip, "link", "set", "lo", "up"])
    jail = config_file.parent / "rootfs"
    jail.mkdir(mode=0o755)
    fixed_run(["/usr/bin/mount", "-t", "tmpfs", "-o", "mode=0755,nosuid,exec", "tmpfs", str(jail)])
    for name in ["usr", "runtime", "workspace", "proc", "dev", "etc", "tmp", "home", "artifacts"]:
        (jail / name).mkdir()
    # Only runtime libraries, never complete /usr, /etc, /dev, /run or host /proc.
    reject_sockets("/usr/lib")
    readonly_bind("/usr/lib", jail / "usr/lib", True)
    (jail / "lib").symlink_to("usr/lib")
    if Path("/usr/lib64").exists():
        reject_sockets("/usr/lib64")
        readonly_bind("/usr/lib64", jail / "usr/lib64", True)
        (jail / "lib64").symlink_to("usr/lib64")
    reject_sockets(config["workspace"], True)
    readonly_bind(config["workspace"], jail / "workspace", True)
    require(config["node"] == str(config_file.parent / "node"), "Only the private executable may be mounted")
    readonly_bind(regular_system_file(config["node"]), jail / "runtime/node")
    for name in ["setpriv", "curl"]:
        readonly_bind(regular_system_file("/usr/bin/" + name), jail / ("runtime/" + name))
    (jail / "etc/passwd").write_text("q2:x:65534:65534:Q2 isolated runtime:/home/q2:/nonexistent\n")
    (jail / "etc/group").write_text("q2:x:65534:\n")
    (jail / "etc/hosts").write_text("127.0.0.1 localhost\n::1 localhost\n")
    (jail / "etc/nsswitch.conf").write_text("passwd: files\ngroup: files\nhosts: files\n")
    (jail / "tmp").chmod(0o1777)
    home = jail / "home/q2"
    home.mkdir(mode=0o700)
    os.chown(home, 65534, 65534)
    for name, minor in [("null", 3), ("zero", 5), ("random", 8), ("urandom", 9)]:
        os.mknod(jail / ("dev/" + name), stat.S_IFCHR | 0o666, os.makedev(1, minor))
        os.chmod(jail / ("dev/" + name), 0o666)
    (jail / "dev/fd").symlink_to("/proc/self/fd")
    for name, number in [("stdin", 0), ("stdout", 1), ("stderr", 2)]:
        (jail / ("dev/" + name)).symlink_to("/proc/self/fd/" + str(number))
    fixed_run(["/usr/bin/mount", "-t", "proc", "-o", "ro,nosuid,nodev,noexec", "proc", str(jail / "proc")])
    output = config_file.parent / "output"
    output.mkdir(mode=0o700)
    os.chown(output, 65534, 65534)
    fixed_run(["/usr/bin/mount", "--bind", str(output), str(jail / "artifacts")])
    # No host pathname, fd or inherited environment provides another filesystem
    # root after the chroot. setpriv is a fixed, root-owned system executable.
    (jail / "runtime/boundary.json").write_text(json.dumps({
        "parent_namespaces": config["parent_namespaces"], "private_namespaces": private_namespaces, "mode": config["mode"],
        "host_socket_path": config["host_socket_path"], "node_sha256": config["node_sha256"]}))
    os.chroot(jail)
    os.chdir("/")
    os.closerange(3, os.sysconf("SC_OPEN_MAX"))
    environment = {"PATH": "/runtime", "LANG": "C", "TZ": "UTC", "HOME": "/home/q2", "TMPDIR": "/tmp"}
    os.execve("/runtime/setpriv", ["/runtime/setpriv", "--reuid=65534", "--regid=65534", "--clear-groups",
              "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--",
              "/runtime/node", "/workspace/tests/helpers/q2-runtime/linux-isolated.mjs"], environment)


def copy_reports(output, session_fd, uid, gid, bootstrap_report):
    os.mkdir("reports", mode=0o700, dir_fd=session_fd)
    target_fd = os.open("reports", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=session_fd)
    try:
        fd = os.open("bootstrap-result.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=target_fd)
        with os.fdopen(fd, "w") as dest:
            json.dump(bootstrap_report, dest, indent=2)
            os.fchown(dest.fileno(), uid, gid)
        count = 0
        if output.exists():
            for parent, directories, files in os.walk(output, followlinks=False):
                directories[:] = [n for n in directories if not Path(parent, n).is_symlink()]
                for name in files:
                    p = Path(parent, name)
                    if name not in REPORT_NAMES or p.is_symlink() or not p.is_file():
                        continue
                    require(p.stat().st_size <= 8 * 1024 * 1024, "Runtime report exceeds retained artifact limit")
                    count += 1
                    require(count <= 64, "Too many runtime reports")
                    relative = str(p.relative_to(output)).replace("/", "__")
                    fd = os.open(relative, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=target_fd)
                    with os.fdopen(fd, "wb") as dest:
                        dest.write(p.read_bytes())
                        os.fchown(dest.fileno(), uid, gid)
        os.fchown(target_fd, uid, gid)
    finally:
        os.close(target_fd)


def main():
    require(sys.platform == "linux" and os.geteuid() == 0, "Fixed bootstrap requires hosted Linux sudo")
    for key, value in {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "Linux",
                       "Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP": "1"}.items():
        require(os.environ.get(key) == value, "Hosted bootstrap context/opt-in missing")
    if len(sys.argv) == 3 and sys.argv[1] == "--inner":
        inner(sys.argv[2])
        return
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True)
    parser.add_argument("--node-sha256", required=True)
    parser.add_argument("--uid", required=True, type=int)
    parser.add_argument("--gid", required=True, type=int)
    parser.add_argument("--mode", required=True, choices=["preflight", "runtime"])
    args = parser.parse_args()
    session = Path(args.session)
    require(session.is_absolute() and session == session.resolve(strict=True) and session.parent == Path("/tmp"),
            "Session must be a fresh canonical /tmp directory")
    require(session.name.startswith("bitbi-q2-linux-") and session.stat().st_uid == args.uid
            and stat.S_IMODE(session.stat().st_mode) == 0o700 and args.uid not in [0, 65534] and args.gid not in [0, 65534],
            "Invalid ordinary-user staging directory")
    workspace = session / "workspace"
    require(workspace.resolve(strict=True) == workspace and workspace.is_dir(), "Staging must not be a symlink")
    # No privileged access to the mutable hosted toolcache. The ordinary
    # launcher has matched/staged its actual /proc/self/exe at this fixed path.
    node = session / "toolchain-node"
    session_fd = os.open(session, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    # Privileged writable targets are created by root itself, outside the
    # caller-owned source tree. No arbitrary --artifacts path reaches this code.
    private = Path(tempfile.mkdtemp(prefix="bitbi-q2-jail-", dir="/tmp"))
    report = {"phase": "snapshot", "passed": False}
    try:
        os.umask(0o022)
        report["node"] = snapshot_executable(node, private / "node", args.node_sha256, args.uid)
        script = private / "bootstrap.py"
        script.write_bytes(Path(__file__).read_bytes())
        config = {"workspace": str(workspace), "node": str(private / "node"), "mode": args.mode,
                  "host_socket_path": str(session / "host-control.sock"),
                  "node_sha256": report["node"]["sha256"],
                  "parent_namespaces": {n: os.readlink("/proc/self/ns/" + n) for n in ["net", "mnt", "pid", "ipc"]}}
        config_file = private / "config.json"
        config_file.write_text(json.dumps(config))
        environment = dict(SAFE_ENV, GITHUB_ACTIONS="true", RUNNER_ENVIRONMENT="github-hosted", RUNNER_OS="Linux",
                           Q2_RUNTIME_ALLOW_HOSTED_BOOTSTRAP="1")
        report["phase"] = "isolated_execution"
        result = subprocess.run([regular_system_file("/usr/bin/unshare"), "--net", "--mount", "--pid", "--ipc",
                                 "--fork", "--kill-child=SIGKILL", "--", regular_system_file("/usr/bin/python3"),
                                 "-I", "-S", str(script), "--inner", str(config_file)],
                                env=environment, stdin=subprocess.DEVNULL, close_fds=True)
        report["exit_code"] = result.returncode
        report["passed"] = result.returncode == 0
        return result.returncode if result.returncode >= 0 else 1
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        try:
            copy_reports(private / "output", session_fd, args.uid, args.gid, report)
        finally:
            os.close(session_fd)
            # All namespace children have exited; only our root-owned private
            # root is removed. Never remove/chown a user-selected host tree.
            shutil.rmtree(private)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print("Q2 hosted bootstrap failed: " + str(error), file=sys.stderr)
        sys.exit(1)
