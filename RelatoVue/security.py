"""Local deployment policy. Missing or invalid grants never allow access."""
import json
import logging
from pathlib import Path
from threading import Lock
from time import monotonic

import workspaces

POLICY = Path(__file__).resolve().parent / '.relatovue' / 'security.json'
_lock = Lock()
_attempts = []


def policy():
    try:
        value = json.loads(POLICY.read_text(encoding='utf-8'))
        if not isinstance(value, dict) or not isinstance(value.get('users', {}), dict):
            raise ValueError()
        return value
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        raise workspaces.WorkspaceError('Security policy is invalid or unreadable. Contact the administrator.', 503) from None


def authorize(cookie, capability):
    user = workspaces.handle('list', {}, cookie)[0]['user']
    if not user:
        raise workspaces.WorkspaceError('Sign in using the bottom-left workspace menu, then retry.', 401)
    grants = policy().get('users', {}).get(user, {})
    allowed = grants.get('allow', []) if isinstance(grants, dict) else []
    if not isinstance(allowed, list) or capability not in allowed:
        raise workspaces.WorkspaceError('Your account is not approved for this service. Ask the administrator to update the security policy.', 403)
    return user


def login_limit():
    # Global loopback budget avoids attacker-controlled dictionary growth.
    with _lock:
        now = monotonic()
        _attempts[:] = [stamp for stamp in _attempts if now - stamp < 60]
        if len(_attempts) >= 10:
            raise workspaces.WorkspaceError('Too many sign-in attempts. Wait one minute and retry.', 429)
        _attempts.append(now)


def destination(connection):
    import database_wizard
    engine, host, port, database, _, _, ca, tcp = database_wizard.connection_parameters(connection)
    target = {'engine': engine, 'host': host.lower(), 'port': port, 'database': database, 'ca': ca}
    allowed = policy().get('databaseDestinations', [])
    if tcp or not isinstance(allowed, list) or target not in allowed:
        raise workspaces.WorkspaceError('Database destination or CA path is not approved. Encrypted connections are required.', 403)


def validate_plan(plan, context):
    if not isinstance(plan, dict) or set(plan) - {'action','measure','dimension','chart','period','months','status','lowest'}:
        raise ValueError('Unexpected plan fields')
    if plan.get('action') not in {'explain','report','quality','comparePeriods','rank','unsupported'}:
        raise ValueError('Invalid action')
    for key, choices in {
        'measure': context.get('measures', []) + ['count'],
        'dimension': context.get('dimensions', []) + ['completeness','validity','accuracy','timeliness','consistency','uniqueness'],
        'status': context.get('statusFields', []),
        'chart': ['line','column','bar','donut','table'],
    }.items():
        if key in plan and (not isinstance(plan[key], str) or plan[key] not in choices):
            raise ValueError('Unavailable field')
    if 'period' in plan and (type(plan['period']) is not int or not 1 <= plan['period'] <= 999):
        raise ValueError('Invalid period')
    if 'lowest' in plan and type(plan['lowest']) is not bool:
        raise ValueError('Invalid ordering')
    if 'months' in plan and (not isinstance(plan['months'], list) or len(plan['months']) > 12 or
            any(not isinstance(month, str) or month not in context.get('months', []) for month in plan['months'])):
        raise ValueError('Unavailable month')
    return plan


def audit(event, status, user=None):
    # No bodies, query strings, credentials, row values, or questions.
    logging.getLogger('relatovue.audit').warning(json.dumps({'event': event, 'status': status, 'user': user}))
