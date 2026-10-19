import hashlib
import importlib.machinery
import importlib.util
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile


source = Path(__file__).resolve().parents[1] / "workboard-deploy"
loader = importlib.machinery.SourceFileLoader("workboard_deploy", str(source))
spec = importlib.util.spec_from_loader(loader.name, loader)
deployment = importlib.util.module_from_spec(spec)
loader.exec_module(deployment)


def application(directory, migration=b"CREATE TABLE ticket (id UUID);"):
    (directory / "app").mkdir(parents=True)
    (directory / "quarkus-run.jar").write_bytes(b"runner")
    with zipfile.ZipFile(directory / "app/workboard.jar", "w") as bundle:
        bundle.writestr("db/migration/V1__create_ticket.sql", migration)


def archive(directory):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as bundle:
        bundle.add(directory, arcname=".")
    return output.getvalue()


class ArchiveTests(unittest.TestCase):
    def test_extracts_fast_jar_and_removes_write_permission_for_other_users(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application(root / "app")
            bundle = root / "bundle.tar.gz"
            bundle.write_bytes(archive(root / "app"))
            destination = root / "release"
            destination.mkdir()
            deployment.unpack(bundle, destination)
            self.assertTrue((destination / "quarkus-run.jar").is_file())
            self.assertEqual((destination / "app/workboard.jar").stat().st_mode & 0o777, 0o644)
            self.assertEqual(deployment.migrations(destination), deployment.migrations(root / "app"))

    def test_rejects_traversal_absolute_paths_links_and_special_files(self):
        for name, kind in [("../outside", tarfile.REGTYPE), ("/tmp/outside", tarfile.REGTYPE),
                           ("link", tarfile.SYMTYPE), ("link", tarfile.LNKTYPE),
                           ("device", tarfile.CHRTYPE)]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = "/etc/passwd"
                with tarfile.open(root / "bundle.tar.gz", "w:gz") as bundle:
                    bundle.addfile(member)
                with self.assertRaises(ValueError):
                    deployment.unpack(root / "bundle.tar.gz", root / "release")

    def test_rejects_duplicate_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with tarfile.open(root / "bundle.tar.gz", "w:gz") as bundle:
                bundle.addfile(tarfile.TarInfo("duplicate"))
                bundle.addfile(tarfile.TarInfo("duplicate"))
            with self.assertRaisesRegex(ValueError, "duplicate"):
                deployment.unpack(root / "bundle.tar.gz", root / "release")


class DeploymentTests(unittest.TestCase):
    def run_deploy(self, root, payload, verify_failure=False, backup_failure=False):
        def run(command, **kwargs):
            if backup_failure and command[1:] == ["start", "workboard-backup.service"]:
                raise subprocess.CalledProcessError(1, command)
            return subprocess.CompletedProcess(command, 0)

        stdin = io.TextIOWrapper(io.BytesIO(payload))
        verification = [RuntimeError("unhealthy"), None] if verify_failure else [None]
        with patch.object(deployment, "ROOT", root), patch.object(deployment.sys, "stdin", stdin), \
                patch.object(deployment.subprocess, "run", side_effect=run) as commands, \
                patch.object(deployment, "verify", side_effect=verification) as verify:
            try:
                deployment.deploy("a" * 40 + "-123-1", hashlib.sha256(payload).hexdigest())
            except (RuntimeError, subprocess.CalledProcessError) as error:
                return commands, verify, error
            return commands, verify, None

    def prepare(self, root, changed=False):
        previous = root / "releases/previous"
        application(previous)
        (root / "current").symlink_to(previous)
        staged = root / "build"
        if changed:
            application(staged, b"CREATE TABLE ticket (id UUID, title TEXT);")
        else:
            application(staged)
        return previous.resolve(), archive(staged)

    def test_healthy_release_is_selected_after_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous, payload = self.prepare(root)
            commands, verify, error = self.run_deploy(root, payload)
            self.assertIsNone(error)
            self.assertNotEqual((root / "current").resolve(), previous)
            self.assertEqual(commands.call_args_list[0].args[0][1:], ["start", "workboard-backup.service"])
            self.assertTrue((root / "current/.release.json").is_file())
            verify.assert_called_once_with()

    def test_backup_failure_leaves_running_release_untouched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous, payload = self.prepare(root)
            commands, verify, error = self.run_deploy(root, payload, backup_failure=True)
            self.assertIsInstance(error, subprocess.CalledProcessError)
            self.assertEqual((root / "current").resolve(), previous)
            verify.assert_not_called()
            self.assertEqual(commands.call_count, 1)

    def test_unhealthy_release_restores_previous_when_migrations_match(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous, payload = self.prepare(root)
            commands, verify, error = self.run_deploy(root, payload, verify_failure=True)
            self.assertIsInstance(error, RuntimeError)
            self.assertEqual((root / "current").resolve(), previous)
            self.assertEqual(verify.call_args.kwargs, {"require_health": False})
            self.assertEqual(sum(call.args[0][1:] == ["restart", "workboard.service"]
                                 for call in commands.call_args_list), 2)

    def test_migration_change_prevents_unsafe_automatic_rollback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous, payload = self.prepare(root, changed=True)
            commands, verify, error = self.run_deploy(root, payload, verify_failure=True)
            self.assertIsInstance(error, RuntimeError)
            self.assertNotEqual((root / "current").resolve(), previous)
            self.assertEqual(commands.call_args.args[0][1:], ["stop", "workboard.service"])
            self.assertEqual(verify.call_count, 1)

    def test_bad_checksum_never_restarts_service(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous, payload = self.prepare(root)
            with patch.object(deployment, "ROOT", root), \
                    patch.object(deployment.sys, "stdin", io.TextIOWrapper(io.BytesIO(payload))), \
                    patch.object(deployment.subprocess, "run") as commands:
                with self.assertRaisesRegex(ValueError, "checksum"):
                    deployment.deploy("a" * 40 + "-123-1", "0" * 64)
            self.assertEqual((root / "current").resolve(), previous)
            commands.assert_not_called()


class VerificationTests(unittest.TestCase):
    def test_waits_for_protected_api_and_local_health_then_runs_session_smoke(self):
        def request(url):
            if url.endswith("/api/tickets"):
                return 401, b""
            return 200, b'{"status":"UP"}'
        with patch.object(deployment, "request", side_effect=request), \
                patch.object(deployment.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            deployment.verify()
            command = run.call_args.args[0]
            self.assertIn("--check-auth", command)
            self.assertIn("--ensure-account", command)
            self.assertIn("/etc/workboard/deploy-smoke.json", command)


if __name__ == "__main__":
    unittest.main()
