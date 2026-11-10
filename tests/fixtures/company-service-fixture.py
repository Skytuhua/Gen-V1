"""Opt-in real-service transport fixture; all authority and data are synthetic.

Loads only the explicitly selected repository's source and configuration. Never
opens an operator database, private registry, account profile, runtime or cloud API.
The isolated interpreter is launched with bytecode writes disabled by the test.
"""

import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread


FIXTURE_SCOPE = "synthetic_temporary_company_store"
FIXTURE_TOKEN = "gen-company-integration-fixture-token-not-a-real-credential"
FIXTURE_PRINCIPAL = "gen-integration-fixture-owner"


def emit(value):
    print(json.dumps(value, sort_keys=True, separators=(",", ":")), flush=True)


def inspect_database(database):
    # A separate read-only connection cannot initialize or alter the Store.
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
        business_digest = hashlib.sha256(
            "\n".join(connection.iterdump()).encode("utf-8")
        ).hexdigest()
        counts = {
            table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in ("projects", "approvals", "work_orders", "tasks", "attempts", "outbox")
        }
        counts["owner_messages"] = connection.execute(
            "SELECT count(*) FROM settings WHERE key LIKE 'service:owner-message:%'"
        ).fetchone()[0]
    return {
        "fixture_scope": FIXTURE_SCOPE,
        "business_digest": business_digest,
        "counts": counts,
    }


def main():
    if len(sys.argv) != 2:
        raise ValueError("Explicit trusted service repository required")
    root = Path(sys.argv[1]).resolve(strict=True)
    sys.path.insert(0, str(root / "src"))
    from company.config import Config
    from company.contracts import OwnerApproval, ProjectSpec, digest
    from company.organization import Organization
    from company.policy import Policy
    from company.projects import Projects
    from company.service import Company, Credential, CredentialRegistry, LocalServer
    from company.store import Store

    config, organization = Config.load(root), Organization.load(root)

    def approval(action, scope):
        # The accepted fixture owner label matches the service's local test policy;
        # it is fixture construction, never authenticated live-owner evidence.
        return OwnerApproval(
            digest(["gen-integration-fixture", action, scope]),
            "Skytuhua",
            action,
            scope,
            "synthetic-gen-integration-owner-audit",
            10000,
        )

    with TemporaryDirectory(prefix="gen-company-service-fixture-") as temporary:
        database = Path(temporary) / "synthetic-company.sqlite3"
        with Store(database, clock=lambda: 100, company_budget_cents=10000) as store:
            store.register_principal(FIXTURE_PRINCIPAL, "coordinator")
            projects = Projects(store, Policy(clock=store.clock))
            for project_id in ("alpha", "beta"):
                spec = ProjectSpec(
                    project_id, project_id.title(), "Synthetic offline Gen integration fixture",
                    "E03", budget_cents=5000,
                )
                projects.register(spec, approval("register_project", {
                    "project_id": project_id, "spec_digest": digest(spec),
                }))
                projects.transition(project_id, "active", approval("activate_project", {
                    "project_id": project_id,
                }))

        registry = CredentialRegistry([Credential(
            id="gen-integration-fixture-owner",
            token_sha256=hashlib.sha256(FIXTURE_TOKEN.encode("utf-8")).hexdigest(),
            kind="owner",
            principal_id=FIXTURE_PRINCIPAL,
            project_ids=("alpha",),
            permissions=("status", "artifact_preview"),
            expires_at=10000,
        )])

        def company_factory():
            # LocalServer owns and closes this request-thread Store connection.
            store = Store(database, clock=lambda: 100)
            try:
                return Company(store, config=config, organization=organization, registry=registry)
            except BaseException:
                store.close()
                raise

        with LocalServer(company_factory, registry=registry, clock=lambda: 100) as server:
            worker = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05})
            worker.start()
            try:
                emit({"port": server.server_port, "fixture_scope": FIXTURE_SCOPE})
                while True:
                    command = sys.stdin.readline(64)
                    if not command or command == "stop\n":
                        break
                    if command != "inspect\n":
                        raise ValueError("Unknown bounded fixture command")
                    emit(inspect_database(database))
            finally:
                server.shutdown()
                worker.join(timeout=5)
                if worker.is_alive():
                    raise RuntimeError("Synthetic fixture server did not stop")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        # Only a safe category: no paths, credentials, account data or tracebacks.
        print(f"Synthetic company fixture failed ({type(error).__name__}).", file=sys.stderr)
        raise SystemExit(1) from None
