from contextlib import closing
import sqlite3
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import workspaces


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        previous = workspaces.STORE
        self.addCleanup(setattr, workspaces, "STORE", previous)
        workspaces.STORE = Path(self.temp.name) / "store.sqlite3"

    def register(self, name):
        result, cookie = workspaces.handle("register", {
            "username": name, "password": "fixture password 123"
        }, "")
        self.assertIn("HttpOnly", cookie)
        return result, cookie.split(";")[0]

    def test_accounts_isolate_and_restore_settings(self):
        alice, session = self.register("alice")
        bob, bob_session = self.register("bob")
        self.assertNotEqual(alice["workspaces"][0]["id"], bob["workspaces"][0]["id"])
        created, _ = workspaces.handle("create", {"name": "Sales"}, session)
        workspace_id = created["selected"]
        result, _ = workspaces.handle("save", {"id": workspace_id, "settings": {
            "goals": ["quality"], "measure": "Revenue", "rows": [["private"]],
            "password": "not saved", "groupChart": "bar",
        }}, session)
        self.assertEqual(result["workspaces"][1]["settings"], {
            "measure": "Revenue", "groupChart": "bar",
        })
        with self.assertRaises(workspaces.WorkspaceError) as error:
            workspaces.handle("save", {"id": workspace_id, "settings": {}}, bob_session)
        self.assertEqual(error.exception.status, 404)
        self.assertEqual([row["name"] for row in workspaces.handle("list", {}, bob_session)[0]["workspaces"]], ["Personal"])
        workspaces.handle("logout", {}, session)
        self.assertIsNone(workspaces.handle("list", {}, session)[0]["user"])
        resumed, _ = workspaces.handle("login", {"username":"ALICE","password":"fixture password 123"}, "")
        self.assertEqual(resumed["workspaces"][1]["settings"]["measure"], "Revenue")
        with closing(sqlite3.connect(workspaces.STORE)) as db:
            self.assertNotEqual(db.execute("SELECT password FROM accounts WHERE username='alice'").fetchone()[0], b"fixture password 123")

    def test_guest_and_invalid_login(self):
        self.assertEqual(workspaces.handle("list", {}, "")[0]["workspaces"], [])
        self.assertFalse(workspaces.STORE.exists())
        with self.assertRaises(workspaces.WorkspaceError):
            workspaces.handle("create", {"name":"Sales"}, "")
        self.register("alice")
        with self.assertRaises(workspaces.WorkspaceError) as error:
            workspaces.handle("login", {"username":"alice","password":"incorrect password"}, "")
        self.assertEqual(error.exception.status, 401)

    def test_saves_outcome_column_names(self):
        account, session = self.register("alice")
        fields = {"rule": "Business check", "ruleKey": "Rule ID", "population": "Total", "valid": "Good", "invalid": "Bad",
                  "score": "Score", "group": None, "date": "Full Date", "party": "Party Type"}
        result, _ = workspaces.handle("save", {"id": account["workspaces"][0]["id"], "settings": {
            "outcomeFields": {**fields, "rows": [["private"]]},
        }}, session)
        self.assertEqual(result["workspaces"][0]["settings"], {"outcomeFields": fields})


if __name__ == "__main__":
    unittest.main()
