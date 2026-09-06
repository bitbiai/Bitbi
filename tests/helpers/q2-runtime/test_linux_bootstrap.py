"""Portable byte-copy units; not evidence of Linux namespaces or root execution."""
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("q2_bootstrap", Path(__file__).with_name("linux-bootstrap.py"))
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)  # main/root setup is deliberately not invoked


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="q2-bootstrap-unit-")
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name, "source")
        self.target = Path(self.temp.name, "private-node")
        self.source.write_bytes(b"synthetic executable bytes; never executed")
        self.source.chmod(0o500)
        self.digest = hashlib.sha256(self.source.read_bytes()).hexdigest()

    def copy(self, **kw):
        return bootstrap.snapshot_executable(kw.get("source", self.source), self.target,
                                             kw.get("digest", self.digest), kw.get("uid", os.geteuid()))

    def test_snapshot_is_independent_and_has_no_inherited_xattrs(self):
        before = self.source.stat()
        result = self.copy()
        self.assertEqual(result["sha256"], self.digest)
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())
        self.assertEqual(self.target.stat().st_uid, os.geteuid())
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o555)
        self.assertNotEqual(self.target.stat().st_ino, before.st_ino)
        self.assertEqual(self.source.stat().st_mode, before.st_mode)
        if hasattr(os, "listxattr"):
            self.assertEqual(os.listxattr(self.target), [])
        self.source.chmod(0o700)
        self.source.write_bytes(b"changed afterward")
        self.assertEqual(hashlib.sha256(self.target.read_bytes()).hexdigest(), self.digest)

    def test_digest_mismatch_removes_only_new_target(self):
        with self.assertRaisesRegex(RuntimeError, "digest mismatch"):
            self.copy(digest="0" * 64)
        self.assertFalse(self.target.exists())
        self.assertTrue(self.source.exists())
        self.target.write_text("retained")
        with self.assertRaises(FileExistsError):
            self.copy()
        self.assertEqual(self.target.read_text(), "retained")

    def test_symlink_fifo_and_hardlink_are_rejected(self):
        link = Path(self.temp.name, "link")
        link.symlink_to(self.source)
        with self.assertRaises(OSError):
            self.copy(source=link)
        fifo = Path(self.temp.name, "fifo")
        os.mkfifo(fifo)
        with self.assertRaisesRegex(RuntimeError, "single-link regular"):
            self.copy(source=fifo)
        hardlink = Path(self.temp.name, "hardlink")
        os.link(self.source, hardlink)
        with self.assertRaisesRegex(RuntimeError, "single-link regular"):
            self.copy()
        self.assertFalse(self.target.exists())

    def test_staging_owner_mode_and_digest_format_remain_required(self):
        with self.assertRaisesRegex(RuntimeError, "ordinary-owned"):
            self.copy(uid=os.geteuid() + 1)
        self.source.chmod(0o777)
        with self.assertRaisesRegex(RuntimeError, "write exposure"):
            self.copy()
        self.source.chmod(0o400)
        with self.assertRaisesRegex(RuntimeError, "regular executable"):
            self.copy()
        with self.assertRaisesRegex(RuntimeError, "Invalid Node digest"):
            self.copy(digest="not-a-hash")
        self.assertFalse(self.target.exists())

    def test_set_id_stat_rejected_even_where_sandbox_strips_chmod_bits(self):
        original = os.fstat
        def set_id(fd):
            values = list(original(fd))
            values[0] |= stat.S_ISUID
            return os.stat_result(values)
        with patch.object(bootstrap.os, "fstat", side_effect=set_id):
            with self.assertRaisesRegex(RuntimeError, "without set-ID"):
                self.copy()
        self.assertFalse(self.target.exists())

    def test_real_source_change_during_copy_is_rejected(self):
        original = os.read
        def changing_read(fd, size):
            chunk = original(fd, size)
            if chunk:
                self.source.chmod(0o700)
                self.source.write_bytes(b"different persisted bytes")
            return chunk
        with patch.object(bootstrap.os, "read", side_effect=changing_read):
            with self.assertRaisesRegex(RuntimeError, "changed during snapshot"):
                self.copy()
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
