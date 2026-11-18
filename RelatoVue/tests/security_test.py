from contextlib import closing
from http.client import HTTPConnection
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import security
import workspaces


class SecurityTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        for module, key, value in [(workspaces, 'STORE', Path(temp.name)/'db.sqlite3'),
                                   (security, 'POLICY', Path(temp.name)/'security.json')]:
            mock = patch.object(module, key, value)
            mock.start()
            self.addCleanup(mock.stop)
        security._attempts.clear()
        _, cookie = workspaces.handle('register', {'username':'alice', 'password':'a long test password'}, '')
        self.cookie = cookie.split(';')[0]
        self.policy = {'users': {'alice': {'allow': ['source:postgres','database:wizard','ai:plan']}}, 'aiProviders':['openai']}
        self.write_policy()
        self.http = server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()

    def write_policy(self):
        security.POLICY.write_text(json.dumps(self.policy), encoding='utf-8')

    def request(self, path, cookie='', body=None, origin=True):
        port=self.http.server_port
        with closing(HTTPConnection('127.0.0.1',port)) as client:
            headers={'Cookie':cookie, 'Content-Type':'application/json'}
            if origin:
                headers['Origin']=f'http://127.0.0.1:{port}'
            client.request('POST' if body is not None else 'GET', path,
                           json.dumps(body) if body is not None else None, headers)
            response=client.getresponse()
            data=response.read()
            return response.status, json.loads(data)

    def test_source_authorization_and_revocation(self):
        with patch.object(server,'configured',return_value=True), patch.object(server,'load_dataset',return_value={'rows':[]}) as load:
            self.assertEqual(self.request('/api/datasets/postgres')[0],401)
            load.assert_not_called()
            self.assertEqual(self.request('/api/datasets/postgres',self.cookie)[0],200)
            self.assertEqual(self.request('/api/datasets/mysql',self.cookie)[0],403)
            self.policy['users']={};self.write_policy()
            self.assertEqual(self.request('/api/datasets/postgres',self.cookie)[0],403)
            workspaces.handle('logout',{},self.cookie)
            self.assertEqual(self.request('/api/datasets/postgres',self.cookie)[0],401)

    def test_static_assets_require_cache_revalidation(self):
        with closing(HTTPConnection('127.0.0.1',self.http.server_port)) as client:
            for method,path in [('GET','/'),('GET','/app.js?v=3'),('HEAD','/profile.js?v=2')]:
                with self.subTest(method=method,path=path):
                    client.request(method,path)
                    response=client.getresponse()
                    self.assertEqual(response.status,200)
                    self.assertEqual(response.getheader('Cache-Control'),'no-cache')
                    response.read()
            client.request('GET','/api/workspaces')
            response=client.getresponse()
            self.assertEqual(response.getheader('Cache-Control'),'no-store')
            response.read()

    def test_wizard_and_origin(self):
        with patch.object(server.database_wizard,'run') as run:
            self.assertEqual(self.request('/api/database/schemas',body={})[0],401)
            self.assertEqual(self.request('/api/database/schemas',self.cookie,{},False)[0],403)
            connection={'engine':'mysql','host':'db.example','port':3306,'database':'sales','user':'reader','password':'secret'}
            self.assertEqual(self.request('/api/database/schemas',self.cookie,{'connection':connection})[0],403)
            run.assert_not_called()
            self.policy['databaseDestinations']=[{'engine':'mysql','host':'db.example','port':3306,'database':'sales','ca':''}]
            self.write_policy();run.return_value={'schemas':[]}
            self.assertEqual(self.request('/api/database/schemas',self.cookie,{'connection':connection})[0],200)

    def test_ai_policy_and_plan(self):
        with patch.object(server.assistant_providers,'provider',return_value='openai'), patch.object(server.copilot,'enabled',return_value=False), patch.object(server.assistant_providers,'get_plan',return_value={'action':'explain'}) as model:
            self.assertEqual(self.request('/api/assistant/plan',body={'question':'hi'})[0],401)
            model.assert_not_called()
            self.assertEqual(self.request('/api/assistant/plan',self.cookie,{'question':'hi'})[0],200)
            model.return_value={'action':'report','sql':'SELECT secret'}
            self.assertEqual(self.request('/api/assistant/plan',self.cookie,{'question':'hi'})[0],502)
            self.policy['aiProviders']=[];self.write_policy();model.reset_mock()
            self.assertEqual(self.request('/api/assistant/plan',self.cookie,{'question':'hi'})[0],403)
            model.assert_not_called()

    def test_policy_failure_and_expiry(self):
        security.POLICY.write_text('{broken',encoding='utf-8')
        with self.assertRaises(workspaces.WorkspaceError) as error:
            security.authorize(self.cookie,'ai:plan')
        self.assertEqual(error.exception.status,503)
        security.POLICY.unlink()
        with self.assertRaises(workspaces.WorkspaceError):
            security.authorize(self.cookie,'ai:plan')
        with closing(workspaces.connect()) as db, db:
            db.execute('UPDATE sessions SET expires=0')
        with self.assertRaises(workspaces.WorkspaceError) as error:
            security.authorize(self.cookie,'ai:plan')
        self.assertEqual(error.exception.status,401)

    def test_registration_limit_and_audit(self):
        self.policy['registrationEnabled']=False;self.write_policy()
        self.assertEqual(self.request('/api/workspaces/register',body={'username':'newuser','password':'a long test password'})[0],403)
        security._attempts.clear()
        for _ in range(10): security.login_limit()
        with self.assertRaises(workspaces.WorkspaceError) as error: security.login_limit()
        self.assertEqual(error.exception.status,429)
        with self.assertLogs('relatovue.audit') as logs:
            self.request('/api/assistant/plan?key=SECRET',body={'question':'CONFIDENTIAL'})
        self.assertNotIn('SECRET',str(logs.output))
        self.assertNotIn('CONFIDENTIAL',str(logs.output))

    def test_plan_rejections(self):
        for plan in [{'action':'delete'}, {'action':'rank','measure':'salary'},
                     {'action':'report','period':True}, {'action':'report','months':['1999-01']},
                     {'action':'rank','lowest':'yes'}, {'action':'report','chart':'script'}]:
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                security.validate_plan(plan,{})


if __name__ == '__main__': unittest.main()
